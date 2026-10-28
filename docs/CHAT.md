# Chat session boundary

`electron/chat.mjs` is a main-process orchestration service over the provider adapter. It never accepts an API key, endpoint, approval boolean, system instruction, tool definition, or command from the renderer. It does not execute tools, change project files, or dispatch autonomous agents. Development verification uses fake providers only; no live request or API charge was made.

## Integration

```js
const chat = new ChatService({provider, conversations, workspace, store, skills,
  approve: request => nativeConsent(request),
  onEvent: event => trustedWindow.webContents.send('sebby:chat-event', event),
});
const {runId, conversationId} = await chat.start({
  conversationId: existingId, // optional
  text: 'Help plan this app', model: explicitlyChosenModel,
  includeMemory: false, skillIds: [], filePaths: [], maxOutputTokens: 2048,
});
chat.status(runId);
chat.cancel(runId);
await chat.shutdown();
```

Conversations are workspace-scoped. Reusing a conversation from a different selected folder is rejected before changing its draft; select its original folder or start a new conversation.

Only fixed narrow wrappers should be exposed over validated main-frame IPC. Subscribe to events before starting: local preparation/consent events can occur before the start reply arrives. Events include `runId` and `conversationId` for reconciliation; `status(runId)` provides the latest state if an event was missed. `wait(runId)` is a trusted test/main-process observation helper, not a renderer-supplied completion mechanism. One request can be active at a time; the last 20 statuses are retained in memory.

Main must prevent deleting the active conversation, changing workspace, restoring backups, or replacing stores while `chat.isActive` is true. Cooperative shutdown aborts an active provider request; a pending native dialog still needs to be closed. Do not treat Electron's fire-and-forget quit event as proof that final cancellation persistence completed.

## Approval and outgoing context

Every request separately requires a native main-process approval. Missing provider credentials or denial leaves an unsent conversation draft and makes no provider call. Credentials are read by the separate provider adapter; they are never passed through chat or the renderer. Having a configured key does not implicitly approve its use.

Approval data lists the explicit model; prompt/personality/memory character counts; whether memory was included; every selected file path and skill name/origin/character count; history count and characters; older history excluded; total serialized payload bytes; a rough text-token estimate; and the maximum output tokens. The notice discloses possible API charges, no automatic retries, and that the estimate is neither a dollar price nor billed-token guarantee. Quote or JSON-encode untrusted names/paths in native dialogs to prevent misleading line breaks.

- Prompt: at most 16 KiB; maximum five files and five skills, chosen explicitly.
- Combined serialized outgoing context: at most 64 KiB. Oversize selections reject before consent/network; content is not silently truncated.
- History: up to the last ten previously dispatched user messages or completed assistant messages. Unsent user messages and interrupted assistant messages are excluded. A leading assistant message is also omitted so history begins with a user turn for provider compatibility. All older eligible messages omitted from the request are explicitly counted in approval.
- Personality: a fixed authored instruction applies the saved balanced/warm/direct preference and optional light wit. It forbids claiming tools or completed actions. User memory, all skills (including bundled ones), and selected file text are reference data in a **user** message, never additional system/developer authority.
- File reads use the selected workspace's existing safe, bounded read API. Local context is snapshotted before approval; no context leaves the device until approval. Files may contain secrets despite their filenames, so review selections carefully.
- Output budget: integer 256–8192 tokens, default 2048. Stored/streamed assistant text has an independent 64 KiB bound; overflow aborts and cannot be labeled complete.
- No tool schemas, remote connector catalogs, function calls, automatic follow-ups, or retries are supplied by this service.

## History and streaming truthfulness

Provider `request-dispatched` means request bytes were handed to local transport, **not proof of server receipt**. Only that event records the user message as sent. The operation clears the draft only if it still matches the approved message, preserving any newer draft. A changed draft detected while native approval was open stops the request and requires another review.

Only a genuine returned provider response ID plus a dispatch event allows an assistant record. Complete responses are stored as complete; cancelled, incomplete, or failed responses with available text/provenance are stored as interrupted. Without a response ID, displayed partial output is not invented into assistant history. A cancellation can occur after a provider has accepted work and does not guarantee zero charges.

Stream events contain text deltas, safe status/disclosure strings, and final response ID/token usage when actually returned. Token usage is never guessed. No raw provider exceptions, credential values, request headers, or payloads are logged or forwarded. If local history persistence fails after dispatch, the service warns that work may have been sent and does not retry automatically.

## Verification

`node --test tests/chat.test.mjs` uses fake providers and temporary files only. It covers key absence/denial, dispatch gating, response provenance, usage, explicit outgoing context, untrusted skill boundaries, payload limits, last-ten history, cancellation, changing drafts, single-request concurrency, and error sanitization. Native Electron event delivery, dialogs, live model interoperability, network billing, and Windows shutdown behavior require separate integration validation.
