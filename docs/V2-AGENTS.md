# Project-aware agents

## User workflow

1. Run the full Sebby service with a configured Hermes engine. The provider-free local workspace remains useful for manual editing, but does not start AI engines.
2. Create/open a project and save your files. Open **Agents**, select an existing configured agent, choose whether it may start builds/tests, and assign it.
3. Open that agent's chat and request a change. Assignment shares this project's saved source/scene with the agent's configured model provider when the tools request it; source is not automatically sent merely by opening the panel.
4. The agent reads project metadata, files and/or scene, then creates a proposal. The source does not change yet.
5. Return to **Agents**, refresh proposals, and select one. Review the complete source diff and, when applicable, the previous/proposed scene JSON. Apply or reject it. Save/export manual edits before applying.
6. Once applied, the agent can observe the applied revision. If build/test permission is enabled and an isolated worker is available, it can start a run and read actual persisted results.

Assignment applies to the agent's turns until unassigned, including any existing recurring tasks configured for that agent. Reassignment, permission changes and unassignment rotate/revoke its grant and invalidate pending proposals. New calls are refused under old grants. Already-running builds are not undone; cancel them in **Runs**.

## Tools

| Tool | Result |
|---|---|
| `project_overview` | Assigned project/grant IDs, saved revision, file metadata, scene count and run permission |
| `project_read_file` | One exact-revision text file |
| `project_read_scene` | The exact-revision primitive scene |
| `project_propose_changes` | Persistent pending proposal of up to ten file changes and/or a replacement scene |
| `project_proposal_status` | Pending/applied/rejected/revoked status, staleness and applied revision |
| `project_start_run` | An isolated build/test request, only under explicit run permission |
| `project_run_status` | Persisted state, source/image/lock provenance and bounded run output |
| `project_build_outputs` | Retained file manifest for a successful run; preview candidacy is not visual verification |

There is no model tool to apply a proposal. Only the user's authenticated apply endpoint updates source. The review hash binds the stored candidate, author, grant, summary and base revision. Apply checks ownership, pending state, current grant, the exact review hash and unchanged base revision in one database transaction. Repeated, stale, revoked and no-op proposals cannot silently overwrite work.

Every app-owned agent turn captures its assignment grant. The MCP context pins subsequent calls to that grant; changing assignments mid-turn does not redirect old task calls into another project. Run authorization is checked before dispatch, after worker readiness and again after asynchronous snapshot preparation.

## Desktop separation and honest boundaries

A project-bound turn skips automatic Orgo desktop provisioning; it uses the project tools. Ordinary unassigned turns keep their upstream desktop behavior. This does not remove Bot HQ's existing agent-count limit or certify managed-engine startup on a real host.

The project MCP layer enforces these grants. Hermes' existing native shell/browser capabilities are separate and retain the upstream approval/isolation limitations. Prompt instructions tell the agent to use project tools, but instructions are not a security sandbox. Further engine isolation is necessary before treating the entire agent as confined to its project.

## Verification

Tests exercise real proposal persistence, Git diffs, HTTP handlers, exact-review application, stale/revoked grants, ownership, and actual MCP tool dispatch. A scripted local Hermes-compatible gateway drives one real turn queue/SSE/MCP round trip and confirms no desktop lease is created. That gateway is a test fixture, not a live model. Live Hermes/provider calls and visible review interactions are still unverified.
