# Sebby isolated web recipe — unbuilt source

No image, cache or production executor has been built, pulled, installed or enabled. The desktop's production `IsolationRunner.run()` remains disabled. Importing `runner.mjs` is inert; tests inject a benign function that writes fixture files and never run npm/project scripts.

## Reviewed source contract

The image wrapper accepts one bounded JSON envelope on stdin:

```text
{format:'sebby-snapshot-v1', recipe:'web-build'|'web-test', snapshotHash, lockSha256,
 files:[{path,base64,sha256}]}
```

Main passes the same approved recipe/manifest/lock hashes and the exact wrapper source SHA-256 as fixed arguments. The wrapper verifies its own bytes at the explicit CLI entry point. Input is capped at 8 MiB encoded, 100 files, 512 KiB/file and 5 MiB decoded. Duplicate/prototype JSON keys, invalid Base64, traversal, links, hidden/secret-named paths, Unicode-normalization/case collisions and hash mismatches fail closed. It validates the complete envelope and exact cached lock before creating `/work/project`.

Host files never become container mounts. Snapshot files stay private on the host; selected bytes arrive on stdin, then regular files are written by UID 65532 inside tmpfs. This avoids making host staging world-readable or assuming host/container UID equivalence. Actual Docker/Windows stdin delivery, permissions and containment still require native proof.

Only the baked dependency cache `/opt/sebby/dependencies/<lockSHA>/` may supply dependencies. It must contain:

- `package-lock.json` with exactly that SHA-256;
- `sebby-cache.json`: `{format:'sebby-dependency-cache-v1',lockSha256,contractVersion:1}`;
- the independently reviewed `node_modules` tree for that exact lock, readable but **not writable** by UID 65532.

A trusted wrapper-authored link connects project `node_modules` to this cache. Input cannot supply that path/link. Hashing the lock alone does not prove installed dependencies match it: the image provisioning/audit pipeline must establish that relationship and review package provenance before approving the immutable image. No dependency cache or resolver is supplied here; unsupported locks fail, never trigger installation.

The fixed executor invokes `/usr/local/bin/node` with `/usr/local/lib/node_modules/npm/bin/npm-cli.js run build|test --offline --ignore-scripts`, a fixed cwd, and an explicit minimal environment. It never invokes npm install/ci. Explicit npm scripts are still arbitrary code, and npm may use a shell internally; `--offline` and `--ignore-scripts` are **not** a security boundary. The outer future validated container/VM controls are essential. npm documents that explicitly requested scripts still run with `ignore-scripts`, while pre/post hooks are suppressed. [npm run-script documentation](https://docs.npmjs.com/cli/v10/commands/npm-run-script/) Network remains disabled by the planned outer adapter.

Child stdout and stderr each have a 32 KiB streaming limit, 64 KiB aggregate, a 45-second executor deadline and a bounded kill grace. Process-group termination is attempted on timeout/overflow and root exit; it does not prove all descendants died (for example, a child can create another session). The outer adapter must bound the whole container, verify it stopped and remove only its owned identity. Same-UID hostile project code can attack the wrapper/process output; its JSON is untrusted evidence, not authenticated build provenance or a sandbox certificate.

Successful builds collect regular artifacts from `dist`; tests use `test-results`. Collection iterates directories (200 entries, depth 16), rejects links/hardlinks/collisions/unknown file types, and bounds files to 20 / 256 KiB each / 1 MiB aggregate. File identity/size is checked around bounded reads. The wrapper's result contains contract version, wrapper SHA, approved hashes, exit code, inert logs and Base64 artifacts. Main validates that protocol and must confirm the container stopped before writing quarantine files. Nothing auto-opens or copies artifacts to a host project.

The explicit CLI entry point requires Linux, UID 65532 and `--reviewed-container-wrapper` plus fixed hash/recipe arguments. These checks prevent casual accidental invocation, not malicious host use. The wrapper alone is not a sandbox. Main production execution remains unavailable regardless of entry-point flags.

## Dockerfile source template — not a build instruction

`Dockerfile.source` deliberately has no default `BASE_IMAGE` and expects a dependency directory that is not provided. No invented base digest appears in source. A future authorized build process must first validate an audited Linux Node base **by immutable digest**, verify fixed Node/npm paths, review the wrapper/cache bytes, set `WRAPPER_SHA256`, and confirm root ownership/read-only cache files plus image labels. The template itself does not enforce that a manually supplied base argument is a digest; the future approved build pipeline must do so. Do not substitute a floating tag or fetch packages to make the template build.

The image must expose labels `dev.sebby.contract-version=1` and `dev.sebby.wrapper-sha256=<source SHA>`. The mocked desktop plan checks immutable image RepoDigests and labels before creation, then container identity/nonce/labels before actions. Labels alone are claims bound by the approved image digest, not independent safety/provenance proof.

No build command, Docker command or project command was executed here. Native validation, audited dependency provisioning and separately approved production transport remain missing.
