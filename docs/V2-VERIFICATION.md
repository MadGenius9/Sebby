# Current verification

## Passed locally

- Server and web TypeScript checks.
- 57 workspace tests covering persistence, ownership/revisions, Git snapshots/diffs, source ZIP review, scoped agents/proposals, dependency selection, runner lifecycle fixtures, retained build outputs, knowledge search, mesh operations, Drive protocol fixtures and the companion broker/filesystem implementation.
- Production Vite/server builds and real HTTP smoke. The smoke checks source import/preview, knowledge, agent/proposal routes, retained-output delivery fixtures, unavailable-worker refusal and session isolation.
- The actual companion CLI paired over HTTP in a separate process, read a disposable source file, wrote a reviewed replacement with a local backup and was revoked. No host commands were dispatched through it.
- Three.js GLTFExporter output independently imported by Blender 4.3.2: one mesh, 108 vertices, 36 polygons and expected dimensions. Run with `SEBBY_BLENDER_BIN=/usr/bin/blender npm run test:workspace` to repeat this optional native check.

Drive tests use an injected Google transport, not a live account. The model loop uses a scripted localhost Hermes gateway, not a live provider. Unit Docker transport tests use fixtures; the separate real rootless worker acceptance now passed on GitHub run 44012435801. Live Google/model distinctions remain release gates. Hosted Windows Server 2022 HTTP/companion acceptance also passed in run 44011609262, including pairing, real source reads/writes, backup creation and revocation. This does not certify installation/ACL/antivirus behavior on the user’s desktop.

## Browser checks

Browser plugin is not available. Regular Playwright/Chromium fails during launch before navigation in this environment; earlier startup logs reported process singleton socket restrictions. Local browser launch remains blocked. Hosted Chromium acceptance passed on GitHub Actions run 44011023185 for commit 4fe1e87 (PR merge checkout), with screenshots reviewed at 1440×1000 and 390×844. It verified source/knowledge edits, extrusion/inset controls, undo/redo, numeric transforms, save/reopen, GLB download, connection controls and mobile page overflow, with no recorded page errors. A subsequent Chromium run (44011964811) also passed actual gizmo dragging. Source ZIP file-picker interaction, agent review/apply UI and retained-build preview controls were not covered. Blender validation is a separate independent geometry check.

`npm run test:browser` now contains the real browser acceptance flow: local sign-in → source edit/save → knowledge create/search → editable cube/extrude/inset → undo/redo → transform/save → GLB download → reload/reopen → connection controls → mobile persistence/overflow check. Set `SEBBY_CHROMIUM_BIN` for an installed browser and `SEBBY_QA_DIR` for screenshots/check records outside the source tree. The GitHub workspace workflow runs this on a browser-capable Linux host. Evidence: https://github.com/MadGenius9/Sebby/actions/runs/44011023185 . The first mobile screenshot prompted a further layout fix that collapses project controls after opening a project; the mobile layout increment passed hosted browser acceptance in run 44011609262.

## Runtime checks

Docker is absent in this local container, but the separate hosted isolated-worker job passed in run 44012435801 for commit 07b8e87. It used a real rootless Docker 29 worker with systemd/cgroup v2 and a digest-pinned Node image. `npm run test:docker` verified build/output transfer, syntax success/failure, running-task cancellation, cleanup, UID 65532, no-new-privileges, zero effective capabilities, CPU/memory/PID limits, no extra network interface, blocked root writes and absence of an application environment canary. The live test provisions nothing; CI separately provisions its trusted fixture image. A real run exposed the incorrectly capitalized CPU quota JSON field; code and regression fixture now use Docker’s actual CpuCfsQuota field. This validates the tested base-image workflow, not every hostile workload or dependency image.

## Remaining release gates

Live Google OAuth/Picker consent and a real import/export/revoke; native Windows companion installation, filesystem permissions and reconnect/revoke; a live configured agent editing/testing an imported project; real dependency-image execution; further browser coverage of gizmo dragging, proposals and build previews. Production hosting/authentication, a separate preview origin, backups and data retention also need deployment review.

Current product limits are explicit: 40 virtual text files per project, 1 MB saves, source-only imports, a plain-text editor, limited static previews, one-file companion operations and early polygon tools. Full GitHub cloning/private sync/PR delivery, working branches, broad framework hosting, parallel task orchestration, voice polish, mesh bevel/UV/material workflows and a packaged desktop installer remain roadmap work. This is a larger working foundation, not a finished autonomous coding OS.

## Public GitHub increment

Six tests bring the deterministic workspace suite to 57. The real public-network `npm run test:github` check passed against octocat/Hello-World at commit 7fd1a60b01f91b314f59955a4e4d4e80d8edf11d. GitHub inspection is read-only, retains commit/archive provenance in the reviewed document and creates no project until the separate import step. The browser increment mocks network review only and uses real project creation/edit/save/reopen. See V2-GITHUB-IMPORT.md and the latest CI result.
