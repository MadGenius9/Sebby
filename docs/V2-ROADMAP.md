# Sebby v2 roadmap

## Product direction

One Sebby identity with coding and our own 3D Studio as the main workspaces. Cloud AI, optional computer companion, GitHub, and Google Drive. General-purpose product; no oilfield templates or branding. Blender integration can complement our modeler. Do not require local AI models.

## Milestone 1 — Foundation (this branch)

Persistent project documents, manual source editing, primitive 3D scenes, object transforms, session undo/redo, revision-protected saves, GLB and project JSON export. Preserve the prior Sebby application and Bot HQ attribution.

Acceptance: API tests and build pass; visible create/edit/save/reopen/export workflow must be verified on desktop and mobile before release. Hosted Chromium acceptance passed for the core source/knowledge/mesh save/export flow on desktop and mobile; direct gizmo dragging, saved restoration, agent review and retained-build preview have dedicated browser acceptance flows; live-provider acceptance remains. Local Chromium launch is still blocked.

## Milestone 2 — Complete coding task (in progress)

Implemented increment: private Git snapshots, saved revision diffs, a dependency-free Web starter, JSON import, saved browser-code preview, and a Docker build/test adapter with persisted/SSE logs, cancellation, limits and recovery. Agent assignments, file/scene proposals, user review/apply, actual MCP routing and a scripted headless gateway round trip are implemented. Dependency image selection matches exact npm lock hashes, with a minimal build-context helper. Build output retention, ZIP/file downloads and limited sandbox preview preparation are implemented. Reviewed source-only ZIP and public GitHub snapshot importers accept small projects without executing them; GitHub origin metadata is retained in a project file. A trusted React/Vite fixture build passes. Reviewed restoration creates a new revision while preserving history. 71 tests pass; live model acceptance remains pending; a separate real dependency-image acceptance command complements the base-image check; core hosted browser and real base-image Docker acceptance passed. See V2-RUNTIME.md.

Remaining: broaden dependency-image validation beyond the trusted React/Vite acceptance fixture, add full GitHub cloning/private access/sync and handle binary assets/larger projects, add working branches and review/apply diffs, host general framework previews on a separate authenticated origin. Project tools are now registered in the Hermes MCP adapter and bound turns skip desktop preparation; validate that workflow on a real engine. Expand task/run provenance before broader release.

Acceptance: import one small repository, request a change, inspect edits, execute its checks, open a preview and review the resulting diff. Demonstrate persistence and restart behavior. Only call a task complete with actual evidence.

## Milestone 3 — Project brain and Drive

Implemented initial source-backed project knowledge: requirements, dated decisions, file/reference provenance, and resumable task context. Keyword retrieval and scoped project_search are implemented. Live model acceptance remains pending. See V2-KNOWLEDGE.md. Evaluate GBrain behind a memory adapter; do not replace Sebby's identity or agent engine. See V2-ARCHITECTURE.md for research sources.

Google Drive selected-file OAuth, encrypted credentials, Picker/import/export/disconnect are implemented with fixture coverage. Live authorization requires configured Google credentials and user consent; see V2-CONNECTIONS.md. Import references and save deliverables. Account connection and sharing/deletion policies must be visible. A public repository is never a place for personal memory, Drive documents, credentials or live account data.

Acceptance: a new agent session recovers the right project requirements and cites its source; an authorized Drive file is imported and a report exported without mixing project scopes.

## Milestone 4 — Computer companion

A Node selected-folder companion now pairs outbound, lists/reads source and optionally writes reviewed existing files with backups. Its actual CLI passed a local HTTP round trip. Windows certification and native packaging remain pending; see V2-CONNECTIONS.md. Review the archived Electron services before reuse. Pair a local companion to the cloud with selected roots, scoped tools, connection status, revoke/disconnect controls and a visible action log. Secure command execution and process-tree cancellation need native Windows testing.

Acceptance: cloud AI edits and tests one selected local project. Disconnection prevents new commands. No unrelated folder becomes accessible.

## Milestone 5 — Modeling

Transform gizmos/snapping, bounded mesh data, face selection, vertex edits, triangulation, extrusion and inset are implemented. The exported fixture passes independent Blender import. Grouping, edge editing, bevel and larger modeling workflows remain. See V2-MODELING.md. Validated agent scene-operation tools now construct pending proposals from bounded modeling batches; evaluate Blender import/export and automation separately.

Acceptance: build an editable prop, modify it manually and through a real agent tool call, save/reopen, export and load in a game project. Current object transforms are not mesh editing.

## Milestone 6 — Agent coordination and delivery

Durable jobs, isolated Git worktrees, bounded parallel workers, independent review, dependency scheduling, usage tracking, GitHub PRs, CI results and deployment adapters. Add realtime voice, desktop polish and mobile task review once the complete coding loop works.

Acceptance: two workers produce changes that integrate, tests pass, a reviewer inspects the actual diff, and a preview release has traceable provenance. External publishing follows the project's configured permissions.
