# Sebby

Your local-first Windows work companion, with an ice-blue Orbit character and a named specialist team.

**Version 0.11: hybrid AI, editable 3D Studio, and a searchable knowledge bank.**

New: Ollama local profiles alongside existing cloud profiles; Studio with editable geometry, AI scene proposals, floor-plan tracing, undo/redo, JSON/GLB/PNG export; 16 reply-language choices and language-matched local voices; searchable notes/report imports. Run `npm run gauntlet` for source checks. See [the video-to-Sebby delivery map](docs/JARVIS-UPGRADE.md) for setup, evidence and remaining work. This is a source upgrade, not a Windows-tested installer or complete parity with the video demonstrations.

**Existing provider/workbench foundation:** OpenAI, Anthropic and xAI adapters support streaming chat and bounded specialist/coordinator work. Live provider access and native Windows behavior have not been verified. MCP metadata discovery is read-only; a separate authenticated manual-tool subset requires endpoint-bound credentials, an exact session grant and full-input/native confirmation. No agent automatically calls remote tools. Sebby never fabricates replies or claims unfinished tasks ran.

## Start

First Windows launch? Use the [short first-run guide](docs/WINDOWS-FIRST-RUN.md): check existing prerequisites, explicitly choose dependency installation, then test local features without any API key.

Prerequisites: Node.js 24 LTS and npm. In PowerShell, from this project:

```powershell
npm ci
npm test
npm run test:components
npm start
```

`npm start` typechecks/builds the renderer and launches Electron. No credentials are required for local features. `npm run dev` is a **browser preview**, not desktop access; memory/personality/draft use separate browser local storage and desktop-only features disclose that limitation. For desktop hot reload, run `npm run dev` and then `npx electron . --dev` in another terminal.

## What works in source

| Area | Implemented | Honest boundary |
|---|---|---|
| Chat | Persistent conversations, streaming/cancel, explicit memory/skills/files context, reported token usage | Requires own API key and explicit model; native approval before dispatch; no live calls tested |
| Memory | Personal and folder-scoped editable memory | Plaintext; never store keys/passwords |
| Workspace | Native folder selection; bounded text browsing; confirmed note creation | No unrestricted filesystem access |
| File changes | Hash-checked whole-file previews, native approval, original backups, session undo | Not an adversarial filesystem sandbox; ACL/xattr preservation and Windows behavior unverified |
| Commands | Fixed Git status after native trusted-executable selection and per-run approval | No shell; no arbitrary commands; npm execution unavailable in UI and disabled on Windows pending process-tree containment |
| Skills | Three real bundled playbooks; persistent imported instruction skills | Imports are untrusted text, not executable plugins or tool permissions |
| Team | Sebby-assigned names, specialty/job, rename/retire, matching-role task assignment | Names come from an authored pool; provider reasoning requires approved runs |
| Tasks | Durable queue/logs plus real deterministic inventory/brief utilities, cancellation, separate result review | AI goals require provider setup and native approval; bounded tools and separate coordinator review, then user acceptance; up to four sequential specialists plus one explicit final critique |
| Connections | GitHub metadata/tree/verified text-blob reads, encrypted token setup; MCP metadata discovery | Explicit consent per read; separately approved new-branch commits and draft PRs, no force/merge/clone; separately reviewed authenticated MCP calls; live authentication untested |
| Companion | Persisted personality, nine original 3D pals, material palettes, explicit local response reading and optional voice-to-draft transcription | Local speech needs a device-local English voice; microphone/audio API use requires separate consents and remains native/live untested |
| Reminders | Durable dates, due state, snooze/dismiss; opt-in silent desktop notifications until quit | Native display unverified; no notifications before consent and nothing runs when closed |
| Backup | Plaintext export, validated preview, native-approved restore, rollback/recovery journal | Excludes project files, edit originals, credentials; not a power-loss atomicity guarantee |

These paths have service/component test coverage, not Windows-native release certification. Read [verification](docs/VERIFICATION.md) before treating this as a finished product.

## Bring your own API account

In **Settings**, select OpenAI GPT, Anthropic Claude, or xAI Grok; enter an explicit model ID and output budget. Use an enabled provider-specific environment key or store a key through the masked field and native confirmation. Never paste keys in chat, project memory, source, or GitHub. The password field is transient renderer memory, not React state or local storage. Secure storage is not available in browser preview. Key availability does not prove account/model access. An optional native-approved connection test may incur API charges. Consumer chat subscriptions do not include API billing. See [existing-key setup](docs/EXISTING-KEY.md), [providers](docs/PROVIDERS.md), and [privacy](docs/PRIVACY.md).

In **Settings → Appearance**, select Orbit, Scout, Wisp, Luma, Nook, Finch, Tidal, Moss or Piper and change body/accent/glow colors. Actual GLB material rendering requires WebGL; otherwise an explicitly unchanged original PNG is shown. Orbit remains the default; changing the pal does not change Sebby’s identity or permissions.

## GitHub and voice drafts

**Connections** can read one explicitly configured GitHub repository: metadata, a bounded tree, and selected text blobs verified against their Git object hash. Public reads need no token; private access uses a locally encrypted, user-provided scoped token. Every read needs native consent. The separate publication panel can prepare full diffs for up to ten selected local text files, then create a new `sebby/*` branch and commit after an exact-repository grant and native confirmation. Draft PRs require another review; commit check runs are read-only. No existing branch update, force push, merge or deletion. Uploads may expose source and trigger repository CI costs. Partial failures are recorded as uncertain and never automatically retried. See [GitHub](docs/GITHUB.md) and [publication boundaries](docs/GITHUB-PUBLISH.md).

Chat includes optional **voice drafts**: choose an OpenAI transcription model, approve local microphone use, record/stop, then separately approve paid upload. Review the transcript before sending. Audio stays in memory; no always-listening mode. Actual assistant responses can also be read aloud using an available device-local English voice, with an explicit button. See [voice boundaries](docs/VOICE.md).

## Meet Sebby’s team

In **Team**, choose a specialty and describe the job. Sebby assigns a distinct name—Mira for a planner, Finn for a coder, Sage for a reviewer, Nova for a researcher, with more names available. You can rename or retire them. Create a matching-role task under **Tasks**, then assign it. The UI shows real queue state. With a configured provider, start an AI goal explicitly in Tasks; Sebby assigns a specialist, runs bounded approved work, obtains a separate coordinator review, and waits for your acceptance. You can run an explicitly labeled deterministic inventory or project-brief-template utility, optionally attach a matching unassigned specialist name, read its observed report, then separately approve that utility as complete. This does not complete an arbitrary AI/app-building goal.

Specialists inherit permission limits. Sebby reviews their evidence before user acceptance; a role or name never grants access.

## Local data and control

Desktop data lives in Electron's `userData` location, normally `%APPDATA%/Sebby/` on Windows. Versioned JSON files hold settings, conversations, skills, tasks, team, reminders, and connector bookmarks. Draft text also uses renderer local storage. Memory, logs, edit backups and exports are **not encrypted**. API keys are separately OS-encrypted and excluded from backups. Storage fails closed if secure OS encryption is unavailable; see [BYOK](docs/BYOK.md).

Folder selection is not restored automatically. Reselect the same folder to restore its memory. Named drafts, task records and team are app-wide; task workspace references are metadata, not access grants. The composer draft is also app-wide. Existing file edits require a preview and native confirmation. Undo is session-only; original content persists under `edit-backups` for manual recovery. Restoring app data restarts Sebby and does not undo project-file edits.

The app takes a single-instance lock. A restore stops new IPC work; incomplete restores roll back before stores load. Exports are plaintext and should be kept private. Export uses create-only writing: choose a new filename rather than replacing an existing backup.

## Verify and package on Windows

```powershell
.\scripts\verify-windows.ps1
# Or skip dependency install / installer packaging:
.\scripts\verify-windows.ps1 -SkipInstall -SkipPackage
```

The script runs install, Node tests, DOM component tests, build, and optional unsigned NSIS packaging with publishing disabled. It does not launch, sign, upload, install the generated app, bypass security, or connect accounts. See [release checklist](docs/RELEASE.md).

`npm run package:win` writes to `release/`. **No Windows installer or native test result is supplied.** Windows packaging/install, PowerShell execution, native dialogs, signing, update trust, and OS accessibility remain unverified in this Linux cloud workspace. Do not bypass SmartScreen or other protections.

Additional tests: `npm run test:ui` uses Playwright and requires a locally available supported Chromium browser (`npx playwright install chromium` is an optional explicit browser download). Browser E2E tests have not run successfully in this environment. `npm run format:check` checks formatting.

## Architecture

- `src/`: React/TypeScript UI; no Node.js privileges. Explicit feature bridges and honest browser fallbacks.
- `electron/main.mjs`, `preload.cjs`: sandboxed/context-isolated window, trusted-frame checks, narrow IPC, native dialogs, no production renderer network.
- `electron/services.mjs`: bounded workspace and memory services.
- `electron/development*.mjs`: reviewed file operations and fixed command runner/IPC.
- `electron/{tasks,team,skills,conversations,reminders,connectors}.mjs`: separately testable local stores.
- `electron/{local-executor,mcp-discovery,notifications}*.mjs`: approved local utility execution, read-only network discovery, and session-only notification control.
- `electron/backup*.mjs`: schema-validated backup/recovery and native path selection.
- `skills/*.md`: authoritative desktop bundled instruction documents; `src/skills.ts` is the offline preview/suggestion mirror.
- `public/orbit.png`, `build/icon.ico`: original chosen Orbit render and deterministic icon-format conversion.
- `tests/`, `component-tests/`, `e2e/`: services, DOM with real local handlers, and pending browser E2E.

Electron provides a practical Windows-capable shell and TypeScript ecosystem at the cost of a larger runtime and ongoing Chromium/Electron updates. This is a maintainable local foundation—not a sandbox for hostile code. See [security](electron/SECURITY.md), [development limits](docs/DEVELOPMENT.md), [roadmap](ROADMAP.md), and [current delivery status](docs/STATUS.md).

## Windows execution remains gated

`native/windows-job-runner/` contains an auditable .NET 10 Windows Job Object supervisor with explicit executable/hash/argument contract, process-lifetime containment, cancellation and output bounds. It is **not compiled, Windows-tested, integrated or enabled** in Sebby. It is not a security sandbox, and does not enable npm or shell commands. See [containment validation](docs/WINDOWS-CONTAINMENT.md).

## Static preview and source release checks

Workspace can open a native-approved static HTML/CSS subset in an isolated window. Scripts, external assets, network access and active controls are unavailable; this is not an interactive app runtime or proof of a successful build. [Preview policy](docs/PREVIEW.md) documents sanitization and native validation gaps.

`npm run release:readiness` inventories source/lock/dependency licenses and packaging policy. It intentionally exits nonzero while native/runtime/signing/release gates remain unresolved. Settings can show the explicitly bundled dependency notices; those notices are not commercial clearance. See [onboarding](docs/ONBOARDING.md) and [distribution checklist](docs/DISTRIBUTION-CHECKLIST.md).

## Coordinated plans, remote tools and build preparation

Tasks can coordinate up to four sequential named specialists under one locked workspace/profile, with explicit scope ceilings and reserved budgets. Each child is reviewed before handing accepted evidence to the next; a separately consented final model critique and user acceptance finish the plan. No automatic retries or restart replay. See [orchestration](docs/ORCHESTRATION.md).

The separate **Reviewed MCP tools** panel supports manually provisioned bearer tokens, not full OAuth. Review the exact endpoint, tool schema and complete JSON input. Server claims of safety/read-only behavior are untrusted; remote effects can be irreversible or charged. Post-dispatch failures are uncertain, not rolled back. Outputs are inert text, not model instructions. See [MCP boundaries](docs/MCP-REVIEWED.md).

**Isolated build preparation** copies and verifies selected bounded local source files after native consent. Engine configuration, fixed command policy and artifact quarantine have source/mock coverage only. Production execution remains unavailable: no Docker/VM process, image pull, npm install or build is launched. Native engine trust, audited dependency-specific images and mount/permission validation remain required. See [execution path](docs/ISOLATED-EXECUTION.md) and [phase gaps](docs/PHASE-GAPS.md).

Voice now has explicit **turn-based session controls** showing observed microphone, transcription, chat and local-reading state. “Stop voice activity” does not cancel unrelated work; the separate “Stop voice and current chat” also cancels the owned chat request. Nothing records, uploads, sends or reads automatically. This is not realtime voice conversation.

A reviewed **image-wrapper source contract** now transfers bounded snapshot content through stdin rather than mounting private host files. It validates the exact dependency-lock identity before a fixed web build/test recipe, with preprovisioned dependencies only. No image has been built, pulled or run; production execution remains disabled and container/daemon trust still needs native validation. The wrapper is not a sandbox or proof against hostile project code.

