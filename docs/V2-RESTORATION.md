# Saved-revision recovery

Save your work, open **Changes**, choose an earlier saved revision and select **Review restoration**. Review the source diff, project name and scene details, then select **Restore as new revision**. Unsaved edits must be saved or discarded first. The picker lists the latest 100 revisions; enter an older revision number to review earlier history.

Recovery replaces the current project name, source files, project notes and scene with the reviewed saved document. It creates the next revision and records its source revision; it never removes or rewrites previous history. Session undo checkpoints reset when the recovered document opens. To reverse recovery, review and restore the pre-recovery revision, creating another new revision.

External computer files, Google Drive files, exports and existing build artifacts are not recovered by this operation. Runs retain their original source revision. Existing agent proposals become stale and must be prepared again for the new revision.

## Review contract

The owning signed-in user requests `GET /api/projects/:id/restore-review?revision=BASE&target=TARGET`, then submits `POST /api/projects/:id/restore` with `revision`, `targetRevision` and `reviewHash`. Both routes use the workspace session; writes require the existing same-origin protections. The review binds the owner, project, current revision, target revision and both document hashes. Missing, current/future, unchanged, replayed and stale candidates are refused. An edit during asynchronous Git diff preparation invalidates that review.

Application revalidates the review and atomically updates the project, saves the new history entry and records restoration provenance in SQLite. A failure rolls back all three. Models have no tool to apply recovery. Git must be installed on the server to prepare the source review.

Private Git snapshots preserve original text bytes, including CRLF. Private repository attributes override imported normalization/filter settings and diffs explicitly show text, so project `.gitattributes` cannot hide source changes as binary. Scene and name changes appear separately from source diffs.

Project paths use portable relative names and reject Git metadata, Windows device names and trailing dots. Older documents containing newly disallowed names remain readable but need those paths corrected before saving or restoring; recovery does not silently rename or delete files.

## Verification

Nine focused tests cover full-document restoration, ownership/origin/review checks, stale data and replay, atomic rollback, agent/run provenance, reversing recovery, concurrent edits, older history, misleading Git attributes, byte fidelity and portable paths. The HTTP smoke and browser acceptance also exercise the real restoration endpoints; hosted results are recorded in V2-VERIFICATION.md.
