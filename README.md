# Sebby

A separate, local-first Windows desktop work companion. Sebby is the name; Orbit is the chosen ice-blue companion design.

**0.1 foundation — not a working AI coding agent yet.** No model requests, account connections, command execution, or simulated AI responses. The chat surface saves a draft, not a conversation with a model.

## Run locally

Prerequisites: Node.js 24 LTS and npm. On Windows, use PowerShell in this folder:

```powershell
npm ci
npm test
npm start
```

`npm start` typechecks/builds the renderer and starts Electron. `npm run dev` opens a browser-only preview at http://127.0.0.1:5173. That preview persists settings in browser local storage and cannot access workspace folders. Do not confuse browser-preview persistence with desktop persistence.

For renderer hot reload, run `npm run dev` in one terminal and `npx electron . --dev` in another. No secrets are needed. Do not add credentials to source, chat drafts, or memory.

## Implemented

- React/TypeScript desktop UI with the standalone Orbit render, responsive layouts, keyboard focus, and reduced-motion support.
- Persistent editable personal and per-workspace memory; persisted personality preferences.
- Three readable/copyable bundled playbooks: app planning, code review, project brief. Selecting a playbook puts real instructions into the local draft; it does **not** run an agent.
- Explicit native folder selection, bounded allowlisted UTF-8 file browsing, create-only .md/.txt notes with native confirmation. No overwrite/delete/terminal API.
- Honest disconnected AI/external service screens. No credential collection.
- Isolated, sandboxed renderer with a narrow validated IPC bridge; network denied in production.

The folder selection is intentionally not restored on restart. Reselect a folder to restore its memory. Desktop settings live in Electron's userData/Sebby location (`%APPDATA%/Sebby/sebby-state.json` on Windows). Memory is plain text, not a credential vault. The draft is in Electron renderer local storage and currently shared across workspaces. Browser preview has separate local data.

## Windows packaging

```powershell
npm run package:win
```

Electron-builder is configured for an NSIS installer under `release/`. **Windows installer generation, native Windows behavior, signing, SmartScreen reputation, and installation have not been verified in this Linux cloud workspace.** No executable is included in this checkpoint. Do not disable platform protections. Signing and release validation are separate milestones.

## Architecture

- `src/`: code-native React screens and narrowly typed bridge; no Node.js access.
- `electron/main.mjs`: window lifecycle, request policy, trusted-frame IPC, native approval dialogs.
- `electron/preload.cjs`: explicit safe bridge methods only.
- `electron/services.mjs`: settings and bounded workspace services, independently testable.
- `src/skills.ts`: current bundled instruction registry; extensible runtime comes later.
- `public/orbit.png`: selected original Orbit asset, not a screenshot crop.
- `tests/`: Node security/service regression tests.

Electron was selected for Windows support, TypeScript ergonomics, and a browser-quality UI. Its tradeoff is a larger runtime and the need to keep Chromium/Electron patched. This is a foundation, not a hardened execution sandbox. See [security boundaries](electron/SECURITY.md), [roadmap](ROADMAP.md), and [verification](docs/VERIFICATION.md).

## Development boundaries

Treat projects, model output, and connector content as untrusted. Never expose shell execution through renderer IPC. Future commands must use explicit policies, working-directory restrictions, human approvals, bounded output/time, and audit records. Credentials must stay in a validated OS secure store, never renderer state. The roadmap is not authorization to connect accounts, incur charges, deploy, or grant broad filesystem access.
