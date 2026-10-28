# Desktop privilege boundary

The renderer is an unprivileged local interface. The only exposed preload methods are the seven named methods in `preload.cjs`; it never receives Node, Electron, a generic IPC sender, a command runner, or credentials. The main process validates the sender window and main-frame URL for every request. Context isolation and Chromium sandboxing are enabled; Node integration, webviews, navigation, new windows, downloads, and permission grants are disabled. Production requests cannot access the network or local files outside the canonical built-renderer directory.

## Explicit authority

- Selecting a project uses Electron's native directory picker. No project is automatically reopened on launch.
- Source browsing is limited to a conservative text extension allowlist, 256 KiB per file, five subdirectory levels, and 300 listed files. Hidden paths, common output/dependency folders, secret-like filenames, absolute paths, traversal, drive/UNC paths, and symlinks are excluded. This is a convenience filter, **not secret detection**: an ordinary source file can still contain secrets. File content stays local in this version.
- The only project write is creation of one new root-level `.md` or `.txt` file. Each write requires its own native confirmation. `wx` creation refuses to overwrite any existing path. There are no edit/delete/rename, shell, package-install, publish, account-linking, or model-execution operations.
- Project memories are separated by a hash of the canonical selected directory. Without a directory selected, memory is global. Personality is global. Settings are stored in Electron's per-user application-data directory in `sebby-state.json`, using atomic replacement and serialized updates. Local memory is plaintext, not a credential vault: do not store passwords, API keys, or private tokens.
- The provider status is honestly `not-configured`. There is no API-key form and no AI response generator. A future provider implementation must add a separately reviewed credential flow and explicit disclosure of exactly what context leaves the machine.

## Boundaries of this MVP

This is not a hardened sandbox against another local process that can mutate the selected workspace concurrently. Canonical-path checks and symlink rejection reduce escapes, but filesystem paths can be replaced between checks and operations (TOCTOU). Only open folders you control; do not use adversarial network shares or directories writable by untrusted users. A production adversarial-filesystem guarantee requires platform-specific handle-relative traversal and Windows reparse-point protections.

No signing, automatic update, installer trust chain, telemetry, or crash reporting is implemented. Development mode is explicitly enabled only with `--dev` in an unpackaged app and allows the fixed `http://127.0.0.1:5173/` Vite origin; do not run an untrusted server on that port. Windows filesystem/installer behavior still needs native Windows validation.
