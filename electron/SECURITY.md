# Desktop privilege boundary — 0.2

The renderer is an unprivileged interface. Preload exposes named intent-specific methods, not Node, Electron, a generic IPC sender, raw filesystem paths, a shell, credential values, or arbitrary command execution. Main validates the exact sender window and main frame URL. Context isolation and Chromium sandboxing are enabled; Node integration, webviews, navigation, new windows, downloads and browser permission grants are denied. Production renderer requests cannot access the network or files outside canonical built-renderer assets.

## Explicit authority

- A native folder picker grants the selected workspace for this session only. No folder silently reopens.
- Source browsing uses an extension allowlist, 256 KiB per file, five directory levels, 300 results and 5,000 scanned entries. Hidden paths, dependency/output folders, secret-like filenames, absolute/traversal/drive/UNC paths and symlinks are rejected. This is **not secret detection**; ordinary source can contain secrets.
- Notes are create-only root .md/.txt files, with native approval and no overwrite.
- File edits use bounded complete-content previews, before/after hashes, backend rejection of truncated review, native approval, backups and target revalidation. Undo is separately approved and rejects post-edit changes. Undoing an unchanged newly created file explicitly deletes that file. There is no arbitrary delete/rename endpoint.
- Native selection can configure a trusted Git executable for this session. Each fixed read-only status command needs native confirmation. No executable path is accepted from renderer. Output/time bounds and cancellation exist. Running tasks are stopped on app quit.
- The service includes npm-test/npm-build plans, but no executable is configured for them and no UI exposes setup. Windows npm execution explicitly fails until process-tree containment is implemented. Npm scripts are arbitrary code, **not sandboxed**; future enablement must disclose script/lifecycle content, environment, network/credential exposure, budget, process cleanup and consent.
- Task completion/running transitions and assistant-message insertion are not exposed through preload. Team roles/names, skill instructions and connector bookmarks never grant capabilities. Retiring a specialist does not erase task evidence.
- Connector registry makes no network requests and collects no credentials. URL validation is not a future SSRF defense: connection code must validate resolved IPs, redirects and scopes separately.
- Provider remains not-configured; no key form, model transport or response simulator exists. A future integration requires separately reviewed secure credential acquisition/storage and explicit context disclosure.

## Data and recovery

Stores are versioned, bounded, validated, serialized and atomically replaced under userData. Personal and canonical-folder-hashed memory are separate. Other local collections are app-wide. Data, logs and edit originals are plaintext, not a credential vault. Do not store keys or passwords in chat, memory, skills or bookmarks.

Backup schema allowlists seven local stores and rejects unknown fields/files, credential vaults and executable authority. Import validates in a staging directory; restore requires native confirmation and quiesced writers, retains recovery copies, uses rollback/journal recovery, then restarts. Single-instance lock prevents ordinary concurrent app writers. Restore maintenance rejects new IPC work. Exports validate each store but are not a cross-store atomic snapshot. Power-loss atomicity is not guaranteed.

## Limits

This is **not** a hardened sandbox against an adversarial local process modifying the workspace concurrently. Canonical paths, symlink rejection and content hashes reduce accidents but do not eliminate TOCTOU/hardlink/reparse-point attacks. Only use folders you control, not hostile shared/network locations. Windows handle-relative traversal/reparse protections and Job Object lifecycle handling still require native implementation/validation. File replacement preserves ordinary permission bits, not all platform ACLs/xattrs.

Main-process service/IPC tests and DOM component tests do not prove Electron runtime security, Windows file semantics, native dialogs, notification/voice behavior or installer trust. Browser and native verification remain blocked in the current environment. No telemetry, crash uploading, signing or auto-updater is enabled.

Development is only `--dev` on an unpackaged app at fixed `http://127.0.0.1:5173/`; do not use an untrusted server on that port. Dev CSS permits inline styles solely for Vite; production CSP does not. Keep Electron and dependencies patched and repeat native release checks before distribution.
