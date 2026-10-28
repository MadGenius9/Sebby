# AI integration security review

Independent review dated 2026-10-28. User authorized reuse of an existing key, not new-key creation. No real credential was inspected or used. All review tests use synthetic test strings, mocked HTTPS or injected providers; no API request, DNS lookup, account operation, or credential write occurred.

## Established checks

`tests/provider-security.test.mjs` independently checks:

1. The OpenAI transport uses the fixed official HTTPS endpoint, a fresh direct agent, certificate verification and the caller's AbortSignal. Renderer-supplied URL/header additions are ignored.
2. Redirect responses are not followed and no automatic request retry occurs.
3. Transport exceptions/provider error bodies cannot echo credentials into results or UI events.
4. Runtime credential values containing header-control characters fail before transport; status reports presence, not validity or the secret.
5. Preload exposes no credential-value read API. Project child processes use an explicit environment allowlist rather than inheriting the provider credential.
6. Anthropic and xAI transports use separate fixed official HTTPS endpoints and the correct isolated authentication header; redirects are not followed.

The local PowerShell launcher uses a hidden local prompt or pre-existing process environment. It builds with the provider variable removed, passes no key argument, writes no key file, zero-frees the BSTR and restores the process environment. This is static source review, not a Windows execution/security validation. Runtime strings may still exist in process memory; the launcher is not a secret enclave.

Latest user scope permits masked in-app key entry. A newly entered key necessarily exists transiently in the renderer input/IPC message before main-process encryption; it is not accurate to claim keys never enter the renderer. The entry must be uncontrolled, promptly cleared and excluded from React state, storage, logs and exports. JavaScript strings cannot be reliably zeroed. Existing stored/runtime keys have no renderer readback API. Native encryption and entry behavior remain unverified on Windows.

The OS-encrypted credential helpers reject missing encryption/basic_text and require explicit persistence confirmation. The profile vault validates IDs, bounded encrypted blobs and file types; stored-key failure never falls back silently to environment credentials. Provider profiles use only fixed provider-specific environment names, with explicit environment opt-in. Fake encryption tests do not validate Windows DPAPI or native OS policy; native credential entry/integration requires separate verification.

## Findings communicated and corrections

- **Cross-workspace chat history:** a conversation from another folder could be reused with only the new folder shown in scope metadata. Backend now rejects mismatched conversation workspace before modifying its draft, requiring the original folder or a new conversation.
- **Cross-provider history:** bounded chat history now drops a leading assistant fragment, starts with a user turn and accurately discloses omissions, preserving Anthropic input compatibility. Regression passes.
- **Response provenance:** provider now rejects a created/completed response-ID mismatch instead of overwriting the ID.
- **Streaming compatibility:** provider now bounds individual SSE frames rather than rejecting an aggregate chunk containing many small frames.
- **Refusals/final text:** completed message inventory supplies authoritative visible text; deltas remain provisional. This preserves refusals after earlier commentary and avoids inconsistent final output.
- **Reasoning continuation:** opaque encrypted reasoning and assistant phase must be replayed in main memory only, not logged/persisted/emitted. Current provider and runtime now preserve ordered `outputItems` in memory only, with a regression test against accidental persistence/duplicate calls.
- **Agent edit review visibility:** native edit approval originally referred to a UI diff that existed only for manually created proposals. Parent added a main-owned ChangeReviewGate, full diff dialog and acknowledgment before the separate native consent. Source wiring and gate tests checked; actual Electron modal/UI behavior remains unverified.
- **Usage after failures:** runtime now records sanitized provider-call/usage accounting before completion-status checks, including incomplete/cancelled responses; regression tests pass. Never infer zero charges from cancellation.

## Reviewed boundaries

Chat has no tools, requires native context/cost consent, uses only explicit files/memory/skills and bounded history, and saves assistant text only with dispatch/response provenance. Agent runtime exposes only declared local metadata/read/reviewed-edit functions; no shell, installation, external connector or credential tool. File sends need their own approval when not initially selected. Role identity does not grant authority. A real separate coordinator response precedes user acceptance; neither model text nor renderer flags can directly mark a task complete.

These conclusions apply to reviewed source, not a penetration-test guarantee. Main/UI integration is evolving and must be rechecked before publication, particularly native diff visibility, cross-service cancellation, restore/quit quiescence and exact send-context disclosures.

## Protocol references

Reviewed against the official [Responses create reference](https://developers.openai.com/api/reference/resources/responses/methods/create), [streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events), and [reasoning guide](https://developers.openai.com/api/docs/guides/reasoning). Current guidance requires preserving completed reasoning continuation state and assistant phase. No live-model interoperability is established by fake SSE fixtures.

## Remaining gates

Real provider auth/model access, billing/usage, native credential storage, PowerShell, Windows UI/file semantics, and actual Electron callbacks remain unverified. OpenAI reuse permission must not be treated as permission to send that key to another provider. Any added provider must have a fixed official endpoint and a strictly separate provider-specific credential source.

## Additional provider review and focused evidence

Anthropic uses native Messages translation and SSE handling, not OpenAI-shaped assumptions. Unsupported thinking/server tools and foreign replay fail closed. Refusal and token cutoff remain incomplete, not executable tool results or completed answers. Reported input usage includes cache input fields when supplied. xAI intentionally implements the documented Responses subset with its own fixed endpoint. Both retain separate credential sources; OpenAI permission is not cross-provider credential permission.

References: [Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming), [stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons), [xAI reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning).

Focused command (2026-10-28) passed **70/70** local tests: `node --test tests/provider*.test.mjs tests/credentials.test.mjs tests/anthropic-provider.test.mjs tests/xai-provider.test.mjs tests/chat.test.mjs tests/agent-runtime.test.mjs tests/profiles.test.mjs tests/*vault*.test.mjs tests/change-review.test.mjs`. This covers synthetic protocol streams, main-only continuation, refusal/cancellation, cross-workspace rejection, review gates, profile isolation and fake vault behavior. These are not live-provider, Windows, or actual Electron tests.

### IPC lifecycle follow-up

`tests/ai-ipc-security.test.mjs`: **5/5 PASS** with injected adapters. A provider connection test now takes its busy lock before the first asynchronous credential check; settings or a second test cannot change its approved provider/model mid-flight. Cancellation during native consent prevents dispatch. Shutdown closes the service, drains the pending test/settings promise, and prevents pending settings consent from committing credential changes after closure. Main folder selection rechecks active work after the native dialog. Agent pre-run shutdown was separately flagged and fixed: a permanent closed flag blocks delayed preparation, later consent, new starts and late review acceptance; preparation is tracked and drained. Both new regressions pass.

### Stored credential provider binding

Found and fixed a cross-provider risk: restored profile metadata could reuse a local vault UUID with a different provider. Vault ciphertext now contains a versioned envelope binding both profile UUID and provider to the key; reads require an exact expected-provider/UUID match. Mismatches, copied ciphertext, and legacy raw-key ciphertext fail closed with no environment fallback. The resolver and save IPC use this binding. `tests/vault.test.mjs` **6/6 PASS**, including simulated altered backup metadata, entirely using fake reversible encryption and synthetic credentials. Existing pre-binding test/development blobs require deliberate key re-entry; none are silently migrated.

### Main/preload and data lifecycle review

Rewritten main-process wiring retains strict sender/webContents/main-frame/exact-URL checks on every registered IPC call, rejects work during maintenance, blocks external navigation/windows/downloads and renderer permission requests, and uses context isolation + sandbox with Node integration disabled. The preload provides named operations, not a generic invoke/shell/key-readback channel. VM tests verify native IPC event objects never reach renderer subscribers.

Conversation deletion now holds a pending-removal gate throughout confirmation and queued disk mutation; new chats are blocked until it clears, and active chat is rechecked after consent. Restore checks active requests/services and enters maintenance before replacing stores. Quit aborts services and waits for queues with an explicit three-second outer limit; abrupt OS termination and the deadline can still interrupt persistence. Neither source review nor unit tests prove native shutdown ordering.

`tests/preload-security.test.mjs` **2/2 PASS** covers bridge/event boundaries and packaged GLB resource access. Static relative pal URLs need no broader CSP/network grant: bundled files pass the resource policy, external network/local files and symlink escapes fail. Actual packaged `file://` GLTF loading/GPU rendering is not tested here.

Latest entire Node suite: `npm test` **184/184 PASS** on 2026-10-28 (including AgentRuntime preparation-shutdown regressions). Independent `tests/ai-ipc-security.test.mjs` is now **6/6**, and `tests/local-features-security.test.mjs` **1/1**. UI/native/live-provider verification remains separate.
