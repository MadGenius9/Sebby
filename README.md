# Sebby

Your local-first Windows work companion, with an ice-blue Orbit character and a named specialist team.

**Version 0.4: a local workbench with optional, approval-gated AI.** OpenAI, Anthropic and xAI adapters support streaming chat and bounded specialist/coordinator work. Live provider access and native Windows behavior have not been verified. Optional MCP metadata discovery is read-only and separately consented. Sebby never fabricates replies or claims unfinished tasks ran.

## Start

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
| Tasks | Durable queue/logs plus real deterministic inventory/brief utilities, cancellation, separate result review | AI goals require provider setup and native approval; bounded tools and separate coordinator review, then user acceptance |
| Connections | GitHub/MCP bookmarks; explicit read-only MCP tool-name discovery with DNS/TLS/size/time safeguards | No authentication or tool execution; JSON-only 2026-07-28 subset, no real endpoint tested |
| Companion | Persisted personality, Nine original 3D pals, material palettes, optional local voice preview | Authored preview, not model behavior; device-local English voice required; no microphone |
| Reminders | Durable dates, due state, snooze/dismiss; opt-in silent desktop notifications until quit | Native display unverified; no notifications before consent and nothing runs when closed |
| Backup | Plaintext export, validated preview, native-approved restore, rollback/recovery journal | Excludes project files, edit originals, credentials; not a power-loss atomicity guarantee |

These paths have service/component test coverage, not Windows-native release certification. Read [verification](docs/VERIFICATION.md) before treating this as a finished product.

## Bring your own API account

In **Settings**, select OpenAI GPT, Anthropic Claude, or xAI Grok; enter an explicit model ID and output budget. Use an enabled provider-specific environment key or store a key through the masked field and native confirmation. Never paste keys in chat, project memory, source, or GitHub. The password field is transient renderer memory, not React state or local storage. Secure storage is not available in browser preview. Key availability does not prove account/model access. An optional native-approved connection test may incur API charges. Consumer chat subscriptions do not include API billing. See [existing-key setup](docs/EXISTING-KEY.md), [providers](docs/PROVIDERS.md), and [privacy](docs/PRIVACY.md).

In **Settings → Appearance**, select Orbit, Scout, Wisp, Luma, Nook, Finch, Tidal, Moss or Piper and change body/accent/glow colors. Actual GLB material rendering requires WebGL; otherwise an explicitly unchanged original PNG is shown. Orbit remains the default; changing the pal does not change Sebby’s identity or permissions.

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
