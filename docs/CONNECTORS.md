# Connector bookmarks, not active connections

`electron/connectors.mjs` stores local configuration bookmarks for one GitHub repository or one HTTPS MCP endpoint. It performs **no network access, authentication, OAuth, MCP discovery, or tool execution**. Every record reports `status: configured-not-connected` and `enabled: false`. There is no enable/connect API. Requested read-only scope labels describe future intent, not granted access.

## Contract

```js
const store = new ConnectorStore(app.getPath('userData'));
await store.load();
await store.add({name: 'Project', type: 'github', url: 'https://github.com/owner/repository'});
store.list();
store.get(id);
await store.update(id, {name: 'New label', url: 'https://github.com/owner/other'});
await store.remove(id, {confirmed: true});
const bookmarks = store.export();
await store.import(bookmarks, {confirmed: true});
```

`type` is `github` or `mcp`; update cannot change type. Removal and additive import require confirmation from the host UI/native process. Passing `confirmed: true` is not itself evidence of user consent. Import is all-or-nothing, rejects duplicates, and does not grant permissions. Export includes only version, names, types and URLs—no internal IDs/status. Exact object schemas reject unknown fields, including credentials, command arguments and custom scopes. Do not expose a general file-writing/import-path API to the renderer.

GitHub input must identify a repository on `github.com`, with no subpaths, custom ports, credentials, query, or fragment. A trailing `.git` is canonicalized away. MCP URLs must use HTTPS/public DNS hostname syntax; all IP addresses, obvious local/private names, punycode, ports, query/fragment and encoded path components are rejected conservatively. This is a bookmark validation policy, **not an SSRF defense**: public-looking names may resolve to private addresses, and paths may still contain unknown secret formats. A future network implementation must revalidate every resolved IP, redirect, final destination, TLS identity and tool permission at use time. Do not store secrets anywhere in bookmark labels or paths.

`requestedScopes` is fixed to `repository:read` (GitHub) or `tools:list` (MCP). These are human-readable Sebby intent labels, not claims that equivalent OAuth scopes exist or have been granted. Later GitHub OAuth and actual MCP permission negotiation require separate implementation and review.

## Persistence and limitations

Versioned `sebby-connectors.json` is plaintext in the supplied app-owned settings directory. Up to 50 bookmarks and 128 KiB; updates serialize and use exclusive unique temporary files before rename. Corrupt, symlinked or oversized state fails closed without overwriting the original. A failed-load instance cannot be used. Not a multi-process database or defense against hostile concurrent changes in the settings directory.

## Verification

`node --test tests/connectors.test.mjs`: 5/5 PASS on 2026-10-28. Covers canonicalization/persistence, disconnected states, unknown/credential fields, unsafe endpoint forms, conservative private target rejection, confirmation, additive atomic import, duplicate rejection and corrupt-state preservation. No service account or endpoint was contacted.
