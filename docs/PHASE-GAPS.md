# Seven-phase delivery gaps

Updated after the 0.9 private-source checkpoint. **No phase is certified complete on Windows.** Tests establish source behavior under injected boundaries; they do not establish real-provider quality, OS isolation or release readiness.

| Phase | Implemented source | Still requires code/design | Requires environment or separate setup |
|---|---|---|---|
| 1 Foundation | Desktop shell, persistent memory/personality, scoped workspace, honest state | Native usability fixes if discovered | Windows launch, assets, accessibility, DPI and dialogs |
| 2 AI | OpenAI/Anthropic/xAI streaming chat, profiles, usage, explicit context, secure-vault interface, cancellation | Broader model compatibility as provider capabilities evolve; richer context controls and budgeting are improvements, not claims of existing support | Own provider credential/model entitlement, explicit paid test consent, OS vault verification |
| 3 Developer | Bounded read/edit tools, complete diff consent, hash checks, backups/undo, fixed trusted Git status, static HTML/CSS preview, bounded local isolation snapshots plus source/mock-only engine policy | Integrate and review validated process containment before enabling build/test; constrained executable/toolchain policy; interactive preview isolation and recovery | Windows helper compilation/containment tests first, then Electron integration tests; installed authorized SDKs for Unity/iOS/etc. iOS native builds need Apple tooling |
| 4 Skills/connectors | Instruction registry, read-only MCP metadata, GitHub reads, exact-repo approved new-branch publication/draft PR/checks; manual authenticated MCP invocation with exact schema grants and full-input/native approval | Full MCP OAuth and broader interoperability, additional connector adapters; imported instructions are not executable plugins | Explicit own accounts/scopes, authorized test repository and endpoint; no inherited ChatGPT connections |
| 5 Specialists | Persistent assigned names/jobs, bounded sequential provider execution, tool scopes, separate coordinator critique and user acceptance, interrupted recovery; max-four sequential plans with locked budgets/scopes, accepted evidence handoffs and explicit final critique/acceptance | Parallel/dependency scheduling, richer orchestration and recovery workflows | Live model quality/cost/cancellation tests; no extra authority from delegation |
| 6 Companion | Nine original pals/palettes, personality, reminders, opt-in notifications, local response reading, microphone-to-draft source path | Realtime conversational voice, expressions synchronized to actual state, browser/desktop automation with exact per-action consent, optional cloud continuation | Mic/OS voices/notification/GLB native tests; optional services/accounts/cost decisions. No always-on recording or remote-control grant inferred |
| 7 Release | NSIS config, source inventory/notices, backup/recovery, security/unit/DOM tests, manual validation instructions | Trusted update design/implementation, crash/power-loss resilience work and fixes discovered by native testing, accessibility remediation, final support/retention policy | Windows runtime/toolchain, native E2E and actual installer audit; signing identity and secure release process, privacy/license/commercial review, explicit distribution authority |

## What can proceed without credentials

- Strengthen deterministic tests, source reviews and controlled local workflows.
- Prepare the explicit offline Windows containment fixture harness and evidence format; it cannot validate itself without Windows/.NET.
- Exercise full UI-to-service flows through real local stores plus injected transport, preserving truthful mock labels.
- Specify future tool/automation permissions narrowly. New privacy-sensitive access, persistent service grants, actual devices, accounts, cloud costs and public releases require their own decisions.

## First useful developer milestone

The end of phase 3 is **not yet reached**: Sebby cannot currently run arbitrary app builds/tests or promise any requested app/mod/Unity/iOS output. Native containment must be demonstrated, then integrated with reviewed command policy and failure recovery; actual provider execution must be validated. Passing helper fixtures alone must not flip a feature flag. The current helper rejects shell/node/npm hosts; initial integration should cover only fixed Git status with pinned helper/tool hashes, bounded protocol/watchdog handling and preserved no-prompt/config controls. General build execution requires a separate reviewed isolation and executable policy; Job Objects contain process lifetime, not filesystem/network authority. Static preview is not an interactive web-app server.

## Smallest next environment step

Identify an approved disposable Windows test machine/account and confirm whether Node 24 and, for separate helper fixtures, PowerShell 7 plus the .NET 10 SDK are already available. This is an environment question, **not permission to install software, connect a desktop, acquire tokens or run commands automatically**. If available, choose the exact reviewed source commit and begin offline source checks under [RELEASE.md](RELEASE.md), recording every skip. Native fixture execution is an additional explicit opt-in. Account/live tests come later under [NATIVE-ACCEPTANCE.md](NATIVE-ACCEPTANCE.md).
