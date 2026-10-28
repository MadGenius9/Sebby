# Native harness source review — 0.8

Reviewed 2026-10-28 without running PowerShell, the SDK, fixture binaries, native helper, network requests or live credentials. This is **source review, not native test evidence**.

## Findings corrected

- SDK restore/build originally inherited the caller's environment, including possible credentials, proxies and runtime/MSBuild hooks. Both SDK and helper processes now use a cleared environment with explicit Windows/temp/CLI settings only.
- Copying fixed projects alone did not prevent ambient ancestor `Directory.Build.props`, targets or package-property imports. The harness now suppresses those imports and writes fixed empty boundary files in its temporary root.
- NuGet package caching is now confined to the temporary root. Package sources/fallback folders are cleared and restore receives an empty local feed; no online fallback is selected. The already-installed stable SDK is pinned with roll-forward disabled. Missing local packs are a failure, not permission to download.

## Reviewed controls and limitations

The script requires an explicit opt-in switch, a Windows x64 PowerShell 7+ host and a preinstalled .NET 10 SDK. It copies only named owned helper/fixture sources into a randomly named temporary directory. It does not enable Sebby's runtime runner, run npm/project scripts, install software, change execution policy, elevate, or configure a service.

Fixtures are deliberately benign and finite: expected success/nonzero exits, timeout, cancellation, EOF, output overflow and supervisor termination. Each fixture has a 60-second watchdog. Child/grandchild tests require identity records before termination. Cleanup uses created process handles and exact executable/PID/start-time identity checks, not process-name or system-wide killing. Only the created random directory is removed. This assumes a trusted test account/filesystem; it does not defend against an adversarial local process replacing files or manipulating process evidence.

The work phase has a deadline and individual waits are bounded; cleanup can add per-process waits. Harness stdout/stderr are drained concurrently but collected with `ReadToEndAsync`, so this is not a streaming-memory sandbox for malicious SDK/helper output. Fixture-only passes would not prove inherited-job compatibility, creation/resume races, handle isolation, adversarial filesystem safety, arbitrary executable safety, or a Windows-version matrix. A Job Object is lifecycle containment, not a network/filesystem sandbox. Windows npm remains disabled and the helper is excluded from installer inputs.

The implementation owner also applied the final hardening recommendation: disable reusable SDK/MSBuild/compiler servers for restore and build using fixed environment/property controls. This avoids intentional reuse but does not replace native process observation; its actual Windows behavior remains unverified.

## Documentation review

`NATIVE-ACCEPTANCE.md`, `RELEASE.md`, `DISTRIBUTION-CHECKLIST.md` and `PHASE-GAPS.md` distinguish implemented source, operator-authorized offline tests, optional account/cost decisions and unresolved native/release gates. Recommended wording corrections were applied: synthetic non-secret values can test native vault behavior without account authentication; invoking a reviewed package script with `--publish never` is not a general sandbox against modified lifecycle code.

No blocking source concern remains after the environment/import corrections. The lead reports 288 Node and 67 DOM tests plus TypeScript/Vite passing; those counts were **not rerun by this read-only review**. No native acceptance result, signing trust, installation result, publication authorization or runtime-enablement permission follows from this review.
