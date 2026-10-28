# Bring-your-own-key provider adapters

Sebby has separate OpenAI, Anthropic and xAI adapters behind the same **main-process** interface. These are not interchangeable accounts, models, tool APIs or voice services. User-supplied keys remain in the approved credential subsystem; adapters accept injected `{status(), getKey()}` and never accept keys through chat requests. No new credentials were generated. **All adapter checks used fake transports and test-only strings; no live API calls or key reads occurred.**

## Implemented capability matrix

| Adapter | Text streaming | Declared local functions | Reasoning continuation | Voice | Model discovery |
|---|---|---|---|---|---|
| OpenAI Responses | Yes | Capture/replay, no execution | Bounded encrypted items | Not implemented | Not implemented |
| Anthropic Messages | Yes | tool_use/tool_result translation, no execution | Not implemented; thinking blocks/options fail closed | Not implemented | Not implemented |
| xAI Responses subset | Yes | Capture/replay, no execution | Bounded encrypted items in documented Responses subset | Not implemented | Not implemented |

This describes Sebby's implementation, **not every capability offered by each vendor**. Every send requires an explicit model identifier. There is no automatic latest-model selection, API discovery request, provider fallback, cost estimation or assumption that a model supports every feature. Syntax validation does not prove model/account availability. Capability constants are exported as `ANTHROPIC_CAPABILITIES` and `XAI_CAPABILITIES` with chat/tools/reasoningReplay/voice/modelDiscovery booleans.

## Shared caller interface

`new AnthropicProvider({credentials, transport?, timeoutMs?})` and `new XaiProvider(...)` provide async `status()` and `send({model,input,instructions?,maxOutputTokens?,tools?,signal?,onEvent?})`.

Events: request-dispatched (bytes flushed to local transport, not proof received), text-delta, status. Results: status, text, responseId, provider-reported usage or null, functionCalls, main-only outputItems, safe error. Do not execute incomplete/error results. Native send approval must identify provider/model, selected context and output limit; an explicit connection test is still a potentially paid generation and uses the same approval path. Merely saving/selecting a profile must not call a service.

Common bounds: 128 KiB explicit request context, at most 100 items, 16 declared functions, 16–8192 output tokens, 256 KiB visible text/event, 2 MiB stream, default two-minute timeout (maximum five). These are not dollar budgets. Requests are direct fixed HTTPS endpoints with TLS verification; no caller base URL, redirects, environment proxy, retries, hosted server tools or automatic cross-provider failover. Raw vendor errors are not returned. Cancel closes local transport but cannot guarantee work already started is unbilled.

Keys are provider-specific. Never try an OpenAI key against Anthropic/xAI or vice versa. Lock a running conversation/tool loop to its provider profile: encrypted reasoning and vendor-specific continuation must not migrate across providers. Preview imported history as text if the user explicitly wants cross-provider context rather than silently replaying opaque items.

## Anthropic specifics

Uses `https://api.anthropic.com/v1/messages`, x-api-key authentication, and anthropic-version 2023-06-01. It maps trusted instructions to system, explicit text into messages, declared function schemas into input_schema, function calls into assistant tool_use blocks and results into user tool_result blocks. Adjacent same-role blocks are combined. See the official [API overview](https://platform.claude.com/docs/en/api/overview) and [Messages reference](https://platform.claude.com/docs/en/api/http/beta/messages/create).

Its parser handles message_start, text/input_json content-block deltas, block stops, usage/stop updates, and message_stop. Tool arguments must form a valid object only after completion. max_tokens/pause_turn/refusal are incomplete, not successful continuation; thinking, signed/redacted reasoning and server-tool blocks are explicitly unsupported. No thinking beta or extended-thinking flag is sent. Usage normalizes reported fresh input plus any reported cache read/creation input tokens, and output tokens; it does not infer cost. See [Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming).

No Responses-style store flag is invented for Anthropic. Absence of a storage flag is not a retention promise. Review the applicable vendor/account data policy separately.

## xAI specifics

Uses only `https://api.x.ai/v1/responses` with bearer authentication. The official reference documents Responses input/output, function tools, parallel_tool_calls, and store controls. This adapter reuses Sebby's bounded Responses codec while supplying a distinct fixed transport and status identity. Sends store:false and include reasoning.encrypted_content, retains opaque reasoning for same-provider replay, and refuses arbitrary feature options. See [xAI Responses reference](https://docs.x.ai/developers/rest-api-reference/inference/responses) and [reasoning guide](https://docs.x.ai/developers/model-capabilities/text/reasoning).

Supported subset is text, declared functions and encrypted reasoning. Hosted web/X search, code execution, image generation, remote MCP, compaction, audio and vendor-specific server outputs are not enabled; unsupported output items fail closed. The shared parser's strict completed-item inventory comparison may reject a vendor/model variant rather than guess at missing state. No claim of universal Responses compatibility is made. Vendors' available tools differ; see [xAI tools overview](https://docs.x.ai/developers/tools/overview).

## Evidence

`node --test tests/anthropic-provider.test.mjs tests/xai-provider.test.mjs`: 10/10 PASS with fake SSE/credentials. Covers native request conversion, text/usage streaming, tool replay, missing keys, unsupported reasoning/options, undeclared tools, malformed JSON, premature termination, cancellation/timeout, safe authorization errors, xAI encrypted-state isolation and provider status identity. Shared Responses tests additionally cover frame limits, terminal inventory, refusal, phase metadata and no retries.

Not run: actual Anthropic/xAI account authentication, model availability, billing, live streaming/tool continuation, real secure credential storage, native permission flows or voice. User must supply each provider's own key through the approved masked local credential flow and explicitly approve any live request.
