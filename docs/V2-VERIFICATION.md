# Current verification

## Passed locally

- Server and web TypeScript checks.
- 51 workspace tests covering persistence, ownership/revisions, Git snapshots/diffs, source ZIP review, scoped agents/proposals, dependency selection, runner lifecycle fixtures, retained build outputs, knowledge search, mesh operations, Drive protocol fixtures and the companion broker/filesystem implementation.
- Production Vite/server builds and real HTTP smoke. The smoke checks source import/preview, knowledge, agent/proposal routes, retained-output delivery fixtures, unavailable-worker refusal and session isolation.
- The actual companion CLI paired over HTTP in a separate process, read a disposable source file, wrote a reviewed replacement with a local backup and was revoked. No host commands were dispatched through it.
- Three.js GLTFExporter output independently imported by Blender 4.3.2: one mesh, 108 vertices, 36 polygons and expected dimensions. Run with `SEBBY_BLENDER_BIN=/usr/bin/blender npm run test:workspace` to repeat this optional native check.

Drive tests use an injected Google transport, not a live account. The model loop uses a scripted localhost Hermes gateway, not a live provider. Docker transport tests use fixtures, not real containers. Those distinctions remain release gates. Hosted Windows Server 2022 HTTP/companion acceptance also passed in run 44011609262, including pairing, real source reads/writes, backup creation and revocation. This does not certify installation/ACL/antivirus behavior on the user’s desktop.

## Browser checks

Browser plugin is not available. Regular Playwright/Chromium fails during launch before navigation in this environment; earlier startup logs reported process singleton socket restrictions. Local browser launch remains blocked. Hosted Chromium acceptance passed on GitHub Actions run 44011023185 for commit 4fe1e87 (PR merge checkout), with screenshots reviewed at 1440×1000 and 390×844. It verified source/knowledge edits, extrusion/inset controls, undo/redo, numeric transforms, save/reopen, GLB download, connection controls and mobile page overflow, with no recorded page errors. Direct gizmo dragging, source ZIP file-picker interaction, agent review/apply UI and retained-build preview controls were not covered. Blender validation is a separate independent geometry check.

`npm run test:browser` now contains the real browser acceptance flow: local sign-in → source edit/save → knowledge create/search → editable cube/extrude/inset → undo/redo → transform/save → GLB download → reload/reopen → connection controls → mobile persistence/overflow check. Set `SEBBY_CHROMIUM_BIN` for an installed browser and `SEBBY_QA_DIR` for screenshots/check records outside the source tree. The GitHub workspace workflow runs this on a browser-capable Linux host. Evidence: https://github.com/MadGenius9/Sebby/actions/runs/44011023185 . The first mobile screenshot prompted a further layout fix that collapses project controls after opening a project; the mobile layout increment passed hosted browser acceptance in run 44011609262.

## Runtime checks

Docker is absent here. The adapter requires a preloaded digest-pinned image, rootless Docker, cgroup v2 and resource controls; it refuses direct host execution. `npm run test:docker` performs a real build with output transfer, syntax test, failing test and cancellation on an operator-configured worker. It provisions nothing. Run this on a real worker before calling the runtime verified.

## Remaining release gates

Live Google OAuth/Picker consent and a real import/export/revoke; native Windows companion installation, filesystem permissions and reconnect/revoke; a live configured agent editing/testing an imported project; real Docker/dependency-image execution; further browser coverage of gizmo dragging, proposals and build previews. Production hosting/authentication, a separate preview origin, backups and data retention also need deployment review.

Current product limits are explicit: 40 virtual text files per project, 1 MB saves, source-only imports, a plain-text editor, limited static previews, one-file companion operations and early polygon tools. GitHub URL cloning/PR delivery, working branches, broad framework hosting, parallel task orchestration, voice polish, mesh bevel/UV/material workflows and a packaged desktop installer remain roadmap work. This is a larger working foundation, not a finished autonomous coding OS.
