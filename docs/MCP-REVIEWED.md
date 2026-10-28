# Authenticated, manually reviewed MCP tools

This is a deliberately narrow **manual bearer-token, JSON-only MCP 2026-07-28 subset**, not a full OAuth client. Existing unauthenticated read-only discovery stays separate. No endpoint was contacted, account connected or real token used during development.

## User-visible boundary

Every endpoint is a saved public HTTPS MCP bookmark. Store only a dedicated token issued for that endpoint using the masked credential input and native confirmation; OS encryption must be available (never `basic_text`). Provider/GitHub keys are never inherited. Token audience cannot be verified independently for opaque manually provisioned tokens. Remove the token before deleting its bookmark; removal is local and does not revoke it at its issuer.

Discovery requires native approval before sending the dedicated token and normal network metadata. It retains a bounded validated schema catalog. The user separately grants one exact tool/schema for this app session, enters JSON arguments, prepares an immutable full-input review and acknowledges it before a fresh native invocation confirmation. **Tool effects are unknown and unverified**, including possible data deletion, disclosure, charges and irreversible actions. A valid schema or server `readOnlyHint` does not establish safety. There is no model/agent integration or automatic invocation.

Results are untrusted text/JSON objects, not instructions, attachments or proof of successful work. No resource URLs, images, HTML or linked content are fetched/rendered automatically. A `tool-error` is not a rollback. Cancellation, timeout, invalid responses or unsupported continuation after dispatch can leave **uncertain remote effects**; do not automatically retry.

## Main-only API

```js
const vault = new McpVault({ directory, safeStorage, connectors, approve });
await vault.load();
// status(connectorId), save({connectorId,token}), remove(connectorId)
// getBound(connectorId, exactURL, credentialGeneration): INTERNAL ONLY
const tools = new McpReviewed({ directory, connectors, vault, approve });
await tools.load();
await tools.status(connectorId);
await tools.discover(connectorId);
await tools.grant({catalogId, toolName});
tools.revoke({connectorId, toolName});
const {proposal} = await tools.prepare({catalogId, toolName, argumentsJson});
await tools.invoke({proposalId: proposal.id, digest: proposal.digest});
tools.discard({proposalId});
tools.cancel(); tools.shutdown();
```

All `approve` callbacks must be native main-process dialogs, never renderer booleans. Save-token approval metadata deliberately excludes the token. IPC validates the trusted app window and reserves operation state before asynchronous work. Token/connector mutations cross-lock discovery/calls; successful token changes clear catalogs/grants/proposals. The service independently rechecks endpoint/token generation after approval, DNS and token lookup. `getBound` never crosses IPC. `status` returns safe credential presence/generation, catalog, grants, busy flag and metadata history. All schemas/arguments/content remain ephemeral.

Vault records bind connector ID + exact canonical endpoint URL + random credential generation inside encrypted storage. Catalogs and session grants use that same binding plus tool/schema digest. Rediscovery invalidates old grants/proposals even for unchanged schemas. Catalogs and proposals expire after five minutes. Proposals are consumed on the first valid invocation attempt, before native confirmation; no replay after denied or uncertain calls. Server behavior can change even when its schema digest does not.

## Protocol and limits

Fixed saved HTTPS endpoint; no caller-selected URL, headers or transport in IPC. Every request validates all DNS answers against the existing conservative public-address policy, then pins the chosen address with original-host TLS validation. No redirects, proxy-environment use, cookies, pooled sockets, challenge following, OAuth discovery/registration, scope expansion, refresh token flow or automatic retries. Authorization is sent only in the bearer header.

Calls send `tools/list` or `tools/call` with matching protocol/version/method headers and required per-request `_meta`. Only matching JSON-RPC IDs with `resultType: complete` are accepted. JSON-only negotiation is an intentional compatibility subset: no SSE, old initialization/session protocol, sampling, elicitation, roots, subscriptions, tasks, input-required continuation or pagination. A server requiring those is unsupported, not silently downgraded.

Limits: 50 tools/catalog, 16 KiB schema, depth 6 / 100 schema nodes, 50 object properties, 8 KiB reviewed arguments, JSON depth 12 / 2000 nodes, 50 text result blocks, 256 KiB response, 8-second HTTP timeout and 30-second overall operation timeout after native consent. One active service operation, at most 50 catalogs / 20 pending proposals / 200 journal records (full journal blocks new calls; unresolved evidence is never evicted). The schema subset permits explicitly typed object/array/scalars, required known properties, bounded strings/arrays/numbers and primitive enums. References, dynamic references, regexes, unions/compositions, unknown schema keywords and open additional properties are rejected. Only the default/explicit JSON Schema 2020-12 dialect is accepted; this is not a general JSON Schema engine.

Strict JSON parsing rejects duplicate/prototype-related keys and nonfinite numbers. Credential-shaped fields and recognized token/private-key formats in arguments are rejected, not masked. This detector is defense in depth, **not a guarantee that arbitrary secrets cannot be submitted under innocuous names**. Full input review remains essential. Exact credential echoes in raw server responses are rejected before returning content; transformed secrets cannot be reliably detected.

## Storage and uncertainty

`sebby-mcp-vault/credentials.bin` is OS-encrypted and excluded from backups. Session grants/proposals/catalogs are never persisted. `sebby-mcp-history/history.json` contains endpoint/tool identity, input/schema digests, timestamps and outcomes only—no argument values, returned content or token. The application backup allowlist excludes these new directories unless explicitly reviewed otherwise.

Before a tool request is handed to transport, a `dispatching` journal entry must be atomically written and the temporary file flushed. Any post-attempt failure becomes `uncertain`; startup converts interrupted `dispatching` records to `uncertain` without network activity. This deliberately errs toward uncertainty even if a cancellation raced just before the socket write. Hashes are metadata, not encryption; low-entropy input hashes may reveal information through guessing. Local JSON state is not an independently tamper-proof audit log.

## Sources and verification

Official sources checked 2026-10-28:
- [MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [Authorization security](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations)

Full OAuth would require a separately reviewed implementation of resource metadata, authorization-server selection, resource indicators, PKCE, issuer/redirect validation and token lifecycle protections. This subset does not claim those features.

Node tests use injected resolver/transport, synthetic credentials and fake encryption only; cover binding, consent, strict schemas/JSON/secrets, redirects/auth/SSE refusal, public-address checks, uncertainty recovery, cancellation and metadata-only persistence. DOM tests mock bridge responses and verify explicit input acknowledgment, denial, token-input clearing and inert output. Real DNS/TLS interoperability, native credential storage, Windows consent rendering and remote effects remain unverified.
