# Manual static HTML/CSS preview (0.6)

A native-approved single-file **static** preview, not a development server, interactive app runtime, AI tool, or evidence of successful build/test execution. JavaScript is disabled. No project code ran during development tests.

## Lifecycle

`PreviewService({workspace,approve,openWindow,closeWindow,onChange?})` accepts only `{path}` for one relative `.html`/`.htm` file in the selected workspace. Existing bounded UTF-8/path/link restrictions apply. A native confirmation names the folder/path/hash/bytes and static limitations. Root and source hash are reread after consent; stale content never opens. A previous preview remains until replacement is approved and revalidated. Cancel/shutdown dispose late handles; manual closing updates status. No automatic preview or agent permission is granted.

Main exposes only `previewStatus`, `openPreview({path})` and `closePreview`. Safe status contains phase/path/hash/outcome, never the generated document URL. Workspace change closes the old preview. Restore/quit also close it. The privileged React UI never renders project HTML.

## Reduced static subset

parse5 parses with `scriptingEnabled:false`, a 256 KiB source cap, 2,000 markup-delimiter budget and 100-level tree-depth limit. A conservative HTML tag/attribute allowlist removes scripts, resource hints, links/meta/base, templates/noscript, SVG/MathML, embeds, forms and URL/event attributes. Controls are disabled; file inputs become disabled text controls. Basic inline CSS and static layout/text remain. This deliberately changes some documents and is not full browser-fidelity rendering. Sanitization is defense-in-depth, not a replacement for browser policies.

The native adapter serves only the approved bytes through a fresh nonpersistent session's private reserved HTTPS route. Its protocol handler never forwards a request to the network. Response CSP includes `script-src 'none'`, default/connect/frame/worker/object/form/base restrictions, and `sandbox` **without** `allow-scripts`. `X-DNS-Prefetch-Control: off` plus removal of resource hints limits speculative requests. The response policy is independent of the source's meta tags. Sandbox in a meta CSP would be ignored; it is delivered in a response header.

The window has `javascript:false`, Chromium sandbox/context isolation, no Node/preload/webviews/plugins/DevTools, no dialogs or fullscreen, and no shared account session. Permissions/devices/navigation/popups/downloads/external requests are denied. Required native file-chooser interception must succeed before any content loads; failure or debugger detach destroys the preview. Escape, crash/unresponsiveness, abort, startup timeout and manual close destroy it. Timeout spans browser guards and document load; a closed window settles a pending open even if Chromium never resolves its load promise.

## Why interactive scripts remain unavailable

Ordinary CSP/connect-src and webRequest filtering do not by themselves prove WebRTC/STUN isolation. Rather than enable unverified untrusted JavaScript, this checkpoint provides only a static subset. A future interactive runtime needs proven browser/network isolation and native adversarial tests. No constructor monkeypatch is treated as a security boundary.

## Verification limits

Service, sanitizer, adapter and component tests use temporary files, AST parsing and fake Electron objects. They verify policy configuration and lifecycle, not actual Chromium enforcement, OS behavior, pixel fidelity or complete hostile-code isolation. Real Electron/Windows tests must exercise network/file denial, malformed markup, dialogs, chooser/drag-drop behavior, CPU-hang recovery and shutdown. Large CSS/markup can still consume resources. No screenshot or native preview pass is claimed.

Primary references checked during implementation: [Electron WebPreferences](https://www.electronjs.org/docs/latest/api/structures/web-preferences), [Electron webContents](https://www.electronjs.org/docs/latest/api/web-contents), [Chrome file-chooser interception](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-setInterceptFileChooserDialog), and [W3C CSP draft](https://www.w3.org/TR/2026/WD-CSP3-20261027/). Browser support for new CSP directives is not assumed.
