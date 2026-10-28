# Verification — 0.3 local workbench

Checked 2026-10-28 in a Linux cloud execution workspace. No user Windows desktop attached.

## Passed

- `npm run format:check`: all source/config/test files conform to Prettier.
- `npm run build`: TypeScript plus Vite production bundle; 1,576 modules, renderer JS ~271 kB / ~83 kB gzip.
- `npm test`: **93/93 Node tests pass** (service, security, IPC-intent and static release-script policy tests).
- `npm run test:components`: **10/10 DOM component tests pass**, including five desktop-component flows through real local IPC handlers/stores rather than a canned UI simulator.
- `npm audit --json`: **zero reported vulnerabilities** across production and development dependencies at check time. This is not a complete supply-chain assessment.
- Main/preload syntax checks: pass. Every Electron service is parsed/exercised through tests or syntax checks.
- Original selected Orbit PNG and deterministic ICO conversion exist; no concept-board crop is used as the character.

## Test coverage highlights

Traversal/absolute/drive/UNC/hidden/sensitive path rejection; symlink and bounded directory scans; create-only notes; per-project memory; concurrent store saves; corrupt-store preservation; restricted renderer asset URLs; hash-checked edit previews; native denial; no overwrite on stale state; backup/undo; truncated review rejection; fixed command plans and script-digest recheck; bounded output, timeout, cancellation using temporary Node fixture programs only; no renderer approval/completion/assistant/executable spoofing; imported instruction trust; tasks/restart recovery; named team persistence/retirement; reminders; connector strict schemas; backup validation/rollback/startup recovery; Windows verification-script static policy; controlled utility task types, observed inventory and separate result review; MCP native consent, public-IP DNS pinning, TLS, no redirects, limits, cancellation, remote text sanitization; session-only notification consent, actual-show confirmation, abort, limits and backoff through fake native objects.

DOM tests verify honest disconnected state, selected asset, skill-to-draft, memory reload, personality persistence, browser-only restrictions, and desktop team/task/skill/reminder interactions against real stores, plus a real fixture inventory displayed and separately reviewed in the UI. They do not run Electron, inspect native dialogs, measure layout or test real AI.

## Blocked / not run

- Built-in cloud browser: loopback server returned `ERR_CONNECTION_REFUSED`. It cannot reach this execution workspace's server.
- Local Chromium/Playwright: sandbox forbids required socket operations. A requested escalation failed before launch with `bwrap: Can't create file at /home/agent/.codex/sessions: Read-only file system`. No denied path was read; no bypass attempted.
- Cloud browser direct file navigation: rejected by URL policy; only HTTP/HTTPS permitted.
- Therefore actual browser screenshots, responsive pixel/layout checks, visual-fidelity signoff, and Playwright E2E remain **unverified**. DOM tests are not substitutes for those checks.
- Electron GUI/native approval dialogs: not run; Electron binary absent because dependencies were installed with lifecycle scripts disabled in this cloud workspace.
- Windows PowerShell script execution, packaging, installation, ACL/reparse behavior, signing, update trust, accessibility and actual local speech output: not run.
- Real provider calls, streaming, authenticated connectors, autonomous AI specialists, paid services, user-project npm scripts: not run and not claimed implemented. MCP transports used fake DNS/HTTPS only; notifications used fake native events only.

## Visual reference and deviations

`docs/ui-concept.png` is an image-generated design reference, **not a working-app screenshot**. It was inspected using `view_image`. The actual chosen asset is the original user-selected Orbit PNG, intentionally different from the concept's generic orb.

Reference-guided implementation points: navy three-column shell; ice-blue text/icon accents; selected navigation treatment; primary heading/suggestion row; bottom composer; at-a-glance inspector; Segoe UI/system typography. Added Team/Tasks/Reminders navigation, browser-preview disclosure, saved drafts and later functional panels are intentional scope expansions. Responsive inspector collapse is code-defined but not visually verified. No 10/10 or agency-signoff fidelity claim is made without a rendered browser screenshot.
