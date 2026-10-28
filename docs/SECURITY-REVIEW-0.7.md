# Incremental publication security review — 0.7

Source/mock-only review, 2026-10-28. **No real GitHub read/write, credential use, remote branch/PR, workflow run or paid action occurred during this review.** Publication code is optional and default-denied until the user configures scoped credentials and grants exact-repository authority locally.

## Reviewed boundaries

- Authority is canonical exact owner/repository, never wildcard. It permits only a reviewed new-branch workflow and separately approved draft PR; it is not an automatic publish grant. Authority and publication evidence are excluded from ordinary backups/import, so restored content cannot grant writes or forge publication history.
- Preparation reads at most ten manually selected bounded text files. Hidden/sensitive names, traversal, links, incompatible modes and some credential patterns are rejected. This is **partial detection**, not assurance that source is secret-free. Treat uploads as public unless repository visibility was independently verified.
- The retained proposal owns full before/after text, complete diff, source hashes, base commit/tree, destination branch and digest. Renderer-returned objects are clones. Publication revalidates local source/configuration, permissions and base HEAD before writes and again before branch creation. Consent names the exact repository/base/new branch/files/digest and warns of source exposure, CI triggers/costs and partial writes.
- Every network call is fixed `api.github.com` over pinned public DNS and verified direct TLS. Request schemas allow only bounded GETs and specific POST blob/tree/commit/new-ref/draft-PR operations. No redirects, generic endpoint, retries, PATCH/PUT/DELETE, force updates, existing-branch modification, merge or explicit workflow dispatch.
- Existing files are preserved using the verified base tree; only reviewed regular blobs enter the new tree. A single-parent commit is followed by creation of a **new** `sebby/*` ref as the last publication mutation. Ref collision fails rather than updating it. Existence of orphan Git objects after a partial workflow is possible.
- Draft PR creation requires recorded branch/commit provenance, another native approval, a branch SHA check and matching returned PR identity. Read-only check runs are anchored to the recorded commit, bounded, timestamped and may be incomplete; no automatic rerun or merge.
- Native/IPC wrappers serialize publication against GitHub configuration/token/read operations. Configuration/token changes invalidate retained previews. Workspace changes/restore are blocked during publication. Shutdown closes the publisher, rejects late authority consent and drains pending operation plus authority/history `.tail` queues (subject to main's outer shutdown deadline).
- Journal writes precede mutations and track metadata only. Any failure after an outbound mutation attempt is conservatively **uncertain**; interrupted pending records recover as uncertain. No automatic rollback/retry and no replay of an approved consumed proposal. Never equate cancellation with absence of remote side effects.

## Findings and corrections

1. Added JSON media-type validation for publication responses (matching reader policy); owner added regression.
2. Aligned transport branch-segment validation with publisher validation, excluding dot/lock components.
3. Confirmed pending native authority grant cannot persist after shutdown and read/config/token mutations cannot race a publication reservation.

No known blocking source finding remains in the reviewed paths. UI displays complete diffs and requires acknowledgment before invoking publication, followed by native confirmation. Native UI usability and trustworthy full-diff rendering have not been exercised here.

## Non-atomic limits

Base HEAD checks are **not GitHub compare-and-swap leases**. Another actor can move a base or new branch between a check and the subsequent request; post-response mismatch may mean a PR or remote object already exists. This is explicitly an uncertain/manual-inspection outcome, not a claim that the remote workflow was atomically rolled back. A successful API response and Git object evidence are not proof that uploaded code is safe, tested, or passing CI. Scoped token permissions are the user's responsibility; the app cannot reduce privileges in a broadly privileged token.

## Verification

- Independent `tests/github-publication-security.test.mjs`: **3/3 PASS** — proposal tampering, exact-repository revocation, native denial, exact uploaded bytes/new ref, and consumed-proposal replay protection.
- Independent `tests/github-publication-ipc-security.test.mjs`: **1/1 PASS** — cross-service mutation locks and shutdown during grant consent.
- `node --test tests/github-publication*.mjs tests/github-publish*.mjs tests/github-authority*.mjs tests/github-history*.mjs`: **35/35 PASS**.
- Entire `npm test`: **283/283 PASS** at this review snapshot.

Tests use injected fake transports, fixture repositories and synthetic tokens only. Real GitHub permission/error behavior, repository protections, branch races, CI billing, native dialogs and Windows encrypted storage remain unverified. No real publication is authorized by passing these tests.

Primary references: [GitHub references API](https://docs.github.com/en/rest/git/refs), [tree creation/base tree semantics](https://docs.github.com/en/rest/git/trees), [pull request API](https://docs.github.com/en/rest/pulls/pulls).
