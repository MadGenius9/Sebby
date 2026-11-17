# Coding runtime increment

## What is available without Docker

Create a **Web starter** project for dependency-free HTML/CSS/JavaScript, edit its files, save, and open **Preview**. Classic local scripts and stylesheets are bundled into a sandboxed iframe. Relative ES module imports and framework bundling are not supported by that preview.

Open **Changes** to compare saved revisions. Source changes use real Git diffs; scene/name changes are reported separately. Project JSON export now has a matching import control, which creates a new project rather than replacing the original. File removal can be undone within the current session.

## Worker configuration

The **Runs** tab reports worker readiness, lists persisted history, streams recorded output, and offers build/test/cancel controls. It starts no commands while the worker is unavailable. Docker and Git must be installed on the Linux server. This environment has Git but no Docker service; namespace isolation probing also failed. Real container execution has not been validated here.

Configure `SEBBY_RUNNER_IMAGE` to the full name and immutable SHA-256 digest of an image you have already provisioned on a dedicated **rootless Docker** worker. The daemon must support cgroup v2 and the resource limits used by the adapter. `SEBBY_DOCKER_BIN` optionally selects an absolute Docker CLI path (default `/usr/bin/docker`). `DOCKER_HOST` or `DOCKER_CONTEXT` can identify an operator-configured worker. No image is downloaded by the application.

Dependency-free projects use the base Node/npm image. Dependency-bearing projects require an exact matching prebuilt image as described below. Images must provide Node/npm and accept the non-root UID. There is no automatic package installation or network during a run; arbitrary existing projects are not yet supported.

`npm run workspace` still starts only the loopback development app. It is not production authentication, and this document does not authorize exposing that server publicly.

## Current contract

- The user saves the project and selects build or test. Only `npm run build` and `npm run test` are dispatched, inside the configured container.
- Each run captures the requested revision, source SHA-256, Git snapshot commit, configured image digest and optional dependency lock hash.
- Limits: 2 simultaneous runs globally, 1 per project, 120-second wall time, 64,000 log characters, 512 MB memory, 1 CPU, 128 PIDs, 64 MB workspace tmpfs and 32 MB temporary tmpfs.
- Container options include no network, read-only root, dropped capabilities, no-new-privileges and UID/GID 65532. No application or host project directory is mounted.
- Output is text, never trusted HTML or proof by itself. A success requires observed exit code 0 and verified container cleanup.
- Cancellation and limit failures have their own terminal states. If cleanup is unverified, the worker blocks new work and exposes the run's ID so an operator can inspect the named `sebby-<run-id>` container. Restart recovery attempts removal; it does not replay work.
- Snapshots and logs are private server data under the configured data directory. Back up and manage retention there. Git history in the public Sebby source repository contains no runtime project snapshots.

## Remaining work

Real Docker integration tests, user-facing snapshot restoration, native dependency-image validation, full separate-origin framework preview hosting, repository import and the complete live AI edit/test/review loop are still pending. Bounded build output retention/download and authenticated sandbox preview preparation are implemented; see V2-BUILD-OUTPUTS.md. A Docker adapter plus passing test doubles does not certify hostile-code isolation or native worker operation.

## Dependency-aware images

The adapter now selects a prebuilt dependency image when a project's npm declarations match its saved lockfile. Supported locks are npm versions 2 and 3 with root package metadata; linked dependencies and workspaces are refused. Nonempty dependencies without a matching lockfile are refused before dispatch.

The operator's `SEBBY_DEPENDENCY_IMAGES` is a JSON array of `{ "lockHash": "exact lowercase SHA-256", "image": "full digest-pinned image name" }` entries. There must be exactly one entry for the saved lockfile's raw-byte hash. Scripts can change without changing that hash; dependency declaration changes must agree with the lockfile. Whitespace changes in the lockfile deliberately change the fingerprint. No image is built or pulled by the runtime.

To prepare an image build context from a project JSON export:

```bash
node --import tsx scripts/prepare-dependencies.mts exported-project.json NEW_OUTPUT_DIRECTORY
```

This creates a new private directory containing only `package.json`, `package-lock.json`, a Dockerfile and `profile.json` with the lock hash. It refuses an existing destination. It does not install dependencies, run Docker, copy source files, or build an image. The included Dockerfile is an operator-only provisioning recipe: supply a trusted SHA-256-pinned Node base as `NODE_IMAGE`, review the manifests, build/publish the image on your worker, then register its resulting immutable digest with the lock hash. Provisioning network access is separate from execution; builds/tests still run with no network.

A dependency image must keep the exact lockfile at `/opt/sebby/package-lock.json` and dependencies at `/opt/sebby/node_modules`. Before a project command starts, the guest verifies both the supplied project lock and image lock against the expected hash and links that dependency tree into `/workspace`. The image root/dependency tree stays read-only. Packages requiring native postinstall steps, writable node_modules caches, private registries or workspace linking need additional provisioning work and are not certified by this increment. Container execution, including real React/Vite builds, remains unverified in this environment.
