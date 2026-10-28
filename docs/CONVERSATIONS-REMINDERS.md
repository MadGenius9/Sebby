# Local conversations and reminders

These modules are provider-independent services. They do not call OpenAI, generate assistant responses, schedule an OS task, or show notifications. They require main-process/renderer integration before becoming UI features.

## ConversationStore

`new ConversationStore(app.getPath('userData'), {now: () => Date.now()})`, then `await load()`.

- `list()` returns metadata sorted newest first, including `messageCount` and `hasDraft` but not full messages.
- `create({title?, workspaceId?})`, `get(id)`, `rename(id,title)`, `saveDraft(id,text)`.
- `appendUser(id,text,{status:'unsent'|'sent'})`: defaults **unsent**, clears saved draft. Status `sent` must only be set by a confirmed transport integration; storing text is not evidence of transmission.
- `appendAssistant(id,text,{requestId,status:'complete'|'interrupted'})`: requires provenance metadata; main-process transport code only. Do not expose this as arbitrary renderer IPC. This validates metadata, not the truth of a provider response.
- `remove(id,{confirmed:true})`: the main process must obtain real confirmation before passing this flag. A flag alone is not user approval.
- `export()` returns a deep copy for a future user-approved export flow, not a file write.

State is versioned plaintext `sebby-conversations.json` in the supplied directory. Maximum 100 conversations, 200 messages each, 64 KiB per message/draft, 8 MiB total, 200-byte titles. There are no system-role messages: external instructions should not be silently promoted into model authority. IDs use cryptographic UUIDs. The caller should filter by workspace and review exactly what context it sends to any future provider. Nothing is sent automatically.

## ReminderStore

`new ReminderStore(app.getPath('userData'), {now: () => Date.now()})`, then `await load()`.

- `create({title,dueAt})`: `dueAt` is an absolute UTC epoch in milliseconds. Past times become due immediately. The UI must show the user's local timezone before saving.
- `list()` returns every reminder with `scheduled`, `delivered`, or `dismissed` status.
- `due()` returns only scheduled reminders whose due time has arrived. Calling it has no side effect.
- `markDelivered(id)` records delivery only for currently due scheduled reminders. The host must call this after actual successful in-app/OS delivery, never merely because a timer fired.
- `snooze(id,futureEpochMs)` reschedules; `dismiss(id)` retains a dismissed record.
- `remove(id,{confirmed:true})` requires a main-process confirmation flow.

Reminders persist in versioned plaintext `sebby-reminders.json`. Maximum 200 reminders, 500-byte titles, 512 KiB total. No notification permissions are requested by the service. No notification runs when Sebby is closed. On relaunch, overdue scheduled reminders remain due. A host could fail after displaying a notification but before recording delivery; avoiding duplicate delivery requires additional transactional host integration. Do not claim exactly-once notification delivery.

## Persistence and safety

Both services serialize updates, write through unique exclusive temporary files, and rename only after a complete write. Corrupt/oversized/symlinked state files cause load failure without silently resetting existing data. Callers must not continue using a failed-load instance. Returned objects are cloned to prevent mutation of internal state. Settings directories are trusted application-owned paths, not user workspace folders. These services are not multi-process databases or a defense against a hostile process concurrently altering the settings directory. No encryption is claimed; avoid secrets. Export/deletion, notification consent, navigation, UI accessibility and multi-window coordination are host responsibilities.

## Evidence

`node --test tests/conversations.test.mjs tests/reminders.test.mjs`: 8/8 pass on 2026-10-28. Tests cover restart persistence, unsent status, provenance requirement, bounded payloads, serialized concurrent updates, deletion confirmation flag, corrupt-file preservation, injected-clock due logic, snooze/dismiss, and premature delivery rejection. No provider calls or native notifications were made.
