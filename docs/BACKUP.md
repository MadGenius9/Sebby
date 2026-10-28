# Local backup, restore, and recovery

`BackupService` is an allowlisted local-data backup service. It does not upload data, copy project folders, or export credentials. The main process owns native open/save dialogs, confirmation, and lifecycle coordination. Never accept backup file paths directly from a renderer.

## Supported data

Only these filenames are accepted in a version-1 `sebby-local-backup` JSON envelope:

- `sebby-state.json` — local personal/project memory and personality
- `sebby-tasks.json` — task metadata/logs/results
- `sebby-skills.json` — imported instruction documents
- `sebby-reminders.json` — passive reminder records
- `sebby-conversations.json` — history and drafts
- `sebby-connectors.json` — disconnected endpoint bookmarks
- `sebby-team.json` — named specialist identities and task references
- `sebby-appearance.json` — bounded companion/palette/motion settings
- `sebby-provider-profiles.json` — non-secret provider/model/profile metadata only
- `sebby-github.json` — repository/ref/token-use preference, never the token

Provider credential vaults, API tokens, OS key storage, browser local storage, project files, installed tools, and bundled assets are **not exported**. Free-form memory/prompts can nevertheless contain secrets a person pasted there; this is a plaintext backup, not secret scanning or encrypted storage. Native export confirmation should explicitly warn about that.

## Contract

```js
const backup = new BackupService(app.getPath('userData'));
// Before any stores, tasks, providers or workers are started:
await backup.recoverPending();

const json = await backup.exportJSON(); // main writes to native save-dialog choice
const preview = await backup.previewImport(jsonFromNativeOpenDialog);
const result = await backup.restore(preview.token, {
  approve: async summary => nativeRestoreConfirmation(summary),
  quiesce: async () => stopAndDrainAllWritersAndExecutors()
});
// After success, relaunch/quit. Existing Store instances are now stale.
```

- `exportJSON()` validates existing allowlisted files and returns a versioned JSON string. Missing files are omitted. An entirely empty backup is rejected. A pending restore prevents export.
- `previewImport(json)` accepts at most 20 MiB of JSON, rejects unknown envelope/path/schema fields, validates data using the real services inside a temporary directory, and returns a single-use in-memory token with summary/warnings. No live store is modified. A new preview invalidates the previous token.
- `restore(token,{approve,quiesce})` requires both trusted callbacks and exact boolean approval. The native confirmation must identify the stores being replaced and explain local sensitive data. `quiesce` must stop/drain writers and executors, not merely return true. Restore replaces only listed stores; omitted stores are unchanged.
- `recoverPending()` rolls back an incomplete recorded transaction. Call only at application startup before loading stores or running operations. If recovery fails, keep the app stopped and preserve the files; do not load a partially restored application state.

Running task records are normalized to interrupted during staging, never resumed. A restore does not grant permissions or reconnect endpoints. Each task retry still requires explicit review for prior side effects.

## Transaction behavior

Prior files are copied into `sebby-recovery-<random UUID>` under app data. A strict allowlisted journal is created before live replacements begin. A caught replacement failure restores every prior file (or removes newly introduced files). If rollback itself cannot finish, the journal remains and the app must stay stopped. On restart, the journal causes rollback before normal services load. The recovery folder is retained on success as a local before-restore backup; no automatic deletion is performed.

This is coordinated single-process recovery, **not a general filesystem transaction or power-loss durability guarantee**. A crash after replacements but before journal removal rolls back to the previous data at next startup. A disk failure, adversarial concurrent filesystem mutation, antivirus interference, or a second writer process can prevent recovery. The interface reports failure instead of claiming success.

Export reads files one by one; each store's atomic writes prevent ordinary half-written reads, but it is not a cross-store point-in-time snapshot while operations continue. Pause/drain operations before exporting when a consistent multi-store checkpoint is required.

## Main-process integration requirements

1. Call `app.requestSingleInstanceLock()` before creating windows/services. Quit if the lock fails. Focus the existing window on `second-instance`.
2. Resolve pending restore before loading persistent services.
3. During preview/restore, guard dialogs and reject new writes, new model requests, task starts, connector operations, and workspace edits.
4. After native approval, abort in-flight requests and await all service queues before returning true from `quiesce`.
5. Restart after successful restore; do not keep stale in-memory settings/history/task instances alive.
6. Use native dialogs for the file choice; read/write only the chosen path with bounded regular-file checks. Do not create an arbitrary renderer filesystem bridge.
7. Treat recovery folders and exported backups as sensitive user data. They need the same privacy protection as app data.

## Verification

`node --test tests/backup.test.mjs` — nine passing tests: credential-file exclusion, traversal and unknown fields, corrupt/schema-invalid content without live mutation, approval/drain requirements, running-task interruption, preserved pre-restore originals, injected second-file failure and rollback, interrupted-transaction startup recovery, journal traversal rejection, and symlink rejection. Module syntax check passes. Native dialogs, actual app restart, Windows antivirus/file locking, Windows path normalization, and power-loss recovery are not validated by these unit tests.

Provider profile backup deliberately excludes the entire `sebby-profile-vault` directory and all `.credential` files. Restored profile metadata does not restore keys, prove connection, or authorize requests. The profile document is validated by the registry’s strict pure validator without seeding defaults during backup staging.
