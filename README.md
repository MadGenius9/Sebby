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

Workspace projects are stored in SQLite under `data/grokbot.db` unless `DB_PATH` is set. Stop the server and preserve the entire `data/` directory when moving the workspace. Browser tabs are not the source of truth. Save explicitly or use Ctrl/Cmd+S before closing. A JSON export preserves current project content; Import project JSON creates a new project from it.

## Implemented in this milestone

- Create and reopen projects with persisted files and scenes.
- Add and edit bounded text files in a plain-text editor.
- Create boxes, spheres and cylinders in a Three.js viewport.
- Select objects; change name, position, rotation, scale and material color.
- Duplicate/remove objects, undo/redo changes within the open session, and export scenes as GLB.
- Save with revision checks; a stale tab cannot overwrite a newer save.
- Import project JSON, create a working Web starter, and preview saved HTML/CSS/classic JavaScript.
- Compare saved source revisions through Git diffs.
- Capture private Git snapshots and persist/stream build/test run records through a configured isolated Docker adapter.
- Cancel runs and track timeouts, output limits, interruptions and cleanup failures.
- User-scoped project API, schema validation, request limits and cross-origin write checks.
- Light/dark token support inherited from Bot HQ and responsive workspace layout.

**Not connected yet:** project-aware AI tools, an interactive terminal, repository import, Google Drive, the PC companion, Blender, mesh/vertex editing, automatic modeling, deployment, GBrain and cloud hosting. The Connections screen reports these as planned.

Projects currently contain up to 40 virtual text files (100,000 characters each), 100 primitive objects and a 1 MB save request. Files are stored as project data; build/test runs materialize a private Git snapshot and transfer source to an ephemeral container. Docker readiness and native worker verification are required; no host execution fallback exists. See [runtime setup and limits](docs/V2-RUNTIME.md).

## Existing Bot HQ services

Bot HQ's agent chat, Hermes adapter, Orgo viewer, voice and Composio service code are retained. The original service mode requires its own configured services, described in [.env.example](.env.example) and the [upstream architecture](docs/ARCHITECTURE.md). Copy `.env.example` to `.env`, configure your own deployment, then use `npm run build && npm start`. Agent chat links to `/workspace`; the workspace links back to chat in this mode.

The new project API is integrated with existing sessions, but agents have no project read/write tools yet. We have not run live provider, OAuth, desktop or paid-service tests. The upstream shell/browser approval limitations still apply to that service mode. Do not treat this branch as a production deployment.

## Checks

```bash
npm run typecheck
npm run test:workspace
npm run build
npm run test:http
```

Ten tests cover SQLite persistence, revision history, real Git snapshots/diffs, imports, preview compilation, trusted starter syntax/build recipes, owner isolation, request/path validation, and the runner lifecycle using explicit test doubles. A separate real HTTP smoke test passes for the built server. Real Docker execution is unverified. See [verification](docs/V2-VERIFICATION.md) for the current browser-testing limitation.

See [the implementation roadmap](docs/V2-ROADMAP.md), [architecture decisions](docs/V2-ARCHITECTURE.md), and [provenance](docs/UPSTREAM.md).

## License and assets

Bot HQ code retains its [MIT license](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md). The Orbit image is carried forward from this repository's earlier Sebby version. Third-party artwork is not relicensed by this project; see the notices. Upstream marketing screenshots and the large voice-test audio fixture are omitted from this foundation. The retained upstream e2e test requires real configured services and is not the workspace test suite.
