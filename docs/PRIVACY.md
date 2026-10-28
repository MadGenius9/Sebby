# Privacy and data flow

## Current local workbench

No model provider was contacted during development. User-configured AI requests require native consent. No authenticated connector is implemented. The renderer cannot make production network requests. The app does not send telemetry or crash reports. Browsing a folder, saving memory, editing a file, using a playbook, creating team/task records, and saving reminders happen locally.

Plaintext local stores may contain prompts, source excerpts you paste, memory, file paths, team jobs and task logs. Edit originals are retained separately. Backups include allowlisted local app stores, not project files or credential vaults. Backups and manually copied text can still contain secrets you entered; schema exclusion is not secret detection.

Device-local voice preview selects only voices marked localService by the OS browser engine. If none is available, it refuses rather than falling back to a remote voice. There is no microphone access. Runtime OS voice behavior remains unverified here.

Git status runs a user-selected trusted executable only after native approval. This is an external process with that user's permissions, not a security sandbox. The fixed status command is intended read-only; executable selection and project trust remain important. No project package scripts are enabled in the UI.

## Explicit data flows and future boundaries

Read-only MCP discovery requires a fresh native consent dialog explaining the endpoint, client metadata and IP/DNS visibility. It does not upload workspace files, conversation context, memory or credentials, and cannot execute remote tools. It uses a JSON-only modern MCP subset; no actual endpoint was contacted during development. Server descriptions are untrusted text. No connection should be inferred from a saved bookmark.

AI uses fixed official provider endpoints with main-process credentials, an explicit model and bounded output/call budgets. Native consent reports selected context before transmission. Memory and file context are opt-in; provider requests expose IP/network metadata and approved text. Local history stores prompts/responses; providers apply their own retention policies. The key-entry field briefly holds a key in renderer DOM/IPC memory, clears after submission, and does not persist it in React state or localStorage. The encrypted vault binds ciphertext to profile/provider and is excluded from backups; secure OS storage unavailability fails closed. Teams and imported skills must not silently widen that context or inherit access beyond their coordinator's approved tools.

System notifications are disabled by default and can be enabled only for the current app session after a native lock-screen-visibility warning. Native delivery is not yet verified. Desktop/browser automation, cloud continuation and voice input still require separate explicit controls. A general request to make Sebby useful is not consent to upload private data, connect accounts, listen to a microphone, or incur unbounded charges.
