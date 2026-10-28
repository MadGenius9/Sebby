# Read-only GitHub connector

This document describes the read-only adapter. A separate default-denied [publication workflow](GITHUB-PUBLISH.md) and [exact-repository authority](GITHUB-AUTHORITY.md) now exist; these are not granted by configuring this reader.

The reader can inspect an explicitly selected GitHub.com repository through a narrow main-process service. It does **not** clone, execute repository code, write files, push commits, mutate issues, create OAuth clients, or automatically attach repository text to AI. Development verification used fake credentials, DNS, HTTPS transports, and OS encryption only. **No actual GitHub account connection or remote repository request was made.**

## Official API contract

This checkpoint pins the currently documented GitHub REST version `2026-03-10` and requests `application/vnd.github+json`:

- `GET /repos/{owner}/{repo}` for repository metadata. See [GitHub repository endpoints](https://docs.github.com/en/rest/repos/repos#get-a-repository).
- `GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1` for a bounded tree. GitHub accepts a tree SHA or ref name and can return a truncated tree. See [Get a tree](https://docs.github.com/en/rest/git/trees#get-a-tree).
- `GET /repos/{owner}/{repo}/git/blobs/{sha}` for one immutable blob chosen from a retained approved tree. JSON blob responses contain Base64 content. Fine-grained tokens require Contents: read for private resources; public resources can be requested without authentication. See [Get a blob](https://docs.github.com/en/rest/git/blobs#get-a-blob).

No server-returned URL, redirect, pagination URL, or content download URL is followed. GitHub recommends fine-grained tokens when feasible; authentication is sent in the Authorization header. See [Authenticating to the REST API](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api).

## Storage and tokens

`GitHubConfig(userData).load()/get()/save({owner,repo,ref,useToken})` stores only `sebby-github.json` with `{version:1,configuration}`. Empty initial owner/repo means not configured; `HEAD` is the initial ref; `useToken` defaults false. Owner/repository names are explicit, not URLs; refs are bounded, encoded, and exclude traversal/query patterns. No arbitrary headers, API bases, environment variable names, token fields, or executable configuration are accepted. Obvious PAT prefixes are rejected in repository/ref metadata, but metadata validation is not general secret detection.

`GitHubVault(userData,{safeStorage})` stores an OS-encrypted envelope under **`sebby-github-vault/credential.bin`**. The envelope is bound to service `github-api` and host `api.github.com`. Exclude that entire directory from every backup, export, project listing, log, and diagnostic bundle. Only non-secret configuration is eligible for a strict backup allowlist.

- `status()` exposes configuration/OS-storage availability, never token contents or validity.
- `save(token,{confirmed:true})` and `remove({confirmed:true})` require main's own flag after a native confirmation, not a renderer boolean.
- `getToken()` is internal to trusted main-process GitHub services. Never expose it over IPC.
- No token is read from environment variables. A stored token is sent only if the saved repository configuration explicitly enables it, and each read is independently approved.
- Use a fine-grained token restricted to the intended repository with read-only Contents and required Metadata permission. The app cannot inspect or reduce a token's granted privileges. A broader token still has broader authority outside this app, despite this reader using only GET. For optional publication, the user must separately choose appropriate Contents: write and Pull requests: write permissions; Sebby never upgrades scopes automatically.
- Removing the local token does not revoke it on GitHub. Organization authorization, token expiry and permission failures require the user's attention; no OAuth or automatic access escalation occurs.
- Current storage uses pinned Electron 45 safeStorage, denies unavailable encryption and Linux `basic_text`, and has no plaintext fallback. Files/directories reject symlinks, reads and blobs are bounded, and writes use exclusive temporary files plus rename. This does not claim an adversarial local-filesystem race guarantee or protection against all same-user processes.

The UI uses an uncontrolled password input and transient save IPC. It never places tokens in React state, browser storage, logs, URLs, or display text. Input clears immediately after invoking IPC, before native confirmation resolves. JavaScript/IPC copies cannot promise forensic memory zeroization.

## Main integration and consent

The exported classes are in `electron/github-storage.mjs` and `electron/github-reader.mjs`. `GitHubReader({config,vault,approve,resolve?,transport?})` provides `status()`, `metadata()`, `tree()`, `file({treeId,path})`, `cancel()`, `shutdown()`, `clearCache()`, and `isBusy`. Resolver/transport injections are trusted test seams, never renderer inputs.

Main must serialize config/token mutations against pending reads and native prompts, including the time before the reader reaches transport. After config or token changes, call `clearCache()` to invalidate old trees. Read intent wrappers should accept only the fixed method arguments; use main-frame sender validation. Main-owned save/remove dialogs must not display token values.

Each `metadata`, `tree`, or `file` operation requests separate native approval listing the repository, ref/operation, fixed API path, and whether authentication will be sent. Denial performs no DNS, token decryption, or HTTPS. A changed configuration after approval blocks dispatch. Cancellation/shutdown during pending credential-status inspection prevents a subsequent prompt. No network request is triggered by loading Settings, saving metadata, saving a token, or selecting a tree file without its distinct read action.

Reader results are `ok`, `denied`, `error`, or `cancelled`, not a permanent connected session. Successful observations include host, API version, repository, timestamp, and a bounded GitHub request ID when reported. Credential availability is not proof of access. There is no automatic identity lookup or `/user` call.

## Network and content limits

- Fixed `https://api.github.com:443`, GET only, normal TLS certificate/hostname verification, fresh direct HTTPS socket (`agent:false`), no environment proxy, redirects, cookies, or arbitrary request headers.
- DNS is resolved after approval. Every answer must pass the shared conservative public-address filter; the chosen numeric address is pinned while preserving the GitHub TLS hostname. Local/private/mapped addresses fail closed. Local routing/root-certificate compromise is outside this protection.
- 10-second HTTP deadline, 30-second overall post-approval deadline, 1 MiB response cap. No retries or automatic traversal to further API pages/subtrees. API rate/access errors are sanitized; raw remote error bodies and tokens are not returned.
- Tree input is bounded to 10,000 records; at most 300 supported text entries are retained. Hidden/sensitive-named paths, symlink/submodule modes, control/bidi filenames, unsupported extensions, and files over 256 KiB are excluded. At most three tree snapshots are retained in memory.
- File selection uses a path in one retained tree, never a renderer-supplied blob SHA or URL. The response's blob SHA and size must match that selection. The Git blob SHA-1 is recomputed over `blob <length>\0<bytes>` and must match. This detects accidental/substituted content, **not a cryptographic signature or proof that repository content is trustworthy**.
- Strict Base64, bounded decoded size, valid UTF-8, and no NUL bytes are required. Received code/instructions remain untrusted inert text rendered through React, not HTML. No repository content is automatically promoted into model instructions, tool authority, or chat attachments.

## Verification

Node tests cover metadata/tree/blob approval, public/token opt-in, retained-tree and hash integrity, no redirects, public DNS pinning, rate/auth sanitization, cancellation (including pending status), direct transport options, strict metadata schema, encrypted service binding, and vault refusal cases. DOM tests cover no automatic reads, transient masked token clearing, explicit read/cancel controls, and inert repository content rendering.

These tests create no network sockets for GitHub and never use real tokens or OS encryption. Live GitHub interoperability, real token permissions, native dialogs, native keyring/DPAPI, and end-to-end desktop behavior remain unverified.
