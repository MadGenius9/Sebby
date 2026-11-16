# Coding runtime increment

## What is available without Docker

Create a **Web starter** project for dependency-free HTML/CSS/JavaScript, edit its files, save, and open **Preview**. Classic local scripts and stylesheets are bundled into a sandboxed iframe. Relative ES module imports and framework bundling are not supported by that preview.

Open **Changes** to compare saved revisions. Source changes use real Git diffs; scene/name changes are reported separately. Project JSON export now has a matching import control, which creates a new project rather than replacing the original. File removal can be undone within the current session.

## Worker configuration

The **Runs** tab reports worker readiness, lists persisted history, streams recorded output, and offers build/test/cancel controls. It starts no commands while the worker is unavailable. Docker and Git must be installed on the Linux server. This environment has Git but no Docker service; namespace isolation probing also failed. Real container execution has not been validated here.

Configure `SEBBY_RUNNER_IMAGE` to the full name and immutable SHA-256 digest of an image you have already provisioned on a dedicated **rootless Docker** worker. The daemon must support cgroup v2 and the resource limits used by the adapter. `SEBBY_DOCKER_BIN` optionally selects an absolute Docker CLI path (default `/usr/bin/docker`). `DOCKER_HOST` or `DOCKER_CONTEXT` can identify an operator-configured worker. No image is downloaded by the application.

The current adapter supports only dependency-free Node/npm projects, including the Web starter. The configured image must provide Node/npm and accept a non-root UID. Nonempty dependency declarations are rejected before dispatch. There is no automatic npm install or network during a run. Dependency provisioning, access to prebuilt dependency trees and matching project lockfiles are not implemented yet; this is not support for arbitrary existing projects.

`npm run workspace` still starts only the loopback development app. It is not production authentication, and this document does not authorize exposing that server publicly.

## Current contract

- The user saves the project and selects build or test. Only `npm run build` and `npm run test` are dispatched, inside the configured container.
- Each run captures the requested revision, source SHA-256, Git snapshot commit and configured image digest.
- Limits: 2 simultaneous runs globally, 1 per project, 120-second wall time, 64,000 log characters, 512 MB memory, 1 CPU, 128 PIDs, 64 MB workspace tmpfs and 32 MB temporary tmpfs.
- Container options include no network, read-only root, dropped capabilities, no-new-privileges and UID/GID 65532. No application or host project directory is mounted.
- Output is text, never trusted HTML or proof by itself. A success requires observed exit code 0 and verified container cleanup.
- Cancellation and limit failures have their own terminal states. If cleanup is unverified, the worker blocks new work and exposes the run's ID so an operator can inspect the named `sebby-<run-id>` container. Restart recovery attempts removal; it does not replay work.
- Snapshots and logs are private server data under the configured data directory. Back up and manage retention there. Git history in the public Sebby source repository contains no runtime project snapshots.

## Remaining work

Real Docker integration tests, user-facing snapshot restoration, build artifact retrieval, dependency images with lockfile validation, authenticated preview hosting, repository import, agent project tools and the complete AI edit/test/review loop are still pending. A Docker adapter plus passing test doubles does not certify hostile-code isolation or native worker operation.
