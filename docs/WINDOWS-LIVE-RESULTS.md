# Windows setup and live validation — November 12, 2026

Repository: `MadGenius9/Sebby`, branch `sebby/jarvis-hybrid-studio-0-11`.
Starting commit: `7558ac0a6baf31ff5a8a4e7c7bc306c7b5685f71`.
The destination folder was empty; no existing files or uncommitted work were
replaced. These follow-up fixes and results are recorded on the upgrade branch
for draft PR #1. The PR remains unmerged.

## Launch next time

Double-click `Launch-Sebby.cmd` in this repository, or run:

```powershell
cd "C:\Users\User\OneDrive\Documents\Sebby"
npm run launch:local
```

The launcher checks `127.0.0.1:11434`, starts the installed Ollama server if
needed, runs the production build, and opens Electron. It does not install
dependencies, pull models, change AI profiles, or send any AI requests.
The selected profile is **Local RTX 3080**, provider **Local / Ollama**, model
**qwen3:8b**, maximum output **4096 tokens**. Cloud profiles remain available
only through explicit selection; no cloud requests or API keys were used.
Local requests still show Sebby's native confirmation.

For a fresh dependency installation, run `npm ci` first. The project now invokes
Electron's official runtime installer in `postinstall`: the installed Electron
45 package did not download its binary during the initial `npm ci` alone.
Node 24 and npm must be available in the launching terminal's PATH.

## Environment and official installations

- Windows 11 Home x64, OS version 10.0.26300.
- Intel i7-12700F; 32 GB RAM (31.8 GiB reported).
- NVIDIA RTX 3080, 10 GB VRAM; installed driver 617.42.
- Existing Git 2.56.0.windows.2, Node 24.22.0 and npm 11.19.1 were retained.
- Ollama 0.40.16 installed per-user using the
  [official Windows download](https://ollama.com/download/windows).
  The downloaded installer had a valid Authenticode signature for Ollama Inc.
- `qwen3:8b` downloaded successfully; model ID `500a1f067a9f`.
- No administrator elevation, Developer Mode, execution-policy change or
  Windows protection bypass was used. Winget was absent and not needed.

The initial Ollama server started before installation had finished extracting
the GPU libraries and used CPU. Restarting the server after installation
detected the RTX 3080 with CUDA. See Ollama's
[Windows documentation](https://docs.ollama.com/windows) and
[supported hardware](https://docs.ollama.com/gpu).

## Actual Windows and model results

These checks used the real Electron app and installed local model, not mocked
provider replies. Playwright's Electron driver controlled the renderer; the
Windows computer-use API exercised native confirmation and save dialogs.

| Check | Observed result |
|---|---|
| Direct inference | Actual response `SEBBY_LOCAL_OK` |
| GPU | `ollama ps`: `qwen3:8b`, 5.6 GB, **100% GPU**, context 4096; NVIDIA memory about 7.2 GB including desktop usage |
| Sebby model test | Native-approved test returned `OK.`, completed, 20 input + 3 output tokens |
| Chat | `17 plus 25` returned `42`, saved response, 175 input + 3 output tokens |
| Cancellation | Observed streamed integers 1–4; Cancel response produced `Chat: cancelled` |
| AI Studio | Model proposed a valid three-part copper robot; full JSON reviewed and applied explicitly |
| Rendering | WebGL robot, grid, lighting and materials visibly rendered; scene framing exercised |
| Undo/redo | Delete changed 12 to 11 objects; Undo restored 12; Redo restored 11; Undo restored 12 |
| JSON | Native export, then empty scene and import; all persisted scene fields matched exported JSON exactly |
| Restart persistence | Full Electron close/reopen restored Small copper robot, all three parts and exact JSON; qwen3:8b remained selected |
| Launcher | Stopped the setup-owned Ollama server, then executed Launch-Sebby.cmd; it restarted Ollama and opened the normal Electron app successfully |
| GLB | Native export; GLB 2 header/length validated; loaded with GLTFLoader into three actual meshes, correct positions and copper/blue colors |
| PNG | Native export; exported image opened and visually inspected |

Model competence is not guaranteed by these checks. For example, the local
model declined one long-story test; a counting request was used to establish
a sustained stream for cancellation. Studio is editable primitive geometry,
not arbitrary high-detail mesh generation or photorealistic rendering.

Exports are outside the repository in
`C:\Users\User\OneDrive\Documents\Sebby-Exports\`:

- `copper-robot.json`: 1,084 bytes.
- `copper-robot.glb`: 27,516 bytes; meshes Body, Head, Base.
- `copper-robot.png`: 162,193 bytes.

Studio data uses Electron local storage (`sebby.studio.v1:personal` without a
selected workspace). Portable JSON is the scene backup; the app-data backup
still excludes Studio/Knowledge storage.

## Fixes and automated coverage

The gauntlet loop exposed and fixed:

1. Blank Electron renderer: a Proxy wrapped non-configurable methods from the
   frozen contextBridge API. A mutable shallow target copy preserves the
   busy-operation wrapper. A regression test covers frozen API invocation and
   busy-state cleanup on rejection.
2. Qwen3's hidden thinking exhausted the 16-token connection-test budget.
   The local adapter now explicitly requests `think: false`, consistent with
   its final-text interface and lack of reasoning replay support. Real model
   test, chat, streaming cancellation and Studio generation then succeeded.
3. Windows isolation fixture used `docker` rather than a Windows `.exe` path.
   The test fixture now chooses a platform-appropriate path. Production build
   isolation remains disabled and no Docker execution was enabled.
4. Windows symlink fixture privilege failures now appear as explicit skips
   instead of test failures. Only Windows `EPERM` from the `symlink` syscall is
   handled this way; other exceptions remain failures. Three POSIX image-recipe
   tests are explicitly Linux-only. Remaining assertions in a skipped mixed
   test are unverified; these are not reported as passing coverage.
5. Formatting checks accept native checkout line endings. Settings' provider
   fieldset now stacks vertically instead of inheriting the radio-group flex
   layout. Hidden file inputs retain their hidden display state.

`npm run gauntlet` passes all four stages on Windows: 353 service tests pass,
22 service tests are explicitly skipped, 100 interface tests pass, TypeScript
and production build pass, formatting passes. `.gauntlet/latest.json` records
the latest automated run; it intentionally does not certify live checks.
The Three.js chunk-size warning is nonfatal.

`npm audit` reports six moderate findings in development/packaging tooling's
dependency chain. `npm audit --omit=dev` reports zero vulnerabilities. No
forced major-version dependency rewrite was attempted.

## Remaining validation limits

- Symlink privilege-dependent cases and POSIX container-image recipes need
  capable Windows/Linux test environments respectively. No protections were
  changed merely to make their test count green.
- GLB was parsed and its actual geometry/materials checked; Blender itself
  was not installed or tested.
- No offline-network-disconnection test, deliberate RAM exhaustion, bounded
  specialist tool loop, microphone/transcription, OS voice, cloud provider,
  GitHub/MCP integration, packaging, signing or installer acceptance test.
- Native setup and the listed local flows are verified; this is not full
  Windows release certification or completion of every JARVIS roadmap item.
