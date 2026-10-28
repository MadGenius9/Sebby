# Manual acceptance checklist

Run on a disposable project folder first, never an important live repository. Preserve normal OS security controls.

## Local foundations
- Launch a built Electron app: verify Orbit artwork, all navigation and clear AI disconnected state.
- Select an empty test folder; save memory; close/reopen and reselect it. Confirm correct memory restores, another folder has separate memory.
- Save personality; restart and check persisted choices. Preview voice only after clicking the explicit button; no remote fallback or microphone prompt.
- Use a bundled and an imported instruction skill; verify text reaches the draft, not a fictitious model response.
- Save/restore named drafts; native cancellation must preserve deletion targets.

## Workspace safety
- Browse ordinary text files; verify secrets/hidden folders, symlinks, unsupported files and oversized files are excluded.
- Create a note: cancel once, verify no file; approve once, verify exact content; repeat filename, verify no overwrite.
- Load an existing file, edit, preview, cancel, verify unchanged. Preview again and approve; verify exact new content and original backup.
- Change file externally after preview: apply must reject. Change after apply: undo must reject.
- Undo a normal edit with native consent; verify original restored. Undo a newly created source file only after its native dialog clearly explains deletion.
- Try a long/truncated diff: both UI and backend must prevent apply.
- Configure trusted Git by native picker; cancellation leaves it unconfigured. Status needs its own consent; verify no network/push or arbitrary command entry point.

## Named team and real evidence
- Create specialists in all four roles; verify names/jobs/specialty persist and are distinct.
- Rename/retire; verify retired identities keep historical records and cannot accept new work.
- Create tasks and assign only matching roles. Queued tasks must not appear to execute when AI is unavailable.
- Restart with a running fixture task only in controlled tests; it must become interrupted, not replay side effects.

## Data recovery
- Save local records, export to a new private filename. Existing backup file must not be overwritten silently.
- Preview malformed/traversal/unknown-field backup: refuse without changing live stores.
- Preview valid backup, cancel restore: unchanged. Approve restore only with all work stopped; restart and inspect restored data.
- Test rollback/recovery using disposable app-data profiles only. Do not intentionally crash an app containing important data.

## UI/release
- Keyboard-only navigation; visible focus; screen reader names and status announcements; high contrast/125–200% scaling and 900px minimum desktop width.
- Check layout and scroll at normal/minimum window sizes; responsive browser preview has no horizontal overflow.
- Verify no untrusted content becomes HTML or code; all text is escaped.
- Run Windows release checklist, service/DOM tests and real browser/Electron tests. Record precise pass/fail results; never infer native behavior from DOM tests.

## Actual local utilities and opt-in discovery
- Run workspace inventory against a disposable folder only after its native consent. Verify the report matches bounded filenames/sizes, contains no file contents, and explicitly states it is deterministic, not AI.
- It must stop at awaiting-review; cancel acceptance once and verify unchanged; separately approve this utility result and verify completion. An unrelated queued 'build an app' task must remain unexecuted.
- Cancellation must abort scanning; restarting must not replay a utility automatically.
- MCP inspection is optional and should only target an endpoint you deliberately configure and trust. Native denial must cause no DNS/HTTPS request. A successful JSON-only compatible endpoint lists untrusted names/descriptions only—never runs tools or grants future access. Real network validation requires explicit consent; no automatic test endpoint is configured.
- Enable desktop reminders only after the native privacy warning. Verify silent local display and disabled-on-restart behavior; failure or no native show event must not be reported as delivered. Disable must stop pending and future deliveries. Nothing should run while Sebby is closed.
