using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace Sebby.JobRunner;

internal static class Program
{
    private static void Require(bool success, string operation)
    { if (!success) throw new NativeFailure(operation, Marshal.GetLastWin32Error()); }
    private sealed class NativeFailure(string operation, int code) : Exception(operation)
    { internal int Code { get; } = code; }
    private static void Emit(object value) { Console.Out.WriteLine(JsonSerializer.Serialize(value, Contract.Json)); Console.Out.Flush(); }
    private static async Task<string?> ReadBoundedLine(int maximum)
    {
        var line = new StringBuilder(); var one = new char[1];
        while (true)
        {
            int count = await Console.In.ReadAsync(one.AsMemory());
            if (count == 0) return line.Length == 0 ? null : throw new InvalidDataException("Incomplete protocol line.");
            if (one[0] == '\n') return line.ToString().TrimEnd('\r');
            if (line.Length >= maximum) throw new InvalidDataException("Protocol line too long.");
            line.Append(one[0]);
        }
    }
    public static async Task<int> Main(string[] args)
    {
        Console.InputEncoding = new UTF8Encoding(false, true); Console.OutputEncoding = new UTF8Encoding(false);
        if (!OperatingSystem.IsWindows() || !Environment.Is64BitProcess || args.Length != 1 || args[0] != "--enable-reviewed-native-run")
        { Emit(new { type = "error", code = "disabled", message = "Source prototype requires explicit trusted-host opt-in on 64-bit Windows." }); return 2; }
        try
        {
            var reading = ReadBoundedLine(65536);
            if (await Task.WhenAny(reading, Task.Delay(10000)) != reading) throw new InvalidDataException("Initial request timeout.");
            var request = Contract.Parse(await reading ?? throw new InvalidDataException("Missing request."));
            var cancelled = new CancellationTokenSource(); // Single-invocation lifetime; input watcher may still be awaiting EOF.
            Console.CancelKeyPress += (_, eventArgs) => { eventArgs.Cancel = true; cancelled.Cancel(); };
            // EOF, malformed input or an explicit cancel means the trusted parent is gone/stopping.
            _ = Task.Run(async () => { try { string? line = await ReadBoundedLine(64); if (line is null || line == "cancel") cancelled.Cancel(); else cancelled.Cancel(); } catch { cancelled.Cancel(); } });
            return Supervise(request, cancelled.Token);
        }
        catch (NativeFailure error) { Emit(new { type = "error", code = "native-failure", operation = error.Message, win32Code = error.Code }); return 3; }
        catch { Emit(new { type = "error", code = "request-or-runtime-failed", message = "Runner rejected the request or failed closed. No automatic fallback is permitted." }); return 2; }
    }
    private static int Supervise(RunRequest request, CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var executableLock = Contract.LockAndVerifyExecutable(request);
        using var job = Native.CreateJobObjectW(IntPtr.Zero, null);
        Require(!job.IsInvalid, "CreateJobObjectW");
        var limits = new Native.EXTENDED_LIMITS
        {
            BasicLimitInformation = new Native.BASIC_LIMITS
            { LimitFlags = Native.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | Native.JOB_OBJECT_LIMIT_ACTIVE_PROCESS | Native.JOB_OBJECT_LIMIT_JOB_MEMORY, ActiveProcessLimit = 32 },
            JobMemoryLimit = (UIntPtr)(1024UL * 1024UL * 1024UL)
        };
        Require(Native.SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<Native.EXTENDED_LIMITS>()), "SetInformationJobObject");
        var security = new Native.SECURITY_ATTRIBUTES { Length = Marshal.SizeOf<Native.SECURITY_ATTRIBUTES>(), InheritHandle = true };
        Require(Native.CreatePipe(out var stdoutRead, out var stdoutWrite, ref security, 4096), "CreatePipe-stdout");
        using (stdoutRead) using (stdoutWrite)
        {
            Require(Native.CreatePipe(out var stderrRead, out var stderrWrite, ref security, 4096), "CreatePipe-stderr");
            using (stderrRead) using (stderrWrite)
            {
                Require(Native.CreatePipe(out var stdinRead, out var stdinWrite, ref security, 4096), "CreatePipe-stdin");
                using (stdinRead) using (stdinWrite)
                {
                    Require(Native.SetHandleInformation(stdoutRead, 1, 0), "Restrict-stdout-read-inheritance");
                    Require(Native.SetHandleInformation(stderrRead, 1, 0), "Restrict-stderr-read-inheritance");
                    Require(Native.SetHandleInformation(stdinWrite, 1, 0), "Restrict-stdin-write-inheritance");
                    stdinWrite.Dispose(); // Child stdin is EOF; it never receives the supervisor protocol/key environment.
                    string temporary = Path.Combine(request.WorkspaceRoot, ".sebby-run-" + Guid.NewGuid().ToString("N"));
                    Contract.ValidatePath(request.WorkspaceRoot, true);
                    Directory.CreateDirectory(temporary);
                    Contract.ValidatePath(temporary, true);
                    try { return CreateAndWait(request, job, stdoutRead, stdoutWrite, stderrRead, stderrWrite, stdinRead, temporary, cancellation); }
                    finally { try { Directory.Delete(temporary, false); } catch { /* Nonempty tool scratch remains for explicit user review; never recursively delete. */ } }
                }
            }
        }
    }
    private static int CreateAndWait(RunRequest request, KernelHandle job, KernelHandle stdoutRead, KernelHandle stdoutWrite, KernelHandle stderrRead, KernelHandle stderrWrite, KernelHandle stdinRead, string temporary, CancellationToken cancellation)
    {
        nuint listSize = 0; Native.InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref listSize);
        if (listSize == 0 || listSize > 65536) throw new InvalidDataException("Invalid attribute list size.");
        IntPtr attributes = Marshal.AllocHGlobal(checked((int)listSize));
        IntPtr handles = Marshal.AllocHGlobal(IntPtr.Size * 3), jobs = Marshal.AllocHGlobal(IntPtr.Size);
        IntPtr environment = Marshal.StringToHGlobalUni(Contract.MinimalEnvironment(temporary));
        bool initialized = false;
        try
        {
            Require(Native.InitializeProcThreadAttributeList(attributes, 2, 0, ref listSize), "InitializeProcThreadAttributeList"); initialized = true;
            Marshal.WriteIntPtr(handles, 0, stdinRead.DangerousGetHandle()); Marshal.WriteIntPtr(handles, IntPtr.Size, stdoutWrite.DangerousGetHandle()); Marshal.WriteIntPtr(handles, IntPtr.Size * 2, stderrWrite.DangerousGetHandle());
            Marshal.WriteIntPtr(jobs, job.DangerousGetHandle());
            Require(Native.UpdateProcThreadAttribute(attributes, 0, Native.PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handles, (nuint)(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero), "Restrict-inherited-handles");
            // Atomic job assignment during creation avoids a crash window between create and AssignProcessToJobObject.
            Require(Native.UpdateProcThreadAttribute(attributes, 0, Native.PROC_THREAD_ATTRIBUTE_JOB_LIST, jobs, (nuint)IntPtr.Size, IntPtr.Zero, IntPtr.Zero), "Assign-job-at-creation");
            var startup = new Native.STARTUPINFOEX
            {
                StartupInfo = new Native.STARTUPINFO { cb = Marshal.SizeOf<Native.STARTUPINFOEX>(), dwFlags = Native.STARTF_USESTDHANDLES, hStdInput = stdinRead.DangerousGetHandle(), hStdOutput = stdoutWrite.DangerousGetHandle(), hStdError = stderrWrite.DangerousGetHandle() },
                AttributeList = attributes
            };
            cancellation.ThrowIfCancellationRequested();
            Contract.ValidatePath(request.WorkspaceRoot, true); Contract.ValidatePath(request.WorkingDirectory, true);
            uint flags = Native.CREATE_SUSPENDED | Native.CREATE_UNICODE_ENVIRONMENT | Native.EXTENDED_STARTUPINFO_PRESENT | Native.CREATE_NO_WINDOW;
            Require(Native.CreateProcessW(request.Executable, new StringBuilder(Contract.BuildCommandLine(request)), IntPtr.Zero, IntPtr.Zero, true, flags, environment, request.WorkingDirectory, ref startup, out var child), "CreateProcessW");
            using var process = new KernelHandle(child.Process); using var thread = new KernelHandle(child.Thread);
            try
            {
                Require(Native.IsProcessInJob(process, job, out bool inJob) && inJob, "Verify-job-before-resume");
                cancellation.ThrowIfCancellationRequested();
                if (Native.ResumeThread(thread) == uint.MaxValue) throw new NativeFailure("ResumeThread", Marshal.GetLastWin32Error());
                stdoutWrite.Dispose(); stderrWrite.Dispose(); stdinRead.Dispose();
                Emit(new { type = "started", pid = child.ProcessId, verifiedJobMembership = true, limits = new { activeProcesses = 32, jobMemoryBytes = 1073741824, request.TimeoutMs, request.MaxOutputBytes } });
                return WaitAndPump(request, job, process, stdoutRead, stderrRead, cancellation);
            }
            finally { Native.TerminateJobObject(job, 1); } // Also on root exit: no detached descendants remain by design.
        }
        finally
        {
            if (initialized) Native.DeleteProcThreadAttributeList(attributes);
            Marshal.FreeHGlobal(attributes); Marshal.FreeHGlobal(handles); Marshal.FreeHGlobal(jobs); Marshal.FreeHGlobal(environment);
        }
    }
    private static int WaitAndPump(RunRequest request, KernelHandle job, KernelHandle process, KernelHandle stdout, KernelHandle stderr, CancellationToken cancellation)
    {
        using var stdoutCapture = new MemoryStream(); using var stderrCapture = new MemoryStream();
        var timer = Stopwatch.StartNew(); string? outcome = null; uint? exitCode = null; int captured = 0; bool truncated = false, stdoutEnded = false, stderrEnded = false; long stoppedAt = 0;
        while (true)
        {
            if (outcome is null)
            {
                if (cancellation.IsCancellationRequested) outcome = "cancelled";
                else if (timer.ElapsedMilliseconds >= request.TimeoutMs) outcome = "timed-out";
                else
                {
                    uint wait = Native.WaitForSingleObject(process, 0);
                    if (wait == Native.WAIT_OBJECT_0) { Require(Native.GetExitCodeProcess(process, out uint code), "GetExitCodeProcess"); exitCode = code; outcome = "exited"; }
                    else if (wait == Native.WAIT_FAILED) throw new NativeFailure("WaitForSingleObject", Marshal.GetLastWin32Error());
                }
                if (outcome is not null) { Require(Native.TerminateJobObject(job, 1), "TerminateJobObject"); stoppedAt = timer.ElapsedMilliseconds; }
            }
            Pump(stdout, stdoutCapture, request.MaxOutputBytes, ref captured, ref truncated, ref stdoutEnded);
            Pump(stderr, stderrCapture, request.MaxOutputBytes, ref captured, ref truncated, ref stderrEnded);
            if (truncated && outcome is null) { outcome = "output-limit"; Require(Native.TerminateJobObject(job, 1), "TerminateJobObject-output-limit"); stoppedAt = timer.ElapsedMilliseconds; }
            if (outcome is not null && ((stdoutEnded && stderrEnded) || timer.ElapsedMilliseconds - stoppedAt >= 2000)) break;
            Thread.Sleep(10);
        }
        Emit(new { type = "finished", outcome, exitCode, capturedBytes = captured, outputTruncated = truncated, drainComplete = stdoutEnded && stderrEnded, elapsedMs = timer.ElapsedMilliseconds, stdoutBase64 = Convert.ToBase64String(stdoutCapture.ToArray()), stderrBase64 = Convert.ToBase64String(stderrCapture.ToArray()) });
        return 0;
    }
    private static void Pump(KernelHandle pipe, MemoryStream capture, int maximum, ref int captured, ref bool truncated, ref bool ended)
    {
        if (ended) return;
        if (!Native.PeekNamedPipe(pipe, IntPtr.Zero, 0, IntPtr.Zero, out uint available, IntPtr.Zero))
        { int code = Marshal.GetLastWin32Error(); if (code is 109 or 232) { ended = true; return; } throw new NativeFailure("PeekNamedPipe", code); }
        if (available == 0) return;
        var buffer = new byte[Math.Min(available, 4096U)];
        Require(Native.ReadFile(pipe, buffer, (uint)buffer.Length, out uint read, IntPtr.Zero), "ReadFile-pipe");
        int permitted = Math.Min(checked((int)read), maximum - captured);
        if (permitted > 0) { capture.Write(buffer, 0, permitted); captured += permitted; }
        if (read > permitted) truncated = true;
    }
}
