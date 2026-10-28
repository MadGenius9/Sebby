import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  WINDOWS_JOB_RUNNER_ENABLED,
  validateProtocolRequest,
  quoteWindowsArg,
} from "../native/windows-job-runner/contract.mjs";
const sample = {
  version: 1,
  executable: "C:\\Tools\\TrustedTool.exe",
  executableSha256: "a".repeat(64),
  args: ["--version"],
  workspaceRoot: "C:\\Projects\\Sample",
  workingDirectory: "C:\\Projects\\Sample",
  timeoutMs: 10000,
  maxOutputBytes: 65536,
};
test("Windows helper remains disabled and pure contract does not execute anything", () => {
  assert.equal(WINDOWS_JOB_RUNNER_ENABLED, false);
  const checked = validateProtocolRequest(sample);
  assert.deepEqual(checked, sample);
  checked.args.push("changed");
  assert.equal(sample.args.length, 1);
});
test("protocol rejects paths, script hosts, environment injection and limits", () => {
  for (const patch of [
    { executable: "cmd.exe" },
    { executable: "C:\\Windows\\System32\\cmd.exe" },
    { executable: "C:\\Tools\\node.exe" },
    { executable: "C:\\Tools\\npm.cmd" },
    { executable: "\\\\server\\share\\x.exe" },
    { executable: "C:\\Tools\\..\\x.exe" },
    { workingDirectory: "C:\\Projects\\SampleOther" },
    { workspaceRoot: "C:\\", workingDirectory: "C:\\" },
    { args: ["a\0b"] },
    { args: Array(65).fill("a") },
    { timeoutMs: 120001 },
    { maxOutputBytes: 1048577 },
    { executableSha256: "unverified" },
    { environment: { OPENAI_API_KEY: "never" } },
    { shell: true },
    { approved: true },
  ])
    assert.throws(() => validateProtocolRequest({ ...sample, ...patch }));
});
test("argument quoting covers empty, spaces, quotes and trailing slashes as data", () => {
  assert.equal(quoteWindowsArg(""), '""');
  assert.equal(quoteWindowsArg("a b"), '"a b"');
  assert.equal(quoteWindowsArg('x"y'), '"x\\"y"');
  assert.equal(quoteWindowsArg("C:\\path\\"), '"C:\\path\\\\"');
  assert.equal(quoteWindowsArg("& whoami"), '"& whoami"');
});
test("source policy creates suspended in atomic job and verifies before resume; no breakaway fallback", async () => {
  const source = await fs.readFile(
    new URL("../native/windows-job-runner/Program.cs", import.meta.url),
    "utf8",
  );
  const native = await fs.readFile(
    new URL("../native/windows-job-runner/Native.cs", import.meta.url),
    "utf8",
  );
  assert.ok(
    source.indexOf("PROC_THREAD_ATTRIBUTE_JOB_LIST") <
      source.indexOf("Native.CreateProcessW"),
  );
  assert.ok(
    source.indexOf("Native.IsProcessInJob") <
      source.indexOf("Native.ResumeThread"),
  );
  assert.match(source, /Native\.CREATE_SUSPENDED/);
  assert.match(source, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(source, /PROC_THREAD_ATTRIBUTE_HANDLE_LIST/);
  assert.match(source, /Marshal\.WriteIntPtr\(handles, 0, stdinRead/);
  assert.ok(!source.includes("WriteIntPtr(handles, job"));
  assert.ok(!native.includes("BREAKAWAY"));
  assert.ok(!source.includes("Process.Start"));
  assert.match(source, /Native\.TerminateJobObject/);
});
test("source limits output, credentials, working paths and destructive cleanup", async () => {
  const source = await fs.readFile(
      new URL("../native/windows-job-runner/Program.cs", import.meta.url),
      "utf8",
    ),
    contract = await fs.readFile(
      new URL("../native/windows-job-runner/Contract.cs", import.meta.url),
      "utf8",
    );
  assert.match(source, /outcome = "output-limit"/);
  assert.match(source, /outcome = "timed-out"/);
  assert.match(source, /line is null \|\| line == "cancel"/);
  assert.match(source, /Directory\.Delete\(temporary, false\)/);
  assert.ok(!source.includes("Directory.Delete(temporary, true)"));
  assert.match(contract, /FileShare\.Read/);
  assert.match(contract, /SHA256\.HashData/);
  assert.match(contract, /FileAttributes\.ReparsePoint/);
  assert.ok(!contract.includes("GetEnvironmentVariables"));
  assert.match(contract, /\["SystemRoot"\]/);
  assert.match(contract, /\["TEMP"\]/);
});
test("source-only project targets current LTS and has no released binary or app integration", async () => {
  const csproj = await fs.readFile(
    new URL(
      "../native/windows-job-runner/Sebby.JobRunner.csproj",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(csproj, /<TargetFramework>net10\.0-windows/);
  const files = await fs.readdir(
    new URL("../native/windows-job-runner/", import.meta.url),
  );
  assert.ok(!files.some((file) => /\.(exe|dll|pdb)$/i.test(file)));
  const main = await fs.readFile(
    new URL("../electron/main.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(!main.includes("windows-job-runner"));
});
