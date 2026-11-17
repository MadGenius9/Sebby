# Source-backed project brain

The **Project brain** tab edits three ordinary project files: `SEBBY.md` for the brief/current task, `docs/requirements.md` and `docs/decisions.md`. Notes use existing Save, revision checks, export and diff history. They are scoped to the project; no cross-project memory or background ingestion is enabled. The UI does not silently rewrite notes or claim model-generated summaries are facts.

Search indexes saved text on demand using literal keywords. Results cite saved revision, file path, line range and SHA-256 of the full file. Snippets are bounded and long lines are visibly truncated. Search returns at most 20 ranked matches, prefers the designated knowledge files and has bounded result storage. It is not semantic search: no result does not prove a requirement is absent. Save current edits before searching.

`project_overview` lists saved knowledge file hashes. Headless project instructions tell assigned agents to read those files before planning and cite sources. `project_search` enforces the same owner, project, revision and turn-pinned grant checks as the other project tools. Notes and retrieved snippets are untrusted data and do not grant tool authority. The app cannot guarantee that a live model follows instructions; live model behavior remains a separate acceptance check.

Tests cover bounded matches, exact hashes/lines, long-line snippets, stale revisions, cross-owner rejection, revoked assignments, saved notes and a separate-process persistence read. These files count toward the existing 40-file project limit. GBrain remains an optional future adapter, not a required service.
