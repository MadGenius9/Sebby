# Sebby v2 roadmap

## Product direction

One Sebby identity with coding and our own 3D Studio as the main workspaces. Cloud AI, optional computer companion, GitHub, and Google Drive. General-purpose product; no oilfield templates or branding. Blender integration can complement our modeler. Do not require local AI models.

## Milestone 1 — Foundation (this branch)

Persistent project documents, manual source editing, primitive 3D scenes, object transforms, session undo/redo, revision-protected saves, GLB and project JSON export. Preserve the prior Sebby application and Bot HQ attribution.

Acceptance: API tests and build pass; visible create/edit/save/reopen/export workflow must be verified on desktop and mobile before release. Browser acceptance is currently blocked in this environment, not passed.

## Milestone 2 — Complete coding task (in progress)

Implemented increment: private Git snapshots, saved revision diffs, a dependency-free Web starter, JSON import, saved browser-code preview, and a Docker build/test adapter with persisted/SSE logs, cancellation, limits and recovery. Ten tests pass; container and browser validation remain pending. See V2-RUNTIME.md.

Remaining: validate the isolated worker on a real Docker host, provision dependency images with lockfile matching, import repositories, add working branches and review/apply diffs, return build artifacts, and host previews on a separate authenticated origin. Add project tools to the Hermes MCP adapter. A browser/desktop screen must be optional for coding workers.

Acceptance: import one small repository, request a change, inspect edits, execute its checks, open a preview and review the resulting diff. Demonstrate persistence and restart behavior. Only call a task complete with actual evidence.

## Milestone 3 — Project brain and Drive

Add source-backed project knowledge: requirements, dated decisions, file/reference provenance, and resumable task context. Start with keyword retrieval. Evaluate GBrain behind a memory adapter; do not replace Sebby's identity or agent engine. See V2-ARCHITECTURE.md for research sources.

Connect Google Drive with explicit OAuth scope selection and authorized-file handling. Import references and save deliverables. Account connection and sharing/deletion policies must be visible. A public repository is never a place for personal memory, Drive documents, credentials or live account data.

Acceptance: a new agent session recovers the right project requirements and cites its source; an authorized Drive file is imported and a report exported without mixing project scopes.

## Milestone 4 — Computer companion

Review the archived Electron file/credential services before reuse. Pair a local companion to the cloud with selected roots, scoped tools, connection status, revoke/disconnect controls and a visible action log. Secure command execution and process-tree cancellation need native Windows testing.

Acceptance: cloud AI edits and tests one selected local project. Disconnection prevents new commands. No unrelated folder becomes accessible.

## Milestone 5 — Modeling

Grow from primitive scenes to transform gizmos, snapping, grouping, mesh data, vertex/edge/face selection, extrusion, inset and bevel. Add validated AI scene-operation tools with preview/checkpoints; evaluate Blender import/export and automation separately.

Acceptance: build an editable prop, modify it manually and through a real agent tool call, save/reopen, export and load in a game project. Current object transforms are not mesh editing.

## Milestone 6 — Agent coordination and delivery

Durable jobs, isolated Git worktrees, bounded parallel workers, independent review, dependency scheduling, usage tracking, GitHub PRs, CI results and deployment adapters. Add realtime voice, desktop polish and mobile task review once the complete coding loop works.

Acceptance: two workers produce changes that integrate, tests pass, a reviewer inspects the actual diff, and a preview release has traceable provenance. External publishing follows the project's configured permissions.
