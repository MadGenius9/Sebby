# Public GitHub source import

Choose **Import GitHub repository**, enter `https://github.com/OWNER/REPO` (or its `.git` URL), choose a project name and optionally enter a branch, tag or commit. **Inspect GitHub repository** resolves the requested revision to a full commit SHA, downloads that commit's source ZIP, and shows included/skipped files and origin details. No project is created until **Create project from reviewed files** is selected.

The created project is an editable snapshot. `SEBBY-GITHUB-SOURCE.json` records the canonical input repository URL, requested revision, resolved commit and SHA-256 of the observed ZIP. That record is ordinary editable project data, not a signature or proof that later source still matches the remote commit. Imported code remains untrusted and is not executed, installed or published by inspection/import.

## Boundaries

- Only public repositories on `github.com` over HTTPS. No GitHub account/token is used, and app cookies or credentials are never sent to GitHub.
- Repository URLs must contain exactly owner/repository. Embedded credentials, ports, query strings, fragments, traversal and arbitrary archive URLs are refused. A moved repository must use its current canonical URL.
- The server contacts fixed GitHub API endpoints and accepts only the expected HTTPS `codeload.github.com` redirect path bound to the resolved commit. Downloads use manual redirects and do not forward API headers to the archive host.
- Network work has a 25-second deadline; ZIP inspection has its own bounded deadline. Metadata/SHA bodies and actual streamed archive bytes are bounded, not just their declared Content-Length. The archive cap is 4 MB.
- Existing source policy applies: at most 512 ZIP entries, 100 KB per source file and 600 KB total, UTF-8 text and supported relative paths. GitHub snapshots allow up to 39 source files plus one generated origin record within the existing 40-file/JSON budget. A conflicting reserved origin path rejects the candidate.
- At most two simultaneous inspections per server process and one per user. GitHub's anonymous API rate limit is shared by the server IP; refusals are reported and require a later retry.
- History, remotes, working branches, private access, submodule contents, LFS objects, automatic synchronization and pull requests are not included. Binary/large projects still require a later workspace-storage increment. The importer does not claim a full Git clone.

## Verification

Six new tests bring the workspace suite to 57. They cover URL/redirect/ref restrictions, commit pinning, no credential forwarding, filtering, preserved provenance, corrupt/oversized data, actual streaming limits, owner/origin checks, inspection without persistence, project creation/preview and concurrency recovery.

`npm run test:github` is an explicit real public-network check against `octocat/Hello-World`. It passed here with resolved commit `7fd1a60b01f91b314f59955a4e4d4e80d8edf11d`, imported README plus origin record, and no database project creation. It makes no provider calls or GitHub writes. It is separate from deterministic CI fixtures because upstream availability and anonymous rate limits can fail independently of application correctness.

The browser acceptance script uses a clearly marked network-review fixture for this UI increment, then the real server to create/edit/save/reopen the project. It captures `desktop-github-import.png`. Passing parser/API tests alone is not proof of a passing browser interaction; inspect the latest CI run for that result.
