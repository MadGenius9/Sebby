# Foundation verification

## Passed in this workspace

- `npm ci` installed the locked dependency tree before adding Three.js and its types.
- `npm run typecheck`: server and web TypeScript checks passed.
- `npm run test:workspace`: two integration tests passed, covering real SQLite CRUD, cross-user isolation, stale revision rejection, cross-origin writes, invalid paths, duplicate files, invalid primitive kinds/scales, malformed JSON, payload size limits, and a separate-process read of saved scene data.
- `npm run build`: Vite production bundle and server TypeScript build passed.
- Local workspace process reached startup and reported the loopback URL without external service credentials.

## Browser acceptance remains blocked

Browser plugin was not available. Regular Playwright attempted a Chromium launch; it failed before navigation with `socket() failed: Operation not permitted` in Chromium's process singleton startup. The separate CUA cloud browser could not reach the loopback preview (`ERR_CONNECTION_REFUSED`). No visual, responsive, interaction, console-health or GLB download pass is claimed.

The intended browser acceptance flow is: local sign-in → create project → add/edit source → save → add primitive → edit transforms → duplicate → undo/redo → save → export GLB → reload/reopen → confirm code and transforms → inspect Connections → verify desktop and phone layouts.

Before release, run this flow in a supported browser, inspect screenshots, confirm no console errors, and parse the exported GLB or import it into an independent viewer. Test Windows separately for the local companion when implemented. No live model, OAuth, Google Drive, Orgo or desktop calls have been performed.

## Known scope limits

The current coding editor is plain text. No terminal, package installation, source execution, checkout import, source diff, preview runtime, cloud deployment or agent project tools exist yet. The 3D Studio is primitive scene composition, not Blender-equivalent mesh modeling. Project JSON export is one-way until an import workflow is added. Undo/redo is session-local. Data lives in the configured server SQLite database; this branch does not implement backup automation.
