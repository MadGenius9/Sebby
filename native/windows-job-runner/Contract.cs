using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Sebby.JobRunner;

internal sealed record RunRequest
{
    public required int Version { get; init; }
    public required string Executable { get; init; }
    public required string ExecutableSha256 { get; init; }
    public required string[] Args { get; init; }
    public required string WorkspaceRoot { get; init; }
    public required string WorkingDirectory { get; init; }
    public required int TimeoutMs { get; init; }
    public required int MaxOutputBytes { get; init; }
}

internal static class Contract
{
    internal static readonly JsonSerializerOptions Json = new()
    { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
    private static readonly HashSet<string> ScriptHosts = new(StringComparer.OrdinalIgnoreCase)
    { "cmd.exe", "powershell.exe", "pwsh.exe", "wscript.exe", "cscript.exe", "mshta.exe", "rundll32.exe", "regsvr32.exe", "wmic.exe", "node.exe", "npm.exe", "npx.exe", "python.exe", "python3.exe", "perl.exe", "ruby.exe" };
    internal static RunRequest Parse(string line)
    {
        if (Encoding.UTF8.GetByteCount(line) > 65536) throw new InvalidDataException("Request too large.");
        var value = JsonSerializer.Deserialize<RunRequest>(line, Json) ?? throw new InvalidDataException("Missing request.");
        if (value.Version != 1 || value.TimeoutMs is < 100 or > 120000 || value.MaxOutputBytes is < 1024 or > 1048576) throw new InvalidDataException("Invalid protocol limits.");
        if (value.Args is null || value.Args.Length > 64 || value.Args.Any(arg => arg is null || arg.IndexOf('\0') >= 0 || arg.Length > 4096)) throw new InvalidDataException("Invalid argument vector.");
        if (value.ExecutableSha256 is null || value.ExecutableSha256.Length != 64 || value.ExecutableSha256.Any(c => !Uri.IsHexDigit(c))) throw new InvalidDataException("Expected executable SHA-256 is required.");
        ValidatePath(value.Executable, false); ValidatePath(value.WorkspaceRoot, true); ValidatePath(value.WorkingDirectory, true);
        if (!value.Executable.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) || ScriptHosts.Contains(Path.GetFileName(value.Executable))) throw new InvalidDataException("Only approved native .exe tools; known shell/script-host names are unsupported.");
        var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(value.WorkspaceRoot));
        var cwd = Path.TrimEndingDirectorySeparator(Path.GetFullPath(value.WorkingDirectory));
        if (root.Equals(Path.GetPathRoot(root), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Choose a project folder, not a drive root.");
        if (!cwd.Equals(root, StringComparison.OrdinalIgnoreCase) && !cwd.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Working directory must remain in the selected workspace.");
        if (BuildCommandLine(value).Length >= 30000) throw new InvalidDataException("Command line too large.");
        return value;
    }
    internal static void ValidatePath(string? value, bool directory)
    {
        if (value is null || value.Length is < 3 or > 240 || value.Any(char.IsControl) || !char.IsAsciiLetter(value[0]) || value[1] != ':' || value[2] != '\\' || value[3..].Contains(':') || value.Contains('/')) throw new InvalidDataException("Use a bounded absolute local drive path.");
        var full = Path.GetFullPath(value);
        if (!Path.TrimEndingDirectorySeparator(full).Equals(Path.TrimEndingDirectorySeparator(value), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Path must be normalized.");
        if (directory ? !Directory.Exists(full) : !File.Exists(full)) throw new InvalidDataException("Selected path is unavailable.");
        for (string? item = full; item is not null; item = Path.GetDirectoryName(Path.TrimEndingDirectorySeparator(item)))
        {
            if ((File.GetAttributes(item) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("Reparse-point paths are not accepted.");
            if (Path.GetPathRoot(item)?.Equals(item, StringComparison.OrdinalIgnoreCase) == true) break;
        }
    }
    internal static FileStream LockAndVerifyExecutable(RunRequest value)
    {
        var stream = new FileStream(value.Executable, FileMode.Open, FileAccess.Read, FileShare.Read);
        try { if (!Convert.ToHexString(SHA256.HashData(stream)).Equals(value.ExecutableSha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Executable changed after approval."); return stream; }
        catch { stream.Dispose(); throw; }
    }
    // Windows CRT argv quoting: double backslashes before a quote or closing delimiter.
    internal static string Quote(string arg)
    {
        var result = new StringBuilder("\""); int slashes = 0;
        foreach (char c in arg) { if (c == '\\') { slashes++; continue; } if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append('"'); } else { result.Append('\\', slashes); result.Append(c); } slashes = 0; }
        result.Append('\\', slashes * 2); return result.Append('"').ToString();
    }
    internal static string BuildCommandLine(RunRequest value) => string.Join(" ", new[] { value.Executable }.Concat(value.Args).Select(Quote));
    internal static string MinimalEnvironment(string temporary)
    {
        var buffer = new StringBuilder(260); uint length = Native.GetWindowsDirectoryW(buffer, 260);
        if (length == 0 || length >= 260) throw new InvalidDataException("Windows directory unavailable.");
        // Never inherit parent environment, PATH, COMSPEC, provider keys or proxy settings.
        var entries = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        { ["SystemRoot"] = buffer.ToString(), ["WINDIR"] = buffer.ToString(), ["TEMP"] = temporary, ["TMP"] = temporary };
        return string.Join("\0", entries.Select(item => $"{item.Key}={item.Value}")) + "\0\0";
    }
}
