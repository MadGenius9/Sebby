# Windows 11 local workspace

Download the `sebby-v2` source ZIP from GitHub, extract it to a normal folder you control, then double-click **Start-Sebby.cmd**. Do not run inside the ZIP viewer. If prerequisites are missing, the launcher points to the official Node.js and Git installers; install them and reopen the launcher. Use Node.js 22.12 or newer; Node 22 is the CI-tested version. No administrator elevation, registry changes or global PowerShell policy changes are performed by this launcher.

The launcher checks prerequisites, runs `npm ci` when its dependency/Node-ABI marker changes, builds the app and starts it on **http://127.0.0.1:8787/workspace**. It opens the browser after the health endpoint confirms readiness. Keep the console open; press Ctrl+C there to stop. A port already in use is refused before installation or browser opening. To use a different port, run `Start-Sebby.cmd --port=8788` in Command Prompt.

The email form selects a local development identity; it is not verified authentication or Google sign-in. Use the same email to reopen your projects. Save explicitly before closing. This mode starts no live AI engines and makes no model calls, so adding OpenAI, Claude, Grok and Gemini still requires full-service configuration. Drive requires its own OAuth configuration and consent. The launcher does not claim these accounts are connected.

## What is available now

The local workspace includes coding, project notes/search, saved revisions and reviewed recovery, source ZIP/public GitHub snapshot import, early polygon modeling and GLB export. The companion can be paired separately with a selected folder. Live agents, voice and an isolated worker have separate prerequisites. An ordinary Docker Desktop installation is not certified as this runner: it requires rootless Docker, cgroup v2 and verified resource limits, and fails closed if those are missing.

For the complete AI/build service on Windows 11, WSL 2/Ubuntu is the intended Linux environment to validate next. Install it using Microsoft's documented `wsl --install` flow if needed; a restart and Linux-user initialization may be required. WSL, Hermes/provider authentication and the rootless worker are not installed automatically by this launcher. A WSL workspace should have its own clone and Linux `node_modules`; do not reuse native Windows dependency files inside Linux.

## Data and later migration

By default, projects and history are in `data/grokbot.db`, with private run data under `data/runs`. A custom `DB_PATH` or `SEBBY_RUNS_DIR` changes those locations. Before moving hosts, stop Sebby and preserve the whole data directory, not only a live SQLite file. Keep a separate backup. Current-project JSON exports are useful portable copies but do not include full revision/run history.

Move your stopped data and necessary private configuration to the new host, reinstall dependencies for its operating system, and configure real authentication/HTTPS before exposing it. Drive refresh credentials require the same private encryption key or reconnection; OAuth callback URLs and companion pairing may need updating. Do not include personal data, keys or tokens in the public repository.

## Diagnostics and verification

`Start-Sebby.cmd --check` (or `npm.cmd run local -- --check`) prints a read-only prerequisite report without opening a browser, starting the server or creating a database. `npm.cmd run local -- --no-open` leaves browser opening to you. A failed install/build remains visible in the console; a failed install is not marked successful.

`npm run test:local` builds the app and tests prerequisite diagnostics, occupied-port refusal, real loopback startup, saved-project persistence across restarts, and supervised child shutdown. On Windows, it also invokes the actual CMD wrapper from a junction path containing spaces. These are hosted Windows runner checks, not proof of installation on Chuck's Windows 11 machine. Native Windows package/ACL/antivirus behavior and the full WSL/provider/worker setup remain to be validated.


## Live voice

Create a plain-text file named `.env.local` in the Sebby folder. Add `XAI_API_KEY=your_key_here` on its own line. Make sure Windows did not add `.txt` to the filename. Restart Sebby, sign in to the local workspace, then select **Start live voice** under **Projects** and allow microphone access. Speak normally and interrupt when you want to jump in. Sebby streams the conversation audio to xAI during the call. The Windows workspace call supports conversation and brainstorming. Project actions through voice require the full agent service.

After hanging up, open **Last voice transcript** to review the available captions, download a text file, or add it to the open project. Use **Save** to keep an attached transcript in project history. The workspace keeps the last transcript in the current tab until you clear it, reload, or finish a newer call with captions.

To discuss a project, open it and select **Talk about this project**. Review or edit the preview before choosing **Share brief and start**. The call sends the project name and up to 4,000 characters of the text you approve to Grok. The preview starts with the project brief in `SEBBY.md`, including any edits currently in the workspace. Choose **Start live voice** for a general conversation.

Open **Voice settings** in the Projects sidebar to choose Sebby’s voice and speaking speed for future calls. The setting is remembered in that browser and applies to both general and project calls.

Use **Preview voice** to hear a short Grok sample of the current settings. Stop the sample or close the dialog to cancel playback. The preview does not ask for microphone access.
