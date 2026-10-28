# Incremental preview review — 0.6

Source and mocked-adapter review only, 2026-10-28. No actual Electron window, untrusted project JavaScript, browser/network request, or native file chooser was exercised.

## Findings

1. **Interactive preview network boundary:** CSP `connect-src 'none'` and Electron `webRequest` blocking do not establish that WebRTC ICE/STUN/TURN or speculative DNS traffic cannot leave the process. The CSP3 draft specifies a separate `webrtc 'block'` directive; support in this exact Electron runtime is unverified. Freezing JavaScript constructors is defense-in-depth, not a verified browser/network boundary. Resolved for this checkpoint by static-only preview: `javascript:false`, script-src none, response sandbox without allow-scripts, explicit DNS-prefetch suppression, and AST removal of resource hints/URL attributes/active elements. Interactive JavaScript remains unavailable; do not imply it was safely enabled.
2. **Pending open after cancellation/close:** adapter timeout originally began only at loadURL, so stalled CDP guard calls could hang. Closing a stalled load also cleared its timer while leaving loadURL unresolved. Independent `tests/preview-security.test.mjs` reproduces both with mocks. Fixed with an overall setup deadline and a closed-signal promise; both independent mocked regressions now pass.

## Reviewed controls

Manual bounded UTF-8 HTML selection; path/secret-name/symlink restrictions from Workspace; native consent with path/hash/size; second read and hash equality before opening; no automatic watch/server/build. Adapter uses a separate nonpersistent session, local in-memory document response, no Node/preload/webview, default-deny browser/device permissions, denied downloads/popups/navigation, file-chooser interception, and explicit close controls. The static sanitizer parses with scripting disabled, excludes foreign namespaces/noscript/templates, disables form controls, rewrites input types and removes navigable/resource attributes. CSS remains subject to separate CSP and request restrictions; sanitization is not a substitute for those controls. Main preview content does not inherit the companion app's IPC bridge or credentials. Source-preview replacement retains the old window until approval/revalidation, and service handles late closure/returned handles without silently claiming success.

## Unverified gates

Actual Chromium response CSP enforcement, file chooser interception, early drop/paste guards, speculative DNS/WebRTC behavior, permission denial, process lifetime, and UI rendering require native Electron checks. No source-only test proves zero browser egress or containment against browser vulnerabilities. Inline styles/static HTML can still consume renderer resources; close/crash controls are not a resource sandbox.

Primary references: [W3C CSP3 WebRTC directive](https://www.w3.org/TR/2026/WD-CSP3-20261027/), [W3C Resource Hints](https://www.w3.org/TR/2020/WD-resource-hints-20201005/), [Electron session API](https://www.electronjs.org/docs/latest/api/session).

## Evidence

`node --test tests/preview*.test.mjs`: **15/15 PASS**. The two independent tests in `tests/preview-security.test.mjs` initially reproduced hung cancellation/close and now pass after the lifecycle fix. These are mock protocol/window tests, not native Electron proof. Parser resource hardening also landed: at most 2,000 markup delimiters are accepted before AST parsing, then depth and byte bounds are enforced. Main wiring closes preview on workspace changes, renderer loss, restore and quit; restore waits for pending preview operations and enters maintenance first. Entire `npm test` suite at final review: **247/247 PASS**. Actual Electron remains untested; no known blocking source finding remains in this static-only implementation.
