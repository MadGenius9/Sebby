# Exact repository publication authority and history (0.7 source track)

These main-process services implement local publication permissions and metadata history. They do not own tokens, call GitHub, prove account permissions, or enable execution. No live GitHub write was performed to verify them. Main/publisher integration must enforce the contracts below; renderer calls must never supply raw journal transitions or approval decisions.

## Authority

`GitHubAuthority(userDataDirectory, {approve})` exposes asynchronous `load()`, synchronous defensive-copy `list()` and `isAllowed({owner,repo})`, and asynchronous `grant({owner,repo})` / `revoke({owner,repo})` returning `{approved,allowed}`.

- Default is no repositories. Names are strictly validated, normalized to lowercase and compared as exact owner/repository pairs. No wildcard, organization-wide authority, URL or path is accepted.
- Every grant/revoke invokes the injected trusted native confirmation with `action: grant-github-publication | revoke-github-publication`, exact owner/repo and the two fixed capabilities `new-branch-commit`, `draft-pr`. Only literal `true` grants consent. Default callback denies. Permission is not granted by chat text, a model, an imported backup, selecting a read connector or possession of a token.
- This permission does not replace each operation's review and native outbound consent. Publisher must recheck it at each mutation boundary and before a later draft-PR operation. Revocation stops future authorized steps, not requests already accepted by GitHub; partial/uncertain remote effects must remain visible.
- Allowed scope is a **new** branch commit and optional **draft** PR, never updating an existing ref, force-push, merge, delete, secrets/workflow administration or repository creation.
- Storage `sebby-github-authority.json`: `{version:1,repositories:[{owner,repo,grantedAt}]}`, maximum 100 repositories, exact fields. Unknown authority flags are rejected. Tokens and arbitrary capability fields are forbidden.

The local OS account/user-data directory is the trust boundary, not a cryptographically authenticated permission database. An attacker who can rewrite app code or app-data can bypass local controls. Native confirmation must not claim protection from a fully compromised host. The app's single-instance requirement is important: serialization covers one service instance, not separate processes.

## Metadata-only publication history

`GitHubHistory(userDataDirectory)` exposes `load()`, `list()`, `get(id)`, `begin(input)` and `advance(id,patch)`.

Begin **after** native publication consent, before any write request:

```js
await history.begin({
  owner, repo, baseBranch, baseSHA, newBranch,
  files: [{ path: 'src/example.ts', sha256: '<64 lowercase hexadecimal characters>' }]
});
```

Returns a random UUID record: `id,owner,repo,baseBranch,baseSHA,newBranch,files,phase,outcome,treeSHA,commitSHA,prNumber,errorCode,createdAt,updatedAt`. Timestamps are epoch milliseconds; Git object SHA values are 40 lowercase hexadecimal characters. Paths/hashes are metadata, not file content. They can still reveal project structure; protect user data accordingly.

Only publisher/main code calls `advance(id,{phase,treeSHA?,commitSHA?,prNumber?,errorCode?})`. Valid phase sequence:

```text
prepared → creating-objects → commit-created → creating-branch → branch-created
                                                               ↓ (optional separate consent)
                                                          creating-pr → published
```

The branch is created **after** object/commit preparation, never overwritten. `commit-created` requires verified `treeSHA` and `commitSHA`; `published` requires a verified draft PR number. Accepted evidence is immutable. The service validates shape/transitions but cannot independently verify a GitHub response; the publisher must validate matching repository/ref/commit/draft status from the actual response before providing evidence. A branch-only result remains `branch-created`, not a claimed published PR.

Failure/cancellation transitions are bounded. `creating-objects` and `creating-pr` may transition to `cancelled` only when the trusted publisher has established no request was attempted for that stage. Once an outbound mutation is attempted, uncertain outcomes must use `uncertain`. Cancellation of a PR intent retains any earlier verified branch/commit evidence; it does not delete that branch. `uncertain`, `failed`, `cancelled` and `published` are terminal; no silent retry. `errorCode` is limited to `network-error`, `timeout`, `cancelled`, `response-invalid`, `permission-denied`, `remote-rejected`, `restart-interrupted`. No raw provider errors, headers, tokens, source, diffs, prompt text or arbitrary messages are accepted. Network timeouts/partial writes require `uncertain`, not a claimed rollback or clean failure.

On load, interrupted `prepared`, `creating-objects`, `commit-created`, `creating-branch` or `creating-pr` records become `uncertain` with `restart-interrupted`; they are never automatically replayed. Confirmed branch-only and published results remain unchanged. Inspect uncertain operations manually on GitHub before starting a new operation; local cancellation cannot undo accepted requests.

Storage `sebby-github-history.json`: `{version:1,operations:[...]}`, maximum 200 records / 2 MiB, at most 100 paths per operation. The store refuses new operations when full rather than silently discarding unresolved evidence. There is not yet a history deletion/export UI. Each write validates the full document, writes a unique temporary file with restrictive permissions, syncs it and atomically renames it. This is not a guarantee against all filesystem/power-loss failure modes. Concurrent calls within a single instance serialize without lost updates. Corrupt/symlinked/oversized stores are rejected and preserved; mutation requires a successful load.

## Backups and packaging

Neither authority nor publication history is in `BACKUP_FILES`. Backups cannot grant restored publication authority or replay history. Credential vaults remain excluded and separately owned. The main process chooses user-data storage paths; no renderer-controlled directory or filename is accepted. These stores must never be packaged into an installer or committed with source.

## Evidence and remaining gates

Node fixture tests cover default deny, dedicated approval, canonical exact matches, unknown fields, corruption preservation, concurrent updates, immutable verified evidence, invalid transitions, backup exclusion and restart uncertainty. They are not proof of native dialog behavior, live GitHub response verification, actual publication, durable behavior on every Windows filesystem, or branch-race handling. Publisher integration, per-operation review, cancellation and native Windows verification remain required.
