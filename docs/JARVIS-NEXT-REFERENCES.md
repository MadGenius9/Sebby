# JARVIS references and bounded capability decisions

Research date: November 12, 2026. This is an evidence map, not a claim that
Sebby already provides everything described by another assistant.

## What was actually reviewed

The public YouTube watch pages' creator descriptions and chapter lists were
retrieved directly from YouTube. The general web reader returned throttled or
minimal pages, so the page's embedded `shortDescription` metadata was inspected
using an ordinary HTTPS request. No video was played in full and no transcript
was obtained. Accordingly, the table records **creator-described demos**;
actual fluency, latency, interruption accuracy, reliability and offline
operation in those recordings were not independently assessed.

| Primary reference | Creator-described demonstrations | What the description does not establish |
|---|---|---|
| [Local JARVIS](https://www.youtube.com/watch?v=BgpRjk4Yoqk) | Ollama model switching, local voice cloning, task examples, a Second Brain, Google Calendar, website analysis, and VoiceStudio setup. Chapters identify voice cloning at 04:35, knowledge at 09:42, calendar at 10:46, and website analysis at 13:19. | The description's local-AI claim does not make Calendar or website access offline; it explicitly acknowledges their need for connectivity. It does not establish Sebby's voice quality, supported voices, permission controls or hardware performance. |
| [Offline JARVIS](https://www.youtube.com/watch?v=OTb1DR47LSo) | A local demo, switching models and voices, tools/Second Brain, hardware/RAM guidance, model installation and voice-cloning setup. | Installed local processing is distinguished from internet-connected tools. Neither end-to-end network-disconnected testing on this PC nor a specific recognition/synthesis engine's latency follows from the description. |
| [REA workflow](https://www.youtube.com/watch?v=84CkBM_jF4g) | An igloo.inc browser investigation and saved teardown, spoken report, Apple Notes inspection on macOS, original notes-app implementation, testing and opening a separate window. | The broad title is not universal target support. The description distinguishes evidence/pseudocode from original source and restricts the workflow to authorized analysis. Its macOS example does not demonstrate a corresponding Windows tool path. |
| [Multilingual JARVIS](https://www.youtube.com/watch?v=acsXZP3SA6w) | English speech input with other reply languages, calendar work in German, screen/page and brochure translation, and Hindi/Arabic examples. It lists sixteen languages and a separate listening language. | A model's ability to write a language does not establish that local ASR or a chosen voice supports it. Calendar/screen translation also requires the relevant integration, permission and evidence. |

No exact voice identity is promised. Naturalness must be compared with actual
audio and the user's preference; unit tests can establish lifecycle behavior,
not how human a voice sounds.

## What REA actually offers

The [official REA repository](https://github.com/morluto/rea) describes an MCP
and CLI inspection toolkit. Its supported targets and dependencies vary:
JavaScript/Electron and .NET have static inspection paths; websites require a
Chrome-family browser; native decompilation depends on an external engine.
Runtime analysis may launch or interact with the target under the user's
permissions. It is not an execution sandbox or a universal source recovery
system. Reports expose evidence and limitations that an agent can use in a
separate implementation process.

The reviewed README requires Node 22.23.4+, 24.22.1+, or 26.12.1+ within its
listed major-version ranges. The PC's previously recorded Node 24.22.0 is
slightly below that requirement. No REA package was installed or executed for
this research, no agent registration was changed, and no native decompiler
was acquired. Features in the repository may also be newer than its released
package; a future integration must pin and verify the actual release.

REA's [license file](https://github.com/morluto/rea/blob/main/LICENSE) is MIT,
copyright 2026 morluto. That permits reuse subject to its notice and license
conditions. It does not grant permission to inspect arbitrary targets or
copy their proprietary code, branding or assets. External engines and target
materials have their own terms.

## Sebby's current boundaries

The existing bounded workspace/file-review tools, per-call native approvals,
task reviews, provider profiles, Ollama adapter and static HTML preview should
remain the foundation. The production isolation runner is deliberately
unavailable; its test-double recipes are not evidence that arbitrary builds
run safely. A Job Object alone is not filesystem/network isolation.

The new Knowledge slice records optional source labels, imported filenames,
saved-note line/revision citations, and bounded cited chat drafts. It keeps
the existing local storage key and legacy notes. Source labels are entered or
imported metadata, not verified web contents. Notes are sent only after an
explicit chat action. Deleting a saved note requires a separate review and
does not erase original files or already-sent chat copies. This remains
keyword retrieval, not semantic search, OCR, an automatic web crawler, or an
integrated app-data backup.

## Implemented static rebuild slice — native integration validation pending

The first target is a user-authorized local single-file HTML document:

1. Select an existing bounded workspace file and confirm that analysis is
   authorized. Record its exact SHA-256 and the requested feature.
2. Parse markup as data without running scripts or fetching URLs. Produce
   structural observations, evidence locations, and explicit unknowns.
3. Review an explained blueprint that distinguishes observations from
   inferences. Exclude copied assets, branding and source implementations.
4. Generate an original, fixed-template static prototype into a newly created
   scratch directory. Never run an imported target's scripts or package files.
5. Check the prototype's fixed structure and prohibited-resource policy, then
   offer a native-approved preview through the existing restricted window.
   Label it a static prototype, with no app-runtime or isolation guarantee.

The implementation uses three main-process operations: prepare evidence,
build the reviewed blueprint, and preview the verified artifact. Proposals
are stored privately in the service and returned as copies; builds recheck
the selected workspace and source digest both before and after native
approval. Preview accepts a registered build ID and rechecks the artifact's
regular-file identity, bounded size and digest. A separate trusted preview
adapter binds the generated directory to the existing restricted preview
window. No renderer-supplied executable, command, network destination or
arbitrary output path is accepted.

The generated directory contains original `index.html` and a local
`evidence.json` report with observed structural facts, source digest,
blueprint, limitations, artifact digest and actual fixed-recipe check results.
The report can be imported into Knowledge explicitly. Builds are bounded to
ten per service session and twenty retained directories; no automatic
deletion occurs. Service identities are session-only, so a saved prototype is
not automatically reopened or replayed after restart.

Eight focused service tests and four interface tests passed in the Windows
development environment. They cover normal generation, source changes,
native denial, unavailable/denied previews, shutdown during consent,
artifact changes/hardlinks, scope checks, and prevention of active resources.
Native window validation is a separate acceptance step and is not implied
by these injected-adapter checks. REA integration can follow after runtime,
release, licensing and provider trust checks. A real arbitrary-app build path
still needs the missing validated isolated runner.
