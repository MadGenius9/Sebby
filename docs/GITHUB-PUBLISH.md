# Reviewed GitHub publication (0.7)

This optional workflow publishes selected local text changes to a **new `sebby/*` branch** in one explicitly configured repository. It does not connect to any account automatically, reuse ChatGPT's GitHub connection, modify an existing branch, force-push, merge, publish releases, execute builds, or invoke agents. No real GitHub write or credential was used to develop or test it.

## Required user decisions

1. Configure the exact owner/repository and opt into the dedicated, OS-encrypted GitHub token. Use a repository-scoped fine-grained token with Contents write; draft PRs additionally require Pull requests write, and check-run reads may require Checks read. Token presence is **not** proof of authorization or validity.
2. Separately grant native-confirmed persistent publication permission for that exact repository. This permission is not network consent and grants no automatic publishing.
3. Select at most ten supported local text files, an explicit existing base branch, a new `sebby/*` branch, and a commit message. Approve bounded preparation reads.
4. Inspect the complete before/after contents and replacement-style diff, then explicitly approve the exact immutable proposal digest for publication in a separate native prompt.
5. Optionally request a **draft** pull request with its own title/body and independent native consent. No automatic merge or rerun.

Repository visibility is not fetched or verified in this MVP: **treat every uploaded byte as public**. New branches and draft PRs can trigger existing repository workflows, notifications and CI costs even though Sebby does not modify `.github` files or run commands. Verify the target repository and its policies first. No source/output is automatically attached to AI.

## Bounds and validation

- One operation at a time. At most one retained in-memory proposal; one-shot after publish approval begins. The renderer must return both proposal UUID and digest, not its own content, URL, SHA, branch override or approval flag.
- Existing Workspace validation rejects path escapes, symlinks and sensitive/unsupported source paths. Publication additionally rejects all dot-prefixed path segments, control/bidi filenames, paths longer than 240 characters, duplicate selections and remote symlinks/submodules/directories/executable blobs. Only regular mode `100644` blobs are supported; existing executable files are refused rather than silently changing their mode.
- Maximum ten files, 64 KiB per before/after text, 512 KiB total full before+after review content. UTF-8 text only, no NULs, no binary uploads, no deletions. Full replacement-style diffs are intentionally verbose and never truncated (`truncated:false`). Files with unchanged contents are omitted.
- A complete, nontruncated base tree is required (at most 10,000 entries and 1 MiB response). Selected remote blobs are checked against their Git blob SHA-1 and exact decoded size before displaying a diff. Hashes establish object/content consistency, not authorship or code safety.
- Obvious PAT/API-key/private-key patterns are blocked in file content. This is a conservative heuristic, **not a comprehensive secret scanner**. Users remain responsible for reviewing all published text; filenames and heuristics cannot prove absence of sensitive information.
- API calls are direct TLS to fixed `api.github.com`, with public DNS pinning, no proxy/redirect fallback, fixed API version `2026-03-10`, narrow GET/POST schemas, bounded responses and cancellation. No arbitrary endpoint, header, HTTP method or token is accepted from the renderer.

## Immutable workflow and failure semantics

Preparation uses native-approved GETs only: exact base reference, immutable commit and tree, then selected blobs (at most 13 requests). The retained proposal pins repository/configuration, selected workspace root, base commit/tree and each local SHA-256. Renderer-visible proposal copies cannot mutate retained bytes.

After native publish approval, configuration, permission, workspace, local content hashes and base HEAD are rechecked. A durable metadata-only journal records intent before any remote mutation. The workflow then:

1. POST new blobs containing only reviewed bytes.
2. POST a new tree with the pinned `base_tree` and only reviewed regular paths, preserving unselected repository contents.
3. POST a new commit with exactly one parent: the previewed base commit.
4. Recheck base HEAD and local files again.
5. POST **create reference** for `refs/heads/sebby/...` pointing to the new commit.

There is no PATCH/update-ref, force update, deletion or overwrite of an existing branch. If another actor creates that branch first, GitHub's create-ref rejects the race; Sebby never falls back to updating it.

**Base HEAD checks are not an atomic GitHub compare-and-swap lease.** The base can move immediately after the final read; the new branch still points to a commit whose parent is the explicitly reviewed base. Publication cannot guarantee the base remains current. A changed base seen during recheck aborts further operations, potentially leaving already created objects.

After any attempted POST, transport loss, cancellation, rejected/malformed responses or local journal failure are conservatively reported as **uncertain**. Objects, a branch or a draft PR may already exist; no automatic rollback/retry occurs. The proposal is consumed and retained metadata identifies what was attempted. Inspect GitHub and the journal before any manual retry. A journal save error after an acknowledged branch/PR creation can leave the earlier durable intent rather than a falsely clean success. Startup recovery marks interrupted intent uncertain; it does not replay network writes.

Draft PR creation requires an authentic journal record in `branch-created`, a current branch ref still matching its recorded commit, and independent native approval of exact title/body/base/head. It sends `draft:true` and `maintainer_can_modify:false`; it never merges. A branch can still move between the check and PR creation; returned head SHA is checked, and mismatch is uncertain rather than silently accepted.

Check inspection is a separately approved, bounded GET for the journal's commit SHA, not an arbitrary renderer ref. It returns up to 50 sanitized check names/statuses/conclusions, observation time and a truncation flag. It does not fetch logs, rerun jobs, assert empty checks mean success, or continuously monitor CI.

## Core integration contract

`GitHubPublisher({workspace,config,vault,permissions,history,approveRead,approvePublish,approvePR,transport?,resolve?})`

- `prepare({paths,baseBranch,branch,message})` -> `{status:'ready',proposal}` or sanitized denied/error/cancelled result.
- `publish({proposalId,digest})` -> branch-created or denied/error/uncertain/cancelled, with available journal metadata.
- `createDraftPR({publicationId,title,body})` -> published or safe failure; no retry for uncertain records.
- `checks({publicationId})` -> `{status:'ok',commitSHA,checks,truncated,observedAt}` or safe failure.
- `status()`, `isBusy`, `cancel()`, `discard({proposalId})`, `clearCache()`, `shutdown()`.

`permissions.isAllowed({owner,repo})` is checked on each request. `history.begin(...)` and `advance(id,patch)` persist metadata only; source text, tokens and raw API responses are excluded. Main must lock config/key/authority/workspace/backup mutations across pending operations and clear retained proposals when configuration changes. Native consent adapters are trusted main-process capabilities; no renderer callback can grant consent. The transport/resolve test seams must never be exposed through IPC.

## Verification and limitations

Workflow tests use fake transport responses and temporary journal directories only. They verify immutable reviewed bytes, exact POST order, base-tree/parent pinning, create-only refs, denial, invalid paths/digests, config/local/base drift, blob verification, bounds, cancellation, uncertain partial writes, separate draft PR consent and commit-anchored checks. No real account, repository write, network request, token scope, platform encryption, Windows UI or GitHub Actions behavior is verified by these mocks.

Official current API references: [Git blobs](https://docs.github.com/en/rest/git/blobs), [Git trees](https://docs.github.com/en/rest/git/trees), [Git commits](https://docs.github.com/en/rest/git/commits), [Git references](https://docs.github.com/en/rest/git/refs), [pull requests](https://docs.github.com/en/rest/pulls/pulls), and [check runs](https://docs.github.com/en/rest/checks/runs). The API's `base_tree` preserves unspecified entries; omitting it would risk unintended removals. This workflow always supplies the pinned tree and never sends null blob SHAs.
