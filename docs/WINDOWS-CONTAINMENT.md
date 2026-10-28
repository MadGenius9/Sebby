# Windows process lifetime containment — disabled source prototype

**Status: source-only. Not compiled, not native-tested, not connected to Sebby's runtime/UI, and not permission to execute Windows npm scripts.** The current environment is Linux and has neither `dotnet` nor `csc`. Six Node tests exercise the pure protocol contract and static source assertions. They do not prove C# compilation, P/Invoke ABI correctness, process-tree termination, Windows paths, or race behavior.

## Intended boundary

The helper implements a narrow, opt-in process **lifetime/resource supervisor**, not a security sandbox. It does not restrict filesystem access, network access, registry access, same-user credentials, or communication with other processes. Approved executables and their descendants run with the current user's ordinary token. Processes launched indirectly through external brokers (for example WMI), duplicated handles, other privileged software and hostile same-user interference are outside this guarantee. Microsoft specifically documents that ordinary child processes inherit job association but some indirect creation mechanisms do not. [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)

A denylist of shell/script-host names is an accidental-use guard and defense in depth, **not proof that an arbitrary executable is safe**. A renamed interpreter or the approved executable itself can execute arbitrary code; the hash binds a selected binary, not its semantic behavior. The eventual main-process caller must select an exact trusted executable, validate its release/hash, construct an allowlisted argument vector, show a complete native command/project-trust approval, and enforce user opt-in. No renderer-selected executable, environment map, shell string or “approved” boolean can be forwarded as authority.

## Implemented source design

- An unnamed, non-inheritable job handle is created with kill-on-last-close, a 32-active-process limit, and a fixed 1 GiB job committed-memory limit. No breakaway flags are enabled. [Microsoft job limit definitions](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information)
- `STARTUPINFOEX` carries **both** the explicit inherited-handle list and `PROC_THREAD_ATTRIBUTE_JOB_LIST`. Job membership is assigned during process creation, avoiding the separate create-then-assign gap. The child is also created suspended, membership is checked with `IsProcessInJob`, and only then is its primary thread resumed. Unsupported job-list attributes, nested-job restrictions or failed assignment fail closed—there is no uncontained retry/fallback. [Microsoft's atomic job-list explanation](https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812%2F)
- Only the child's stdin-read/stdout-write/stderr-write pipe handles are inherited. The job handle and parent-side pipe handles are **not** in the handle allowlist. Child stdin is EOF, not the supervisor's control protocol. [Microsoft inherited handle-list contract](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute), [redirected child I/O guidance](https://learn.microsoft.com/en-us/windows/win32/procthread/creating-a-child-process-with-redirected-input-and-output)
- `CreateProcessW` receives a non-null absolute `lpApplicationName` and a separately quoted argument vector. The helper itself does not invoke PATH search, `cmd.exe`, PowerShell, npm shims or shell expansion. Argument quoting follows the Windows CRT convention; a tool with a custom command-line parser still needs exact native argument tests. [Microsoft CreateProcessW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw)
- The executable must match the caller-supplied approved SHA-256 and is held open without write/delete sharing while the child runs. Local absolute normalized paths are checked for reparse points; working directory must be within the selected project and a drive-root workspace is refused. These checks do not eliminate all hostile filesystem races.
- Child environment is constructed from scratch: only OS-derived `SystemRoot`/`WINDIR` and a unique project-local scratch directory for `TEMP`/`TMP`. No parent environment, PATH, COMSPEC, API keys, proxy settings or arbitrary user map is inherited. The future main process must also sanitize the **helper's own** environment, not merely rely on child sanitization.
- Timeout, explicit cancellation, input EOF/malformed input, output overflow, root-process exit, helper failure and last job-handle closure terminate the job. Root exit intentionally kills still-running ordinary descendants. Pipe reads use bounded polling; data is captured in memory, not emitted while the child runs, preventing output backpressure from blocking timeout/cancellation supervision. A bounded two-second post-stop drain reports whether pipe drainage actually finished.
- Temp cleanup deletes only an empty helper-created directory. Nonempty tool scratch is retained for user review, never recursively removed.

The job-list approach establishes assignment before user code is resumed. This document does not claim exhaustive proof for every Windows crash micro-step, broker mechanism or adversarial handle duplication. Native tests must specifically cover supervisor termination during creation and after resume.

## Trusted-main protocol

The future caller must keep this feature disabled until a reviewed native helper release is validated. The pure JS `contract.mjs` exports `WINDOWS_JOB_RUNNER_ENABLED = false` and never spawns anything.

An explicitly enabled helper would be started with exactly `--enable-reviewed-native-run`. That flag is an engineering guard, not a substitute for native user approval or an authenticated policy boundary.

The first UTF-8 stdin line (maximum 64 KiB, required within ten seconds) is:

```json
{
  "version": 1,
  "executable": "C:\\TrustedTools\\ApprovedTool.exe",
  "executableSha256": "<64 hex characters from approved executable>",
  "args": ["--version"],
  "workspaceRoot": "C:\\Projects\\SelectedProject",
  "workingDirectory": "C:\\Projects\\SelectedProject",
  "timeoutMs": 10000,
  "maxOutputBytes": 65536
}
```

The schema and pure validator reject unknown fields. Limits: 64 arguments, 4096 UTF-16 characters each, combined quoted command below 30,000 characters, 100–120,000 ms timeout and 1024–1,048,576 captured bytes across stdout and stderr. Only normalized drive-local `.exe` paths are supported; UNC/device paths, reparse points, drive roots, `.cmd`/`.bat`, shell hosts and common script hosts are refused. A selected file's fingerprint is mandatory.

Keep stdin open while running. Write `cancel\n` to stop; EOF or any malformed later control line also cancels. Supervisor stdout contains only JSON lines:

- `started`: PID, verified membership flag and fixed/requested limits. This means the native call sequence passed in **that run**, not that the overall software is certified.
- `finished`: `outcome` (`exited`, `cancelled`, `timed-out`, `output-limit`), child `exitCode` when available, captured byte count, truncation/drain flags, elapsed time, bounded `stdoutBase64` and `stderrBase64`. There are no live raw-output events. Decode only as untrusted display data; never commands or HTML. The final encoded line can approach 1.4 MiB, so the caller must allow a bounded 2 MiB response line and continuously drain helper stdout.
- `error`: bounded generic error or native operation name/code; no request/credential echo. Helper exit 2 is rejected/failed request and exit 3 is a native API failure. Exit 0 means a terminal supervision result was emitted, **not** that the child succeeded; inspect child exit code/outcome.

The caller must retain the helper process handle, close input/kill the helper if its own deadline expires, and wait for terminal evidence rather than treating UI cancellation as proof of process death. Killing a validated supervisor should close the last private job handle; verify this natively before relying on it.

## npm and script decision remains open

Windows `npm.cmd` normally needs a shell, and npm scripts may execute arbitrary project/dependency code. This helper refuses that route; do not substitute `cmd /c`, PowerShell, `node npm-cli.js`, renamed script hosts or inherited shell paths. A future npm-specific runner decision needs separate threat review, explicit trusted-project consent, native validation and honest disclosure that Job Objects are not a filesystem/network sandbox. Windows npm stays disabled.

## Required Windows validation before any enablement

1. Compile with supported .NET 10 SDK; review P/Invoke struct sizes/signatures and x64 behavior. The project targets .NET 10 LTS rather than .NET 8, which reaches end of support in November 2026. [Microsoft support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core)
2. Run purpose-built benign native fixtures in temporary projects: root exit, ordinary child/grandchild trees, blocked stdout/stderr, Unicode/quoted/trailing-backslash arguments, zero/negative-like data, working-directory isolation, and nonzero exits.
3. Prove native cancellation, timeout, output-cap and supervisor-termination tests leave no tracked descendants—including kill during creation/assignment/resume. Test external inherited-job restrictions and confirm fail-closed behavior.
4. Inspect child environment and inherited handles: no provider key/proxy/parent control handle/job handle. Test stdin EOF and parent disappearance.
5. Test executable replacement protection, hash mismatch, reparse/junction traversal, malformed JSON, size bounds and approved executable mutation attempts. Validate architecture and supported Windows builds.
6. Review indirect process-creation and handle-duplication limitations. Do not call this a malicious-code sandbox.
7. Produce a signed/pinned reviewed helper artifact, rerun tests against that exact binary, and explicitly opt in in main-process policy. Only then consider separately authorized UI integration.

No SDK, binary, service, account connection, native test, permission escalation or runtime integration was performed for this checkpoint.

## Manual offline fixture harness (source only; NOT RUN)

A separately reviewed Windows test host can use `scripts/test-job-runner-windows.ps1`. The script is not an npm command, an Actions workflow, an installer, or app startup code. It never enables Sebby's runner policy. **This workspace has not executed or compiled the harness/fixture/helper, and passing Node source assertions is not a native acceptance result.**

Prerequisites: 64-bit Windows, PowerShell 7+, an already installed stable .NET 10 SDK and all required local framework/apphost packs. The script pins a discovered installed 10.x SDK in its temporary `global.json`, clears NuGet sources/fallback folders, supplies an empty local feed, disables auditing/workload update checks, and builds with `--no-restore` after the offline restore step. Reusable MSBuild nodes/servers and shared compiler processes are disabled for owned SDK commands. Both SDK and helper processes receive a cleared environment with only fixed Windows/temp/CLI settings—no inherited provider/GitHub/signing keys, proxies or startup hooks. The package cache is isolated inside the temporary root. Directory.Build props/targets and Directory.Packages imports are disabled, with fixed empty files at the root to prevent ancestor discovery. Missing packs cause failure; it does not install an SDK, download dependencies, modify system settings or fall back to an online feed. Resolve missing prerequisites separately rather than weakening those guards.

After reading the source, the operator can explicitly choose to execute:

```powershell
pwsh -NoProfile -File .\scripts\test-job-runner-windows.ps1 -RunNativeFixtures
```

No execution-policy bypass, elevation or service installation is requested. Omitting the opt-in flag fails before native work.

The harness creates a unique temporary directory, copies only the helper's fixed C# source/project and a benign fixture template, and compiles within that directory. `fixtures/Program.cs.txt` deliberately is not a `.cs` file in the source tree, so the main helper's recursive compile glob does not accidentally include a second entry point. It becomes `Program.cs` only in the isolated fixture build directory.

Seven cases inspect actual protocol/exit evidence when run:

- successful stdout/stderr and exit 0;
- nonzero fixture exit 23;
- bounded timeout;
- explicit cancellation with child and grandchild;
- parent-input EOF with child and grandchild;
- output overflow/truncation;
- abrupt supervisor termination with child and grandchild, killing **only** the supervisor at the assertion stage so recursive parent cleanup cannot mask a failed kill-on-job-close test.

Tree cases require three recorded fixture identities before cancellation. Identity records include exact executable, PID and process-start ticks; assertions verify those processes disappear. A reused PID is not killed as a fixture. Each benign fixture also has an independent 60-second exit watchdog. The work phase has a 300-second global deadline, each SDK command a 90-second bound, helper waits a 10-second bound, and post-exit pipe/descendant checks a 5-second bound. Cleanup may add bounded per-owned-process waits. Child output is bounded by the helper request; harness drains stdout/stderr concurrently and rejects oversized diagnostics after collection, but its `ReadToEndAsync` capture is not a streaming-memory sandbox for a maliciously modified SDK/helper.

`finally` cleans only created process handles, identity-checked fixture processes and the exact random temporary directory. It never kills by name or system-wide PID lists. Source-only fixtures do not create junctions or mutate external files. Do not replace the fixture executable or introduce arbitrary user projects into this harness. The trusted test-host account/filesystem remains a boundary, not an adversarial-host guarantee.

The script prints a JSON result with case results, failure text and elapsed time, and returns nonzero on failure. Temporary build binaries/evidence are removed, so capture stdout yourself if keeping a validation record. It does not sign, publish, store secrets or retain an artifact for runtime integration.

Remaining tests beyond this harness include creation/assignment/resume race injection, inherited-job incompatibilities, exact inherited-handle auditing, hostile reparse/hardlink/executable replacement cases, malformed protocol stress, argument/environment isolation, Windows-version matrix, antivirus behavior, architecture/ABI review and signed artifact verification. The fixed fixtures are not malicious-code isolation proof. Every native item remains **NOT RUN** until the operator supplies actual Windows evidence; Windows npm and runtime integration remain disabled.
