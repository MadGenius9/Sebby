# Sebby

A cloud-oriented coding workspace and 3D Studio, built on [Bot HQ](https://github.com/nickvasilescu/bot-hq).

This is the **v2 foundation**, not a finished autonomous coding OS. The previous Electron application is preserved on [`archive/sebby-v0.10`](https://github.com/MadGenius9/Sebby/tree/archive/sebby-v0.10). Development happens on `sebby-v2`; `main` remains the previous app until review.

## Try the workspace locally

Requires Node.js 22 or newer and npm. From the repository root:

```bash
npm ci
npm run workspace
```

Open **http://127.0.0.1:8787/workspace**. The email form selects a local development profile; it is not verified authentication and does not connect Google. This server binds to loopback. Do not expose it publicly or use a tunnel. It needs no AI, Orgo, Composio or Google credentials and makes no model calls.

Workspace projects are stored in SQLite under `data/grokbot.db` unless `DB_PATH` is set. Stop the server and preserve the entire `data/` directory when moving the workspace. Browser tabs are not the source of truth. Save explicitly or use Ctrl/Cmd+S before closing. A JSON export preserves current project content; Import project JSON creates a new project from it. Import source ZIP reviews source files and exclusions before creating a separate project; see [source import](docs/V2-SOURCE-IMPORT.md).

## Implemented in this milestone

- Create and reopen projects with persisted files and scenes.
- Add and edit bounded text files in a plain-text editor.
- Create primitives and editable polygon meshes in a Three.js viewport.
- Select objects; use transform gizmos/snapping, numeric transforms and material color.
- Extrude/inset faces, triangulate and edit vertices with validated polygon topology.
- Duplicate/remove objects, undo/redo changes within the open session, and export scenes as GLB.
- Save with revision checks; a stale tab cannot overwrite a newer save.
- Import project JSON or inspect a small source ZIP before creating a new project.
- Create a working Web starter and preview saved HTML/CSS/classic JavaScript.
- Compare saved source revisions through Git diffs.
- Keep a project brief/requirements/decisions with source-backed search and scoped agent retrieval.
- Connect Google Drive for selected-file references and new project exports after configuring OAuth.
- Pair a selected-folder companion for source reads and opt-in reviewed writes with local backups.
- Capture private Git snapshots and persist/stream build/test run records through a configured isolated Docker adapter.
- Cancel runs and track timeouts, output limits, interruptions and cleanup failures.
- Retain validated successful build files with revision/source/image/lock provenance.
- Download owner-only build ZIPs/files and prepare limited sandbox previews of retained static frontends.
- Assign existing agents to a project with scoped read/propose tools and optional build/test permission.
- Review exact file/scene proposals, then apply/reject them with revision protection.
- Select dependency images through exact npm lock hashes and prepare minimal operator build contexts.
- User-scoped project API, schema validation, request limits and cross-origin write checks.
- Light/dark token support inherited from Bot HQ and responsive workspace layout.

**Not connected yet:** an interactive terminal, GitHub URL cloning, Blender automation, advanced modeling, deployment, GBrain and cloud hosting. Connection controls report actual setup/connection state. Live Google and native Windows validation are still pending.

Projects currently contain up to 40 virtual text files (100,000 characters each), 100 scene objects and a 1 MB save request. Files are stored as project data; build/test runs materialize a private Git snapshot and transfer source to an ephemeral container. Docker readiness and native worker verification are required; no host execution fallback exists. See [connection setup](docs/V2-CONNECTIONS.md), [modeling](docs/V2-MODELING.md), [project knowledge](docs/V2-KNOWLEDGE.md), [runtime setup and limits](docs/V2-RUNTIME.md) and [build outputs/previews](docs/V2-BUILD-OUTPUTS.md).

## Existing Bot HQ services

Bot HQ's agent chat, Hermes adapter, Orgo viewer, voice and Composio service code are retained. The original service mode requires its own configured services, described in [.env.example](.env.example) and the [upstream architecture](docs/ARCHITECTURE.md). Copy `.env.example` to `.env`, configure your own deployment, then use `npm run build && npm start`. Agent chat links to `/workspace`; the workspace links back to chat in this mode.

The project API and scoped agent tools are integrated with existing sessions/MCP. Use the project Agents panel to assign a configured engine, review proposals and optionally enable runs. A pending proposal does not change source or scenes. See [project agents](docs/V2-AGENTS.md). We have not run live provider, OAuth, desktop or paid-service tests. The upstream shell/browser approval limitations still apply to that service mode. Do not treat this branch as a production deployment.

See [realtime voice setup and acceptance](docs/V2-VOICE.md) for the tracked voice-to-agent relay, call lifecycle checks and live-service requirements. Run `npm run gauntlet` for the complete automated gate.

## Checks

```bash
npm run typecheck
npm run test:workspace
npm run build
npm run test:http
```

51 tests cover SQLite/revision/proposal persistence, real Git snapshots/diffs, imports, preview compilation, owner/grant/review checks, actual MCP routing, a scripted headless gateway round trip, dependency selection/context preparation, runner lifecycle test doubles, bounded output collection, retained downloads and sandbox preview preparation. A trusted React/Vite fixture build passes; real base-image Docker and core desktop/mobile Chromium acceptance passed on GitHub Actions. A separate real HTTP smoke test passes for the built server, including the actual companion CLI. Blender independently imported the exported mesh fixture. Real dependency-image builds and live provider/Drive setup remain unverified. See [verification](docs/V2-VERIFICATION.md) for the current browser-testing limitation.

See [the implementation roadmap](docs/V2-ROADMAP.md), [architecture decisions](docs/V2-ARCHITECTURE.md), and [provenance](docs/UPSTREAM.md).

## License and assets

Bot HQ code retains its [MIT license](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md). The Orbit image is carried forward from this repository's earlier Sebby version. Third-party artwork is not relicensed by this project; see the notices. Upstream marketing screenshots and the large voice-test audio fixture are omitted from this foundation. The retained upstream e2e test requires real configured services and is not the workspace test suite.
