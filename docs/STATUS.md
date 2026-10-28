# Delivery status — 0.4 personal workbench

## Implemented in source

Local memory/personality/drafts, instruction skills, named specialists, durable tasks, reminders, bounded workspace operations, full-diff review with native confirmation and hash checks, backups/undo, fixed Git status, deterministic local utilities, read-only MCP metadata discovery, opt-in session notifications, and validated app-data backup/restore.

New: OpenAI Responses, Anthropic Messages and xAI Responses adapters; streaming chat/history/cancel with explicit context; per-provider model profiles and output budgets; OS-encrypted BYOK vault with provider/profile binding; native-approved connection test; bounded specialist read/edit tool loop and separate model coordinator review, followed by user acceptance. Configured keys are not proof of connection. All provider tests use injected mock transports; no paid requests or real credential reads/writes occurred.

Orbit, Scout, Wisp, Luma, Nook, Finch, Tidal, Moss and Piper are original editable assets. The renderer loads local GLBs and changes actual material colors, with static PNG fallback. All nine are optional choices; Orbit stays the default.

## Remaining implementation and validation

- Live provider/model/account validation after secure user setup; current key-reuse decision is resolved, not a code gate.
- Native Windows encrypted storage, UI, dialogs, notifications, GLB rendering and PowerShell verification.
- Windows Job Object process containment before package scripts, development preview processes and fuller app-build workflows.
- Authenticated GitHub and MCP tool execution; metadata discovery is only a JSON read-only subset, mock-tested.
- Rich voice input/output, companion expressions, desktop/browser automation and optional cloud continuation.
- Signed installer, trusted updates, commercial licensing/distribution review, accessibility and native end-to-end testing.

No seven-phase completion claim is made. The safe app-developer milestone still needs tested build/test/preview execution and real-model validation.

## Environment limits

Cloud browser cannot reach the workspace loopback server. Local Chromium socket access is restricted; an escalation failed during sandbox construction. Cloud file navigation is blocked. No bypass was attempted. Electron binary, Windows, PowerShell and signing credentials are unavailable. DOM and service tests do not replace native release verification.
