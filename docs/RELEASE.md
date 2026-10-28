# Windows verification and release gate

This is a **test recipe, not evidence that Windows validation passed**. The cloud development environment did not run PowerShell, the Electron GUI, a Windows installer, signing, SmartScreen checks, or an updater. Current results belong in `VERIFICATION.md`; update them only with observed results and exact versions/commands.

## 1. Prepare an isolated Windows test workspace

Use a disposable Windows account/VM or a backed-up development machine, not a production project. Obtain source from the intended private Sebby repository/checkpoint; review its commit identifier, `package.json`, `package-lock.json`, and scripts. Do not run downloaded scripts from untrusted copies. Install Node.js **24 LTS** through your normal trusted software process before continuing. No administrator session is required for source verification. Keep credentials out of the test shell.

Open PowerShell in the repository and explicitly run:

```powershell
.\scripts\verify-windows.ps1
```

The script performs `npm ci`, service/security tests, React component tests, TypeScript/production build, then local NSIS packaging in order. It stops on the first failure and returns that command's nonzero exit code (preflight errors return 1). `npm ci` installs locked development dependencies, including Electron, and executes dependency lifecycle scripts: review the source and lockfile before choosing to run it. It does not install Node or other global software. It explicitly forbids publishing and refuses common inherited signing configuration. It never launches the app or installer.

Options:

```powershell
.\scripts\verify-windows.ps1 -SkipInstall
.\scripts\verify-windows.ps1 -SkipPackage
.\scripts\verify-windows.ps1 -SkipInstall -SkipPackage
```

A skipped step is **not verified**. `-SkipInstall` requires existing `node_modules` and is not a clean-install test. If local PowerShell execution policy blocks the script, follow your organization's approved script-review/signing process; do not weaken system policy as a workaround. Individual documented npm commands may be run manually if your policy allows them, recording each result.

## 2. Inspect the installer before deciding to run it

The current configuration creates NSIS output under `release/`, with product name Sebby and app ID `dev.sebby.companion`. Record actual output filenames (do not assume a particular architecture), source commit, dependency lock hash, Windows edition/build, Node/npm versions, command results, and build logs after checking them for secrets. Compute the actual installer's SHA-256 and inspect Authenticode:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\release\ACTUAL-INSTALLER-FILENAME.exe'
Get-AuthenticodeSignature -LiteralPath '.\release\ACTUAL-INSTALLER-FILENAME.exe' |
  Select-Object Status, StatusMessage, SignerCertificate
```

Replace the filename with the actual artifact; these commands do not execute it. This checkpoint has no established signing pipeline. A successful build does not imply a signed, trusted, safe or tested installer. If unsigned, label it **unsigned development artifact** and do not distribute it as a release. If Windows/SmartScreen/Defender warns or blocks execution, stop and record the warning; do not disable protection or click through merely to finish a checklist. Use an approved controlled test/signing process.

## 3. Native smoke test (explicit operator action)

Only after your normal trust review, run `npm start` to test the development app, or explicitly install a reviewed artifact through your approved test process. The verification script does neither. Record separately whether each behavior is observed:

- Window opens with the packaged local assets, chosen Orbit companion, correct title, usable minimum size and no blank screen; quit and relaunch work.
- Keyboard-only navigation, visible focus, screen-reader labels, high-DPI scaling (100/150/200%), contrast, reduced motion, and long text are usable. Component tests are not accessibility certification.
- Personal/project memory and personality save and survive relaunch; projects do not silently share memory. Folder selection asks through the native dialog.
- Test **only disposable files**: supported source reading, rejected traversal/symlinks/junctions/reparse points, hidden/sensitive names, large/binary files; cancellation leaves files unchanged.
- File edit preview identifies the target and content change; deny/cancel changes nothing; approval applies only the reviewed version; a concurrent edit is rejected. Session undo restores the expected version and does not overwrite unrelated newer changes.
- No arbitrary terminal API. **Windows npm task execution is intentionally disabled** in the current development-tool policy; a visible unavailable/error result is expected, not a packaging bug. Do not enable shell execution to get a green test.
- Drafts/history, task-state transitions, skill imports, reminder due/snooze/dismiss, and connector bookmarks preserve honest status. Queued tasks are not autonomous workers; configured connector bookmarks are not connected services; reminders do not promise delivery while closed.
- Backup/export and restore preview/confirmation operate on disposable settings. Verify crash recovery/restart paths before trusting restoration. Backups contain plaintext personal data; protect them appropriately.
- Second-instance behavior does not open competing settings writers. Corrupt settings show an actionable error without silently discarding data.
- Production navigation/popups/downloads, microphone, external network and unexpected permissions remain denied. No credentials appear in renderer state, logs, chat, memory, backups, or source.
- Installer installation, launch, uninstall, reinstall and user-data retention/removal behavior are observed in a disposable environment and documented rather than assumed.

The filesystem protections are not a sandbox against an adversarial process concurrently mutating files. Capture and triage failures; do not change the acceptance criteria to match a failure.

## 4. Signed distribution and updates — future gated work

Before release, establish a reviewed signing identity, secure certificate custody, reproducible build provenance, dependency review, native Windows end-to-end tests, recovery/backups, and release approval. Signing a binary does not prove its safety or automatically establish SmartScreen reputation. Never commit certificate material, private keys, signing secrets, or service tokens.

There is **no auto-update feature** in this checkpoint. Do not add an updater against unsigned or untrusted feeds. A future updater must validate trusted signed artifacts, enforce version/rollback policy, and support failure recovery. Signing, publication, repository releases, hosted update feeds, and account connections require their own authorized process; this script performs none of them.

## Record template

| Check | Result | Evidence |
|---|---|---|
| Source commit and lock hash | Not recorded | |
| Windows/Node/npm versions | Not recorded | |
| Clean dependency install | Not run on Windows | |
| Service + component tests | Not run on Windows | |
| Production renderer build | Not run on Windows | |
| Local installer packaging | Not run on Windows | |
| Artifact SHA-256/signature | Not recorded | |
| Native file approval + recovery | Not run | |
| Accessibility/high DPI | Not run | |
| Install/uninstall/reinstall | Not run | |
| Security review and release approval | Pending | |
