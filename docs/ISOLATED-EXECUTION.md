# Isolated web execution — source and test-double track

**Live execution is unavailable.** No Docker, WSL, VM, daemon, image, runtime or dependency was installed, pulled, enabled, connected or executed for this track. `IsolationRunner.run()` always rejects. `status()` always reports `available:false`, `reason:native-engine-validation-required`. There is no production transport and no configuration flag that bypasses this gate. Unit tests prove local validation/lifecycle behavior with a fake transport, not container isolation.

The implemented local operations are reviewed file snapshot staging, hash verification, strict configuration persistence, bounded artifact quarantine and deterministic command construction exercised with test doubles. This is not yet “Sebby can build your app.”

## Main-process API

### Configuration

```js
const config = new IsolationConfig(userData, { approve: nativeConfirmation });
await config.load();
config.get(); // {configuration:null | {...}, available:false, reason, implementation}
await config.save({ cliPath, cliSha256, daemonEndpoint, image });
await config.verifyExecutable();
```

The store is `sebby-isolation.json`, with exact schema `{version:1,configuration}`. Default is unconfigured. Saving requires dedicated native confirmation and does not run an engine. The executable is an exact absolute local path and SHA-256; identity is rechecked before test runs. Local daemon choices are fixed to `npipe:////./pipe/docker_engine`, `unix:///var/run/docker.sock`, or `/run/user/<numeric uid>/docker.sock` via `unix://`. Remote TCP/SSH endpoints, tags, extra arguments, env fields and enabled flags are rejected. Image identity must be `name@sha256:<64 lowercase hex>`, not a floating tag. The current deliberately narrow repository syntax does not accept custom registry ports.

Hash/digest matching identifies bytes, **not safety or provenance**. Native setup must separately establish who built the image/CLI, what their code does and the actual daemon security boundary. Configuration is not backed up: restored metadata must not grant engine authority. It must not be included in installers. The local account and main process are trusted; a compromised host can replace application code or state.

### Reviewed source snapshot

```js
const snapshots = new WorkspaceSnapshot({ stagingRoot: privateOutsideProject, approve: nativeConfirmation });
const snapshot = await snapshots.prepare(selectedWorkspace, ['package.json', 'package-lock.json', 'src/main.ts']);
await snapshots.verify(snapshot.id);
await snapshots.dispose(snapshot.id);
```

Main owns all root paths and the native workspace selection. Renderer input may only select validated relative source paths. A snapshot requires `package.json` and a version 2/3 `package-lock.json`, at most 100 files, 512 KiB each and 5 MiB total. It records paths, byte counts, SHA-256 values and a manifest hash. Paths reject traversal, hidden files, secret-named files, credential extensions, dependencies/build output directories, symlinks/hardlinks, bidi/zero-width review controls and case collisions. These checks are **not a secret-content scanner**: a file named `src/config.ts` can still contain a credential. The user must review selected contents before staging or future execution.

Native consent includes the exact file manifest. Files are re-read and checked after consent; changes cause failure instead of silently sending new bytes. The service copies into a generated private staging directory outside the selected project, writes no project files, verifies staged hashes before use and rejects unexpected staged files. Records are in memory only; there is no automatic restore/replay of snapshots on restart. A maximum of three retained snapshot directories is enforced, including stale directories from previous sessions (at most 15 MiB of source bytes produced by this implementation, plus filesystem metadata). Stale directories are not auto-loaded or automatically deleted; they count against capacity until the user reviews/removes them separately. Private staging is not a storage backup and can contain sensitive project source. Explicit disposal handles only session-known IDs; `shutdown()` closes preparation, drains pending consent/work and disposes only session-known snapshots. Late consent after shutdown cannot create a snapshot. Unattended orphan cleanup is not implemented. Native filesystem race/reparse behavior still requires Windows validation; source checks are not a guarantee against an already compromised local account.

### Test-only recipe lifecycle

```js
const runner = new IsolationRunner({ config, snapshots, quarantineRoot: privateOutsideProject, approve: nativeConfirmation });
await runner.run(); // ALWAYS rejects: native execution unavailable
// Tests only; NEVER register this method or transport argument on IPC:
await runner.runWithTestTransport({ snapshotId, recipe: 'web-build', signal }, fakeTransport);
```

Only fixed recipes `web-build` and `web-test` exist. The test transport has `kind:'test-double'` and `execute({executable,args,environment,timeoutMs,maxOutputBytes,signal})`, returning `{exitCode,stdout,stderr}`. The kind marker is an API assertion, not a security sandbox. No renderer, model, skill or configuration can supply such a transport, and main must not expose the test entry point. Production functionality requires a separately reviewed implementation—not merely a different marker value.

The fixed argv plan creates an owned random-name/nonce container with:

- `--pull=never`: the approved image must already exist;
- explicit local endpoint and isolated empty CLI config directory, empty inherited environment;
- network none, IPC none, private cgroup namespace and default private process namespace;
- nonroot UID/GID 65532, read-only root filesystem, all capabilities dropped, no-new-privileges;
- 64-process limit, 512 MiB memory including equal swap limit, one CPU and bounded open files;
- a **read-only copied snapshot** bind mount at `/input`, never a live project, daemon socket, device, host namespace or arbitrary caller mount;
- bounded noexec/nosuid/nodev tmpfs at `/work` (512 MiB) and `/tmp` (64 MiB);
- fixed Node entrypoint and image-owned `/opt/sebby/runner.mjs`, no caller command or arguments;
- no restart policy and no daemon log persistence; attached output is bounded by the test transport/result validator.

The private host staging directory (0700) and files (0400) will generally not be readable by container UID 65532 through a Linux bind mount without an explicitly reviewed identity/mapping/delivery design. That native delivery issue remains unresolved: do not make source files world-readable or loosen permissions merely to get a passing build. The read-only mount argv is a tested intended policy, not evidence of a working image.

Docker's default seccomp policy is not independently established by these flags. A future engine validator must confirm an effective reviewed seccomp policy, Linux containers and all required isolation features before any production use. `noexec` deliberately prevents many native build products from executing; unsupported projects should fail, not silently weaken the boundary.

Lifecycle: create → verify ownership by full container ID **and** exact random name, nonce label and image reference → start/attach → verify ownership → wait → validate result → quarantine artifacts → reverify ownership → remove only that owned container. A returned ID alone is never cleanup authority. Partial create without verified identity, cancellation, timeout or ownership mismatch is recorded as uncertain; no global cleanup/retry/assumed rollback occurs. Creation is bounded to 15 seconds, attached execution to 60, and inspect/wait/cleanup operations to 5 seconds each. Cancellation/shutdown propagates to active test transport and attempts bounded owned cleanup. A misbehaving transport may outlive its promise deadline; this is another reason no unvalidated production transport is exposed.

## Required image recipe contract — NOT SUPPLIED OR VALIDATED

No image or image-build script is supplied in this checkpoint. The immutable approved image must contain an independently reviewed runner and **preprovisioned dependencies for the exact package-lock SHA-256**, not just a generic Node image. The runner must validate that lock match, copy reviewed `/input` into ephemeral `/work`, use only the baked dependency set, then invoke the fixed project's `build` or `test` script within the container. It must not run `npm install`/`npm ci` against the network, modify dependency declarations, accept arbitrary scripts/flags from main, or claim dependencies are locked without checking. Project scripts remain arbitrary project code; the proposed isolation boundary, not their names, limits them. A missing image, lock-specific dependency set or recipe must fail closed.

The image runner's sole stdout result must be a JSON object with exact fields:

```text
format: 'sebby-isolated-web-v1'
recipe: 'web-build' | 'web-test'
snapshotHash, lockSha256: approved hashes
exitCode: integer matching container wait status
logs: at most 64 KiB of inert, untrusted text
artifacts: [{path, base64, sha256}]
```

The wrapper must capture child logs instead of letting arbitrary project output forge this envelope. Digest trust includes that wrapper. Both envelope and artifact bytes are still treated as untrusted data by main.

## Artifact boundary

At most 20 regular-file artifacts, 256 KiB each / 1 MiB total, are decoded from canonical Base64 and checked against SHA-256. Only bounded relative HTML/CSS/JS/JSON/map/text/SVG/PNG paths are accepted. Unknown fields, links/devices, traversal, hidden paths and case collisions are rejected. No tar/ZIP extraction or Docker socket handoff exists. A future exporter must preserve these constraints rather than extract an arbitrary daemon archive directly onto the host.

Artifacts are written only into a generated quarantine directory outside the project and returned with `reviewRequired:true`; never auto-opened, executed, merged, published or copied back. HTML/JS/SVG can be active content: show them as inert text or use Sebby's separately reviewed static preview boundary. Applying a result later requires a dedicated diff review and native approval through development-file operations. Quarantine/history cleanup and artifact review UI are not implemented by this module.

## Daemon and VM trust boundary

Access to a rootful Docker daemon or Docker Desktop API can grant broad host/VM control. A local socket/named pipe is **not inherently safe**, and never belongs inside the container. Nonroot process flags cannot undo a compromised/misconfigured privileged daemon, malicious approved image or host kernel vulnerability. Rootless engine mode or a dedicated disposable VM may reduce risk, but neither has been selected or verified here. Container filesystems/resources/network policy are intended controls, not a certified hostile-code security sandbox.

Before a production adapter: validate engine identity/version and supported policy, establish explicit daemon/VM trust, audit the image/recipe/dependency cache, prove no-network and no-host-write behavior, verify cancellation/process-tree cleanup and output bounds natively, review artifact exporter handling, record exact hashes and obtain explicit user opt-in. Do not install/enable Docker, WSL, Hyper-V or download an image just to satisfy these prerequisites without separate authorization.

## Evidence

Local Node tests cover configuration defaults/unknown authority fields, native save refusal, real file staging and changed-source detection, sensitive paths/link rejection, fixed hardened command construction, verified owned cleanup, artifact validation and cancellation/shutdown with a test double. No container, CLI, daemon, VM, native recipe or actual app build/test was executed. The interface is deliberately unavailable for live execution until those gaps are closed.
