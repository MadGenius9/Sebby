# Foundation verification

## Passed in this workspace

- `npm ci` installed the locked dependency tree before adding Three.js and its types.
- `npm run typecheck`: server and web TypeScript checks passed.
- `npm run test:workspace`: 29 tests passed, covering real SQLite CRUD, cross-user isolation, stale revision rejection, cross-origin writes, invalid paths, duplicate files, invalid primitive kinds/scales, malformed JSON, payload size limits, and a separate-process read of saved scene data.
- `npm run build`: Vite production bundle and server TypeScript build passed.
- Local workspace process reached startup and reported the loopback URL without external service credentials.

## Browser acceptance remains blocked

Browser plugin was not available. Regular Playwright attempted a Chromium launch; it failed before navigation with `socket() failed: Operation not permitted` in Chromium's process singleton startup. The separate CUA cloud browser could not reach the loopback preview (`ERR_CONNECTION_REFUSED`). No visual, responsive, interaction, console-health or GLB download pass is claimed.

The intended browser acceptance flow is: local sign-in → create project → add/edit source → save → add primitive → edit transforms → duplicate → undo/redo → save → export GLB → reload/reopen → confirm code and transforms → inspect Connections → verify desktop and phone layouts.

Before release, run this flow in a supported browser, inspect screenshots, confirm no console errors, and parse the exported GLB or import it into an independent viewer. Test Windows separately for the local companion when implemented. No live model, OAuth, Google Drive, Orgo or desktop calls have been performed.

## Known scope limits

The current coding editor is plain text. There is no interactive terminal, package installation, repository import, general framework preview hosting, cloud deployment. A configured Docker adapter implements build/test dispatch; its live container behavior remains unverified. Saved HTML/CSS/classic JavaScript preview and Git revision diffs are implemented. The 3D Studio is primitive scene composition, not Blender-equivalent mesh modeling. Project JSON export/import round trips create separate projects. Undo/redo is session-local. Data lives in the configured server SQLite database; this branch does not implement backup automation.

## Runtime increment checks

`npm run test:workspace` now runs 29 passing tests, including real Git snapshot commits/diffs, saved revision transactions, JSON import, reserved/case/prefix collision rejection, preview compilation/CSP placement, and the authored Web starter's syntax/build commands in a trusted test fixture. Runner lifecycle coverage uses an explicit test double (success/nonzero exit, owner checks, revision conflicts, SSE output, cancellation, timeout, output limits, cleanup failure and restart recovery). These are not real container tests.

Docker is absent. A bwrap isolation probe failed with `NETLINK_ROUTE socket: Operation not permitted`. The adapter refuses to run code directly on the application host. Visible Preview/Runs/Changes interactions, GLB export and mobile layout remain unverified until browser access is available.

A real HTTP smoke test of the built local server also passed: `/workspace` and its JavaScript bundle, local session creation, Web starter project creation, preview compilation, revision history, unavailable-worker refusal (503), and unauthenticated access rejection (401). Run `npm run test:http` to rebuild and repeat with disposable data. This checks server assembly and routing, not browser rendering.

## Agent/dependency increment checks

Twenty-nine tests now pass. New tests use the actual MCP handler and a scripted localhost Hermes-compatible gateway to exercise the real turn queue, scope instructions, SSE tool row updates and project tool dispatch. No live model/provider calls or paid services are used. The headless fixture creates no desktop lease. Tests verify file/scene proposal review/apply, owner isolation, stale/no-op/revoked rejection, mid-preparation authorization revocation, exact lockfile/image catalog matching and minimal dependency-context preparation. Dependency catalog fixtures test the contract, not real npm resolution or a real React build.

The real HTTP smoke includes agent/proposal routes and project-specific runtime readiness. Browser review interactions, live Hermes behavior and actual dependency container builds remain unverified.

## Build output increment checks

Twenty-nine tests pass. Real filesystem collector fixtures cover regular files, links, hardlinks, traversal and size limits. Runner fixtures exercise retained provenance, owner-only ZIP/file access, hash checks and suppression after failure/cancellation/invalid output/unverified cleanup. A Docker CLI fixture checks stream separation; it does not run containers. A trusted authored React/Vite fixture builds and is prepared for sandbox preview; a minimal trusted DOM fixture executes a rebundled module. None of these claims visual UI correctness or real Docker execution. The real HTTP smoke now checks disposable seeded build manifest/download/preview routes. See V2-BUILD-OUTPUTS.md.
