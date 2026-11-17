# Retained builds and sandbox previews

## User workflow

After a configured isolated worker successfully runs a project's build script, open **Runs**, select that run, and inspect **Build outputs**. The panel reports the saved revision, output folder, file count and size. Download the complete ZIP or individual files, or prepare a sandbox preview when the output contains `index.html`.

The source editor preview remains a separate feature. **Preview saved build** uses the files retained from that specific run, even if the project's current source has since changed. A build exit code, a retained file set and a visually verified application are different outcomes. API metadata reports `previewVerified: false`; this increment does not certify a working UI.

## Collection and persistence

The default output folder is `dist`. Set `sebby.outputDirectory` in the project's package.json for another relative folder. Traversal, absolute paths, reserved components, case/prefix collisions, Windows device names and trailing dots/spaces are refused.

The guest collects files before it exits because its workspace is temporary. Child build stdout/stderr go to the run log stream; a separate bounded stdout payload transfers outputs. Only regular files under the output folder are collected. Links, special files and out-of-bounds file descriptors are rejected. The collector checks opened descriptors under `/proc/self/fd`, uses no-follow/nonblocking opens, bounds reads and hashes observed bytes. This reduces path-swap exposure; output content remains untrusted project data.

Limits are 200 files, 2 MiB per file, 8 MiB total bytes, 512 traversed entries and 12 MiB transfer size. There is no archive extraction onto the application host. The server validates paths, canonical base64, hashes and total size, then stores file bytes in SQLite. Retained outputs and terminal run state commit in the same transaction only after exit code zero and verified container cleanup. Failed, cancelled, interrupted, invalid and cleanup-unverified runs expose no partial output set.

The manifest binds files to the run, saved revision, source hash, image digest and dependency lock hash. File hashes and a canonical manifest hash support integrity checks. ZIP downloads contain validated relative paths and regular files, with no compression to avoid unnecessary server CPU. All endpoints require the run owner's session. Raw HTML, SVG and JavaScript files are attachments, never executable documents on Sebby's origin.

## Sandbox preview preparation

The preview compiler reads only retained files through a virtual esbuild plugin. It does not execute project code on the server, read a project config, resolve host packages, fetch remote modules or publish files. Known module imports are bundled into an IIFE, CSS/local assets are inlined, and the resulting document is delivered as authenticated JSON for an iframe with `sandbox="allow-scripts"` and no same-origin permission. CSP restricts external resources and API fetches.

Compilation is limited to one preview job at a time, ten seconds, 48 bundle operations and a 16 MiB document budget. Unsupported or missing resources produce a visible error. The initial path supports self-contained static frontends with one module entry. It rejects unbundled package imports, external modules, import.meta-dependent builds and multiple module entries. Runtime-created asset URLs, SPA URL routing, SSR, backend APIs, workers and complex framework runtimes require separate preview hosting. CSP/iframe restrictions are not a guarantee against every outbound self-navigation.

This is a private sandbox preview, not a deployment or production preview host. No new cloud account, public endpoint or paid service is configured.

## Agent interface

`project_build_outputs` returns the owner-scoped retained manifest for an assigned project's run. It never returns unrestricted host paths or binary payloads. Agents must compare the manifest's revision with the task's intended revision and must not call `previewCandidate` proof of visual correctness.

## Verification and remaining work

57 tests pass. Collector tests use real temporary files, links and size limits. Persistence/auth/download tests use explicit runner fixtures; a CLI fixture checks actual Docker adapter stream handling without running Docker. A trusted authored React/Vite project is built on the test host and its retained modules/CSS are prepared for preview. This is not a host-execution fallback for user projects. A small trusted module fixture is exercised against a minimal test DOM; no visual browser pass is claimed.

The built-server HTTP smoke uses disposable seeded output records to verify manifest, ZIP and preview delivery. The subsequent real rootless worker check passed base-image output transfer/cleanup (run 44012435801); the mesh fixture also passed Blender import. Live model use, retained-build panel interaction, framework routing and production preview origin/network isolation remain release work. Existing data backups should now include build-output BLOBs; retention/deletion controls are not implemented yet.
