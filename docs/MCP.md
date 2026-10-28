# Read-only MCP discovery

This module adds **opt-in remote tool-name discovery**, not tool execution or an AI connection. `electron/mcp-discovery.mjs` makes no request until the injected main-process approval callback approves the exact saved endpoint. Tests use injected DNS/transport only: **no real MCP endpoint was contacted during development**.

## Protocol and compatibility

The current 2026-07-28 protocol uses per-request metadata instead of the former initialization/session exchange. Sebby sends one `tools/list` request with matching protocol-version metadata/header and `Mcp-Method: tools/list`. The official transport supports JSON and SSE; this implementation is deliberately a **JSON-only compatibility subset**, not a fully conforming general MCP client. It rejects SSE responses rather than pretending to support streaming. Legacy servers, auth-required endpoints, pagination beyond the first page, subscriptions and input-required exchanges are unsupported. It does not downgrade or retry automatically. See the official [Streamable HTTP specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), [tool-list specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), and [revision announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28/).

Request body:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { "name": "Sebby", "version": "0.3.0" },
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}
```

Headers: `Content-Type: application/json`, `Accept: application/json`, `MCP-Protocol-Version: 2026-07-28`, `Mcp-Method: tools/list`. No Authorization, cookies, client certificates, session identifiers, workspace data, user prompt, or model data are sent. Network metadata (including the user's public IP) is necessarily visible to the endpoint/DNS infrastructure; the consent UI should disclose this.

## Integration contract

```js
const discovery = new McpDiscovery({
  connectors, // ConnectorStore: endpoints are retrieved by saved ID, never a renderer URL
  approve: async ({name, url, description}) => nativeConfirm(name, url, description)
});
const snapshot = await discovery.discover(savedConnectorId);
discovery.status(savedConnectorId);
discovery.disconnect(savedConnectorId);
discovery.isBusy(); // any active attempt, including approval
discovery.shutdown(); // abort all attempts; permanently refuse new discovery
```

Native approval is required **every attempt**. The default callback denies. No grant is persisted, and no background reconnect occurs. The injected approval payload contains `connectorId`, `name`, `url`, `action: mcp-read-only-discovery` and a disclosure description. Approval must be a real main-process dialog, not an untrusted renderer boolean. Repeated attempts for the same connector while one is active reject. Active attempts are capped at 10; historical snapshots are capped at 50 (the bookmark-registry limit). Call shutdown during app quit; it aborts all attempts and prevents new discovery. Approval dialogs remain the host responsibility.

Returned states are ephemeral: `disconnected`, `error`, or `connected-read-only`, with `checkedAt`, `connectorId`, and sanitized `tools` summaries. Successful states include protocolVersion and truncated. **Connected-read-only means the most recent one-shot discovery succeeded, not an open authenticated session or current endpoint health.** Disconnect aborts active work and clears displayed summaries; it does not revoke any external account because none was authorized. Deleting/changing a bookmark should call disconnect to clear stale snapshots. Keep bookmarks' persisted status configured-not-connected.

The optional `resolve`, `transport`, `now` constructor injections are trusted test seams, not renderer parameters. Never expose them through IPC. `pinnedPost` is a narrow direct Node HTTPS implementation, intentionally separate from the renderer's denied network policy. This is an explicit main-process network exception, not permission to relax renderer networking.

## Boundaries

- HTTPS bookmarks only, with connector registry URL validation. DNS lookup happens after approval and is repeated every attempt. Every returned address must be in the conservative public-address allowlist; mixed public/private answers fail before transport.
- Direct HTTPS pins the selected address through its lookup callback while retaining the original hostname for TLS verification/SNI. No pooled sockets, redirect following, environment proxy, cookie jar, auth challenge handling or arbitrary headers. This intentionally does not support corporate proxy-only networks.
- IPv4 private, loopback, link-local/metadata, shared-address, multicast, documentation and reserved blocks are denied. IPv6 accepts only a conservative subset of global unicast, excluding mapped/private/local/transition/documentation ranges. This may reject legitimate endpoints. DNS validation is not a guarantee about the trustworthiness of a public server or the local network routing configuration.
- Eight-second HTTP timeout, 30-second overall timeout after approval, 256 KiB response cap. DNS waiting is abortable from the caller's perspective. Responses must be a matching JSON-RPC result with `resultType: complete` and a bounded tool array. Server errors are replaced by safe generic text; remote response bodies are not logged.
- At most 100 tool summaries returned, each with a bounded name and description; additional tools or nextCursor mark truncated. Schemas/icons/instructions are discarded, not interpreted. Names/descriptions are **untrusted text**: render with React text nodes, never HTML, do not promote them to developer instructions, and never infer that a tool is safe from its description.
- No `tools/call`, prompts, resources, sampling, elicitation, notifications, OAuth, credential forms, shells, model requests, external links or persistent execution permissions. Endpoint-side behavior cannot be controlled merely by naming a request read-only; only contact endpoints the user trusts.

## Verification

`node --test tests/mcp-discovery.test.mjs`: 9/9 PASS. Covers exact modern request metadata, approval denial without DNS/network, address policy, mixed-answer/rebinding rejection between attempts, redirects/auth/SSE/error refusal, bounded catalog summaries, input-required refusal, cancellation and hung-resolver cancellation. All transports and resolvers are fake test functions. Real DNS/TLS endpoint interoperability, OS approval UI, enterprise proxy behavior and end-to-end remote discovery remain **not run**.
