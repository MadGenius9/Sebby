# Controlled development foundation

`electron/development.mjs` is a main-process service, not a renderer API. Main must expose only narrow wrapper methods and validate sender/frame identity. It must inject a native consent callback. The default callback denies every action. No tool executable is configured by default, and this module never discovers or installs tools.

## Edits

```js
const development = new DevelopmentTools(workspace, {
  backupRoot: path.join(app.getPath('userData'), 'edit-backups'),
  approve: async request => /* trusted main-process native dialog */ false,
});
const proposal = await development.previewEdit({path:'app.js', content:'new text', expectedHash:knownHash});
await development.applyProposal(proposal.id); // invokes approval
await development.undo(proposal.id);          // a new, independent approval
```

- Previews do not write files. The proposal contains immutable-by-copy IDs, original/replacement SHA-256 hashes, a whole-file +/- diff, and byte counts. `expectedHash` is optional for preview; when supplied it must match the current text. Use `null` to assert that the file must not yet exist.
- Existing supported text files may be edited. New supported text files are limited to the project root. The existing source allowlist and size limits apply; traversal, hidden paths, secret-like filenames, linked files/directories, and Windows device names are rejected.
- Approval requests use `kind: 'apply-edit' | 'undo-edit'`, `operation: 'edit' | 'create'`, workspace/path, before/after hashes, and diff. The native dialog must clearly identify the action and project. **Diff text can be truncated at 64,000 characters.** The frontend must preserve the full proposed text for review and prominently disclose truncation; never claim a truncated diff is the entire change.
- After approval, the original hash is checked again. Originals and recovery metadata are written to the private backup directory before mutation. A synced temporary sibling is atomically renamed over an existing file; new files use an exclusive hard link, so an existing path is not overwritten. Replacement preserves ordinary permission bits, not ACLs, timestamps, extended attributes, or ownership; do not use it for files requiring those metadata guarantees.
- Undo requires the target still match the applied hash. It restores the original or deletes an unchanged newly-created file, only after native approval. Last 20 successful edits are undoable during the current application session; original backups remain on disk for manual recovery after restart. Backups are plaintext and not encrypted. There is no automatic retention cleanup yet.
- Atomicity is per file, not multi-file. A crash can leave `.sebby-*.tmp` files or an unused recovery record. A failed apply after backup creation may require discarding the proposal and previewing again; backups are retained rather than silently deleted.
- These protections do not eliminate TOCTOU attacks by another local process replacing directories between checks. Only use folders controlled by the user, not adversarial shared directories. No adversarial filesystem sandbox is claimed.

## Fixed command plans

Allowed identifiers are only `git-status`, `npm-test`, and `npm-build`. No arbitrary arguments or command strings are accepted. Commands use `spawn(..., {shell:false})` and run only in the explicitly selected canonical workspace. The selected project is rechecked after approval.

```js
const plan = await development.planCommand('npm-test');
const {id, completion} = development.startCommand(plan.id);
// Return id to the renderer, not the completion Promise.
// Consume completion in main; narrow polling can return development.getRuns().
development.cancelCommand(id);
```

`runCommand(id)` is also available for callers that need the completion result directly. `getRuns()` contains up to 20 records created through `startCommand`; terminal results include bounded combined output, exit code, timeout/cancellation flags, and any termination warning. Plans/proposals can be discarded with `discardCommand`/`discardProposal`.

- Main-process configuration must supply canonical absolute executable paths: `executables.git` for Git, or `executables.node` and `executables.npmCli` for npm. These must come from trusted native setup, never an arbitrary renderer field. There is no configuration UI in this module.
- Git runs with optional locking disabled and fsmonitor/untracked-cache configuration disabled. It requests only `status --short`, not checkout, commit, push, or file mutation.
- Npm plans include the exact entire scripts object (including lifecycle hooks), the complete package.json hash, and an explicit arbitrary-code warning. Main must show these in the native approval flow. The package hash is rechecked after approval. **Npm scripts still execute shell commands internally**, despite the launcher itself using `shell:false`. Scripts and dependencies may delete files, read credentials, install things, launch further programs, and access the network. This is a trust decision, not a sandbox, and is not implicitly authorized by enabling a model.
- Npm execution is **disabled on Windows** until a Job Object-backed process-tree runner exists. Do not disguise this as working Windows command execution. On POSIX, a dedicated process group receives SIGKILL on cancellation or timeout. Malicious programs can deliberately escape the group; commands must be trusted. Git on Windows is a single-process best-effort cancellation path.
- Defaults: 60-second timeout (maximum configurable 120 seconds), 128 KiB combined captured output, one command or mutation at a time, no stdin, sanitized inherited environment. Timeout/cancel does not undo changes already made by a command.
- Command result statuses are observations, not claims of successful tests. A zero exit code is reported as such; parse or summarize output only with appropriate evidence.

## Tests

`node --test tests/development.test.mjs` uses temporary project fixtures only. Spawn tests run the current trusted Node executable on tiny generated fixture programs that produce output or sleep. They do not run npm, Git, or scripts in any user project. Native Electron dialogs and Windows process management still require platform integration testing.
