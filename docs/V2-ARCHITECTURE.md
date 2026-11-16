# Sebby v2 architecture decisions

## Preserve history, replace the active foundation on a branch

The starting Sebby commit is `0500b99b40fc13d8456a5c7baeecc80f246e2870`. Archive branch: `archive/sebby-v0.10`. This branch imports Bot HQ at `decf9a215cddd8792a5f20f4a11a87d4dffa6d15` as the active tree. Main and Git history remain intact. Reuse of old desktop services requires code and native behavior review; source presence is not proof of working native behavior.

## Keep agents, execution and screens separate

Bot HQ currently couples a bot turn to an Orgo screen. The new project document API does not require an agent or screen. A later runner adapter will own executable workspaces; screens remain an optional capability for visible browser/GUI tasks. Do not simply increase the four-screen limit to claim scalable workers.

Hermes remains the initial agent engine. Chat, MCP and model selection remain upstream code in this milestone. Project tools are intentionally not registered with agents until there is an execution boundary and a complete verified coding loop.

## Project storage

`workspace_projects` is an additive SQLite table in the existing DB. Every row has a user foreign key, validated document, update timestamp and revision. All project reads/writes require the existing session. Writes use an atomic `WHERE revision=?` update, returning 409 for stale saves. UI content is plain text, not executed HTML. The first milestone has no host filesystem project paths or shell command API.

The local workspace entry point imports no provider/desktop services and binds to 127.0.0.1. Its email selector is for development only. Production authentication remains a separate deployment requirement.

## 3D documents

Scenes are explicit bounded JSON: UUID, primitive kind, name, position, degree rotation, positive scale and hex color. The viewport and GLB exporter interpret that schema. Session undo/redo retains project snapshots; save history is not yet durable undo. Mesh tools should evolve this versioned scene format rather than store arbitrary executable scripts.

## Research: shared project brain

User supplied video: https://www.youtube.com/watch?v=cK17gxDouMo (identified by search as “I Turned Garry Tan's GBrain into a Full AI Operating System”). YouTube content/transcript retrieval was unavailable. No claims here about specific features demonstrated in the video.

Primary source reviewed separately on November 16, 2026: https://github.com/garrytan/gbrain/blob/master/README.md . Its documented patterns include shared cross-agent knowledge, source-backed notes and decision logs, keyword-first retrieval, optional synthesis with citations, and MCP integration including Hermes and Codex.

Design proposals for Sebby: retrieve scoped project knowledge before a task; store durable decisions with their sources and dates; distinguish source facts from model summaries; allow correction; keep connector source scope attached to retrieved content. Put memory behind an adapter so a GBrain integration is optional. Do not install GBrain, enable background ingestion, import private files or set up scheduled enrichment as part of foundation work.

GBrain is a candidate memory layer, not a substitute for the coding runtime or 3D geometry tools. Evaluate current stable docs, deployment requirements and privacy boundaries before implementation.
