# Optional OpenAI Responses integration

The user chose reuse of an existing API key; no new key was created. This module is implemented and tested with fake transports only. **No real key was obtained, stored, printed or sent; no paid/model API call was made.** Main-process runtime credential presence is required before a request can dispatch. Missing credentials produce a truthful blocked state, not a fake assistant reply.

## Implemented app integration

The desktop now includes explicit provider-profile selection, profile/model metadata, credential-presence checks, ChatService and the named AgentRuntime. A configured provider is not a verified connection. Profiles support OpenAI, Anthropic and xAI adapters; this page describes the OpenAI Responses adapter specifically. Provider-specific protocols and mocked tests must not be interpreted as proof that a live account/model works.

Named AI tasks assemble selected context from local services, require native outbound-data approval, use bounded optional tools, and make a separate provider-backed Sebby coordinator review request before user acceptance can complete the task. The coordinator is not a canned answer or an automatic guarantee of correctness. Missing credentials leave tasks queued before approval. See [agent runtime](AGENTS.md) and [named team](TEAM.md).

## Runtime credentials

`new RuntimeCredentials({env: process.env})` reads only the existing `OPENAI_API_KEY` available to the Sebby main process. `status()` returns presence/source metadata; `getKey()` is **main-process-only** and must never be exposed through IPC, renderer context, logs, telemetry, backup/export, memory or chat. No .env files are automatically searched, written or loaded. Existing credentials should be supplied through an approved local environment/credential workflow, never pasted into the conversation or committed. Reuse authorization is not permission to extract secrets from other applications.

The older standalone `SecureCredentialStore` helper is not wired into the app. Current runtime credentials use `RuntimeProfileCredentials` and `ProfileVault`: selected provider/profile metadata resolves a provider-specific environment key or explicitly saved OS-encrypted key. Settings has an authorized uncontrolled masked input; a newly entered key necessarily exists transiently in renderer DOM/IPC memory, is promptly cleared, and is never retained in React state, localStorage or readback APIs. Native confirmation precedes vault persistence. Encrypted envelopes bind key to profile UUID and provider; backup metadata cannot redirect an old stored key to a different provider. Vault directories are entirely excluded from backups.

Secure storage refuses unavailable encryption and Linux basic_text; tests use fake encryption only. Electron 45 synchronous safeStorage is pinned and deprecated; migrate before Electron 46. Native OS storage remains unverified. See [BYOK](BYOK.md) and [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

## Provider contract

```js
const provider = new ResponsesProvider({credentials});
await provider.status();
const result = await provider.send({
  model: explicitlyChosenModel,
  input: explicitUserTextOrContextItems,
  instructions: trustedApplicationInstructions,
  maxOutputTokens: 2048,
  signal: abortController.signal,
  onEvent: event => handleSafeEvent(event)
});
```

There is **no guessed default model**; choose an available model deliberately in the app configuration. Model availability and account access are not verified by syntax validation. The caller must obtain approval before sending external content and show model/context/output-limit information. Existing-key choice alone does not approve arbitrary files or paid calls. Tools are optional narrowly named function schemas supplied by trusted main-process orchestration; no hosted tools or external MCP definition can be injected through arbitrary renderer payloads.

Input accepts a string or up to 100 explicit items: user/assistant text messages, function_call items and function_call_output items. System/developer roles in input, file/image/audio items and implicit project scanning are rejected. `instructions` is separate trusted application text; untrusted file/connector contents must remain clearly marked data, not promoted authority. Request JSON is capped at 128 KiB, instructions 16 KiB, function schemas 16 tools, and output limit 16–8192 tokens. These are size/output controls, **not a dollar spending cap** or a token-count prediction. The host must separately enforce request count/usage budgets and account-level spending controls.

Safe events:

- `request-dispatched`: Node request finish event—bytes handed to the local transport, not proof that the server received or processed them.
- `text-delta`: bounded text supplied by the model. Render as untrusted text, never executable HTML/code.
- `status`: streaming/completed/incomplete.

Result: `{status, text, responseId, usage, functionCalls, outputItems, error?}`. Status is completed/incomplete/cancelled/error. Usage is provider-reported input/output/total tokens, or null when unavailable; never a fabricated estimate. Only completed results are eligible for caller tool processing. Function calls contain callId/name/arguments; they are captured and validated against declared names, **never executed here**. Argument JSON must be an object; execution adapters must additionally validate schema, workspace, permission and exact action approval.

`outputItems` supports ordered text/function-call/encrypted-reasoning replay. Never send outputItems to renderer events, persist them in task/conversation records, or log their opaque encrypted payloads. Bounded encrypted reasoning items are preserved in their output order for main-process-only continuation. Requests explicitly include reasoning.encrypted_content. Missing encrypted state, duplicate output indexes and unsupported item types fail closed rather than silently dropping model state. This is not a universal model compatibility claim. No response ID is used to retrieve remote context automatically.

## Network and cancellation

Requests use one fixed `https://api.openai.com/v1/responses` endpoint, direct TLS, store:false, streaming SSE, no redirects, no environment proxy, no automatic retries, no background mode and no client credential file. Main-process Node HTTPS is an intentional exception to the renderer's denied network policy. Corporate proxy-only environments are unsupported. `store:false` is not a claim of zero provider retention or special account data policy.

The adapter consumes typed SSE events for text deltas, completed function items and terminal response events. Incomplete/disconnected streams are not reported complete. Events are bounded to 256 KiB, overall stream 2 MiB and visible text 256 KiB. Default total timeout is two minutes (maximum five). Abort closes the local request; it does not guarantee zero provider work or charges already incurred. Authorization/quota/network/provider errors are sanitized and do not echo server bodies or the key. The host should preserve any partial text as incomplete/error, not silently retry it.

Official protocol references: [streaming responses](https://developers.openai.com/api/docs/guides/streaming-responses) and [Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events). Responses emits semantic events; application completion must be established by the terminal event, not merely a closed socket.

## Evidence and remaining gates

`node --test tests/provider.test.mjs tests/credentials.test.mjs`: focused mocked tests PASS with fake API key strings, fake transports and fake OS encryption. Tests cover split SSE frames, request shape, usage, missing-key block, explicit context rejection, function-call capture/replay, undeclared/duplicate/malformed calls, partial stream, sanitized errors, no retry, abort/timeout and secure-store confirmation/fail-closed checks.

Not run: real OpenAI authentication, account/model availability, live streaming, usage/billing confirmation, native secure storage or end-to-end Windows behavior. No user credential has been persisted. Live tests require the existing credential to be supplied securely and explicit permission for the request/context/cost.

Reasoning continuation follows the official [reasoning guide](https://developers.openai.com/api/docs/guides/reasoning) and [encrypted-reasoning cookbook](https://developers.openai.com/cookbook/examples/responses_api/reasoning_items): tool turns retain reasoning and function items in the next explicit request. Sebby bounds each opaque encrypted item to 64 KiB and the full request/continuation to 128 KiB; the agent runtime may impose a tighter cap. Test fixtures establish replay and non-emission to UI callbacks, not live model interoperability.
