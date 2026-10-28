# Native acceptance matrix — evidence still required

This is an operator checklist, **not a passed test report or authorization to connect accounts**. All rows start **NOT RUN**. Use a disposable Windows account/VM, reviewed source and disposable project files. Record source commit, Windows build, Electron/Node versions, observed outcome and sanitized evidence for each row. Never put keys, source secrets, account identifiers or private conversation text in reports. Stop when OS protection or organizational policy blocks a step; do not bypass it.

## Offline checks (no provider/account required)

| Area | Required observation | Failure means |
|---|---|---|
| First launch | No automatic API, GitHub, microphone or preview activity; disconnected states are truthful | Stop and investigate unexpected access |
| Window/accessibility | Keyboard focus, accessible names, 100/150/200% scaling, minimum size, long paths/diffs and reduced motion usable | UI is not release-ready |
| Appearance | Nine local pals load; body/accent/glow change actual materials; disabled WebGL gives labeled unchanged PNG fallback | Do not claim native 3D support |
| Workspace | Native folder consent, rejected sensitive/link paths, stale edit rejection, exact full-diff review, denied edits unchanged and safe undo | Disable affected mutation feature |
| Stores/backup | Memory/team/tasks persist; restore requires preview and restart; corrupted store preserved; vaults, GitHub authority and publication history excluded | Do not trust backup/recovery |
| Task recovery | Interrupted tasks remain interrupted after restart, never silently execute or publish | Stop release testing |
| Local speech | Explicit click only, device-local English voice or honest unavailable, Stop works, no autoplay | Do not substitute a cloud voice |
| Notifications | Native opt-in per session, silence before consent, no closed-app promise | Keep feature unavailable until fixed |
| Static preview | Own disposable HTML/CSS renders without scripts, event handlers, file chooser, network, navigation, popups or downloads; close/cancel works | Close feature; mocks are not native isolation proof |
| Preview resources | Session does not share privileged cookies/storage; failed required chooser guard prevents window load | Fail closed, never remove guard to pass |
| GitHub default | No automatic reads, writes, token retrieval in renderer, grants or restored write authority | Stop connector testing |
| App lifecycle | Second instance does not compete; quit during pending consent does not persist late grants or dispatch calls | Investigate shutdown race |

Use only harmless owned static-preview fixtures; proving absence of network requires a reviewed test environment with appropriate observation, not just an empty UI. Do not route untrusted browsing through the privileged renderer. Windows npm/build/test execution stays disabled even if the source helper's separate fixture harness passes; integration and application-level review are additional gates.

## Secure storage checks (separate deliberate setup)

First test without a key: unavailable OS encryption must refuse storage, with no plaintext fallback. Test DPAPI save/restart/remove with a clearly synthetic non-secret sentinel through the app first; do not make a connection test with that sentinel. A real existing credential is needed only for separately authorized live authentication, not the storage roundtrip. Do not paste credentials into this report or chat. Verify masked entry clears, no readback exists, restart reports only availability and local removal does not falsely claim server revocation. A synthetic string can establish input/storage behavior but **cannot establish provider authentication**. Do not inspect raw credential values or dump process memory as a routine test.

## Optional live checks — require the operator's account and cost decisions

| Area | Smallest useful authorized test | Evidence / stop condition |
|---|---|---|
| Provider | Explicit provider/model, small output budget, harmless prompt, review native transmission/cost consent | Streaming, cancellation and usage or honest sanitized error; stop on unexpected endpoint/data |
| Specialist | Disposable text file, narrow read/edit scope, small budget, coordinator review then user acceptance | Real evidence, native edit consent, no privileges inherited from a name |
| Voice | Explicit mic permission, short nonsensitive recording, stop, separate model/upload consent | Draft transcription only; never auto-send; cancellation and indicator cleanup |
| GitHub read | Explicit authorized repository and minimal scoped token if needed | Metadata/tree/chosen verified text only; no auto AI context |
| GitHub publish | Operator-owned disposable repository with reviewed workflow/cost policy; exact local grant; one harmless file; new branch | Full diff and destination review; one new branch/commit, existing branch unchanged |
| Draft PR/checks | Separate deliberate PR consent; read recorded-commit checks | Draft only, no merge/rerun; missing permissions remain a truthful error |

For GitHub, **do not perform a test against the Sebby source repository simply because it is configured elsewhere**. Sebby does not inherit ChatGPT's account connection. Select and explicitly authorize the test destination independently. Treat uploaded source as public; the app does not establish visibility. Do not deliberately create uncertain writes against real repositories to test recovery; use injected transports for failure simulation. If a real outcome is uncertain, inspect remotely using an authorized read route and do not auto-retry or delete evidence.

## Release evidence

Archive sanitized results with the exact tested artifact hash. A source test pass, mocked API response, compile success, or unsigned installer is not a signed public release. Actual install/uninstall, ASAR content audit, runtime notices, signing, recovery, privacy/commercial review and release authorization remain required under [distribution readiness](DISTRIBUTION-CHECKLIST.md). No auto-update pipeline or public distribution is authorized by this checklist.

## 0.9 feature-specific checks

- Coordinated plans: one locked workspace/profile, exact step scopes and conservative budget visible; cancelled status/consent cannot start a late provider request. Verify each child's displayed name/job, evidence and independent coordinator critique before acceptance. A separate final provider critique has explicit cost/context consent, then final user acceptance. Restart must interrupt, never replay. Do not assume accepted text proves build/test execution.
- Reviewed MCP: use only an independently authorized endpoint/account and manually provisioned endpoint-specific token. Confirm token replacement invalidates old schemas/grants/proposals; no automatic discovery/call, no OAuth challenge following, no agent tool access. Inspect complete input and effects independently. Do not induce uncertain remote mutations as a native test; injected transports cover failure simulation. Missing/unsupported schemas fail closed. Check outputs remain inert and never auto-enter model context.
- Isolation preparation is offline only: choose disposable package.json/lock/source, review file hashes, verify copies, discard and quit cleanup. No Docker/VM image/engine command should run. An enabled production build button would be a failure at this checkpoint. Staged copies exclude live writable project access but may contain private source; inspect crash remnants manually in the approved test account. Engine daemon trust, immutable image provenance, dependency-specific provisioning and the newer stdin-wrapper delivery contract remain production design/validation gates; no host-permission weakening is allowed.
