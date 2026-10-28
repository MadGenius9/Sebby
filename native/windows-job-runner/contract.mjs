import path from "node:path";
export const WINDOWS_JOB_RUNNER_ENABLED = false;
export const PROTOCOL_VERSION = 1;
const hosts = new Set([
  "cmd.exe",
  "powershell.exe",
  "pwsh.exe",
  "wscript.exe",
  "cscript.exe",
  "mshta.exe",
  "rundll32.exe",
  "regsvr32.exe",
  "wmic.exe",
  "node.exe",
  "npm.exe",
  "npx.exe",
  "python.exe",
  "python3.exe",
  "perl.exe",
  "ruby.exe",
]);
const keys = [
  "version",
  "executable",
  "executableSha256",
  "args",
  "workspaceRoot",
  "workingDirectory",
  "timeoutMs",
  "maxOutputBytes",
];
function localPath(value) {
  if (
    typeof value !== "string" ||
    value.length < 3 ||
    value.length > 240 ||
    /[\x00-\x1f\x7f]/.test(value) ||
    !/^[a-zA-Z]:\\/.test(value) ||
    value.slice(3).includes(":") ||
    value.includes("/")
  )
    throw Error("Expected bounded absolute local-drive path.");
  const trim = (x) => (x.length > 3 ? x.replace(/\\$/, "") : x);
  if (
    trim(path.win32.normalize(value)).toLowerCase() !==
    trim(value).toLowerCase()
  )
    throw Error("Expected normalized path.");
  return trim(value);
}
export function quoteWindowsArg(arg) {
  if (typeof arg !== "string" || arg.includes("\0"))
    throw Error("Invalid argument.");
  let result = '"',
    slashes = 0;
  for (const c of arg) {
    if (c === "\\") {
      slashes++;
      continue;
    }
    if (c === '"') result += "\\".repeat(slashes * 2 + 1) + '"';
    else result += "\\".repeat(slashes) + c;
    slashes = 0;
  }
  return result + "\\".repeat(slashes * 2) + '"';
}
/** Pure IPC-shape validation only. Does not check disk paths, execute, approve, or enable the helper. */
export function validateProtocolRequest(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(input, key))
  )
    throw Error("Invalid request fields.");
  if (
    input.version !== 1 ||
    !Number.isInteger(input.timeoutMs) ||
    input.timeoutMs < 100 ||
    input.timeoutMs > 120000 ||
    !Number.isInteger(input.maxOutputBytes) ||
    input.maxOutputBytes < 1024 ||
    input.maxOutputBytes > 1048576
  )
    throw Error("Invalid request limits.");
  const executable = localPath(input.executable),
    root = localPath(input.workspaceRoot),
    cwd = localPath(input.workingDirectory);
  if (
    !executable.toLowerCase().endsWith(".exe") ||
    hosts.has(path.win32.basename(executable).toLowerCase())
  )
    throw Error("Shell/script hosts are unsupported.");
  if (root.length === 3)
    throw Error("Choose a project directory, not drive root.");
  if (
    cwd.toLowerCase() !== root.toLowerCase() &&
    !cwd.toLowerCase().startsWith(root.toLowerCase() + "\\")
  )
    throw Error("Working directory escapes selected workspace.");
  if (
    typeof input.executableSha256 !== "string" ||
    !/^[a-fA-F0-9]{64}$/.test(input.executableSha256)
  )
    throw Error("Expected approved executable hash.");
  if (
    !Array.isArray(input.args) ||
    input.args.length > 64 ||
    input.args.some(
      (arg) =>
        typeof arg !== "string" || arg.includes("\0") || arg.length > 4096,
    )
  )
    throw Error("Invalid argument vector.");
  if (
    [executable, ...input.args].map(quoteWindowsArg).join(" ").length >=
      30000 ||
    Buffer.byteLength(JSON.stringify(input)) > 65536
  )
    throw Error("Request too large.");
  return structuredClone(input);
}
