# Distribution readiness — private source only

**No installer was built, signed, published, uploaded to an app store, or approved for public distribution by this checklist.** Source feature milestones do not close native release, legal, operational or security gates.

## Reproducible source/license snapshot

Read-only report to stdout:

```text
node scripts/release-readiness.mjs
```

Optional create-only output in the workspace (choose a new filename; existing files are not overwritten):

```text
node scripts/release-readiness.mjs --output docs/release-readiness-review.json
```

`--check` returns nonzero until **all** gates are passing; signing/native/legal gates intentionally remain unresolved. A proposal for package.json is `"release:readiness": "node scripts/release-readiness.mjs --check"`; it has not been added automatically.

The manifest omits timestamps/absolute paths for reproducible comparisons and hashes package/lock/source inputs, candidate application files, installed production metadata and license text. It does not read app data, hidden files or secret-named paths, invoke subprocesses/network, build installers, inspect environment values, sign or publish. Findings may show forbidden path **names**, never their contents. Output is confined to a non-source workspace JSON path and cannot follow symlink parents.

The snapshot is not a complete secret-content scanner, SBOM certification, vulnerability audit or binary/ASAR audit. In particular, innocently named source files can contain sensitive data and production `node_modules` file inclusion must be checked in the actual artifact.

## Current packaging boundary

The reviewed own-app file list is exactly:

```text
dist/**/*
electron/**/*
skills/**/*
package.json
```

That list excludes source tests, temporary files and the uncompiled `native/windows-job-runner` prototype by location. The report scans included application directories for hidden/sensitive named paths and refuses broadened patterns or unreviewed extra-files/resources/hooks. It does not waive an artifact audit. electron-builder also includes production `node_modules` automatically, regardless of this list. [Version-matched application contents documentation](https://www.electron.build/v26/docs/contents/)

No `sebby-*-vault`, `.credential`, `.env*`, app-data settings/history, signing private key, fixture credential, native helper binary, or generated debug bundle belongs in an installer. Never copy the user's app-data directory into a build. Rebuild `dist` from reviewed source and inspect its contents; stale assets can survive incorrectly configured workflows.

## What is missing here

- Installed `electron-builder` tooling exists, but the local Electron `dist` runtime/binary and its Chromium notices are absent. There is no evidence of a complete locally cached Windows runtime/NSIS/signing toolchain. No cache search outside this workspace was performed.
- Therefore an offline Windows package cannot be established from the available workspace alone. Running packaging may fetch Electron/tool binaries and may produce an unsigned development artifact. It was **not attempted**, and no download/install authorization is inferred from this document.
- No code-signing identity, certificate/private key, verified installer, Windows host, native .NET helper build, SmartScreen/Defender validation or app-store registration is available or established.

Builder packaging normally has dependency/staging/signing/distributable phases and can obtain runtime/tool components; do not assume it is offline. [Version-matched build lifecycle](https://www.electron.build/v26/docs/features/build-lifecycle/)

## Gates before a distributable

1. **Freeze reviewed source:** record commit, version and lock/source hashes; rerun tests/typecheck/build. Keep repository private unless separately authorized.
2. **Verify supply chain:** review lock changes, actual installed versions, hashes, runtime acquisition and toolchain provenance. Do not silently upgrade to a new builder major or download arbitrary tooling.
3. **Native Windows validation:** follow `RELEASE.md` in an approved test environment. Record exact Windows/Node/Electron versions and each pass/fail/skip. Include microphone permissions, OS vault, rendering, preview isolation, GitHub credentials and cancellation. Mocked tests are not native evidence.
4. **Artifact-content audit:** inspect final ASAR and installer. Verify every file against intended allowlists and secret/vault exclusions, dependency license texts, original asset provenance and uninstall behavior. Ensure the source-only Job Object helper remains excluded and Windows npm remains disabled.
5. **Notices/license review:** reconcile `THIRD-PARTY-NOTICES.md` with the actual bundle and runtime notices, decide Sebby's own license/terms, and put required notices in a shipped, accessible location. No commercial/legal clearance is asserted here.
6. **Signing and identity:** choose an authorized signing process and release owner; protect keys outside source/app data. Verify actual Authenticode signer/hash/timestamp. Signed does not mean bug-free, and this checklist does not guarantee SmartScreen reputation. Builder can otherwise emit unsigned artifacts; a release pipeline should fail closed when required signing is missing. [electron-builder v26 signing controls](https://www.electron.build/v26/docs/features/code-signing/)
7. **Consent and privacy:** confirm each outbound AI/GitHub/audio operation requires deliberate consent; review data retention, plaintext local history/backups and account/cost disclosures. Store no production secrets in QA logs.
8. **Recovery/support:** verify restore rollback, credential exclusion, cancellation/shutdown, failed updates, support diagnostics redaction and documented limitations. There is no automatic update/public telemetry service to assume exists.
9. **Publication authorization:** private repo commits do not authorize a GitHub Release, public hosting, store submission, paid signing service, account creation or deployment. Obtain the specific authorization and review exact artifacts before those actions.

Until those gates are established, label the deliverable **private source development checkpoint**, not a production Windows release.

The `notices-packaging-declaration` gate passes only when the exact notice file exists and is explicitly declared in `build.files`; its hash appears among candidate files. This does not establish that a built artifact contains it, that the Settings reader works natively, or that all legal/commercial obligations are met. Those remain separate release gates.
