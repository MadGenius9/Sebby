# First Windows run — tonight

**Goal:** launch Sebby from reviewed source and check its local features. No API key or account connection is needed. There is **no verified, signed Windows installer supplied**, and the Windows steps below have not been run on your laptop. Stop at the first failure; do not disable Windows protections to continue.

## 1. Check what is already installed

Open **Command Prompt normally, not as Administrator**. These version checks do not install anything:

```bat
node --version
npm --version
```

This source targets **Node.js 24 LTS**, with npm available. If either command is missing, or Node is another major version, pause. Installing/changing software is a separate choice: use the [official Node.js downloads](https://nodejs.org/en/download) and your usual trusted installation process or organization-approved support. Do not run pasted bootstrap scripts, change PowerShell execution policy, bypass SmartScreen, or elevate just to make this checklist pass. Reopen Command Prompt after an approved installation and repeat the checks.

**PowerShell 7 and .NET 10 are not needed to launch Sebby.** They belong only to the separate, opt-in [Windows helper validation](WINDOWS-CONTAINMENT.md). That helper remains disabled; do not run it as part of first launch.

## 2. Get the reviewed private source

Use the exact Sebby private repository and reviewed commit provided for this delivery—not a lookalike repository or an arbitrary latest branch.

- Simplest: sign in to GitHub normally in your browser, open the reviewed commit and download its source ZIP. Extract it to your own project folder.
- If Git is already installed, normal Git clone/checkout through your existing GitHub credential manager is also fine. Do not install Git just for this checklist; ZIP download works without it.
- Never put a token into a clone URL, terminal command, screenshot or chat. Authenticate through the normal trusted GitHub flow.

In Command Prompt, enter the extracted folder containing `package.json` and `package-lock.json` (replace this example path):

```bat
cd /d "C:\Users\YOUR-NAME\Projects\sebby-desktop"
dir package.json package-lock.json
certutil -hashfile package-lock.json SHA256
```

Record the repository/reviewed commit and lockfile SHA-256 locally before installing. For a Git checkout, `git rev-parse HEAD` reports the checked-out commit; for a ZIP, record the commit shown on the download page. A lockfile hash identifies your copy—it is not a signature or proof that dependencies are safe. Do not regenerate the lockfile or run `npm update` to work around an error.

## 3. Explicitly choose whether to install dependencies

**Read before running:** `npm ci` contacts dependency/download servers, writes `node_modules`, replaces any existing `node_modules` in this project, and can execute dependency lifecycle scripts. Electron's installation may download its runtime. Only proceed if you trust this reviewed source and locked dependencies and accept those network/code-execution effects. If not, stop here; no account or key setup is required to decide later.

Run each command separately and check its result before the next:

```bat
npm ci
npm test
npm run test:components
npm run build
npm start
```

Tests execute project test code and temporary fixtures; they are not merely a source scan. `npm start` builds again, then opens the Electron desktop app. Do **not** use `npm run package:win`, a release/installer script, or `npx` downloads for this first run. Do not substitute the browser-only `npm run dev` preview for a desktop test.

If installation, tests, build, or launch fails, stop and collect the sanitized report below. Windows-specific permissions, dependency downloads or native behavior may still fail despite the recorded Linux test results. Do not enable Developer Mode, request elevation, disable antivirus or alter security policy to force a test through.

## 4. Local-only smoke check

Once the desktop window opens:

1. Confirm the app is named **Sebby**, the Orbit pal appears, and the main sections open. Change a pal/color if you like; check that it persists after a normal close/reopen.
2. Select a new, empty scratch project folder you own—not a sensitive project or a drive root. Add a short project-memory note and confirm it survives a normal restart.
3. Try the local note-creation flow. Read its native confirmation and approve only the harmless scratch note you requested. Confirm the file exists in that folder.
4. Inspect skills, team/tasks and connector settings. A queued task is not executed work; disconnected/unverified connectors should not pretend to be connected. Do not run AI, GitHub, MCP or command actions for this offline check.
5. Close and reopen Sebby. Report crashes, missing native prompts, persistence failures or misleading status text rather than treating the launch alone as acceptance.

Existing API-key environment variables may make a provider show “configured”; that is not verified connectivity and does not require you to send a request. Leave account features alone during this check. The fuller [native acceptance matrix](NATIVE-ACCEPTANCE.md) separates offline checks from optional account/cost checks.

## Optional later: AI setup

Only after local launch works, follow [BYOK settings](BYOK.md). Enter a key **only into Sebby's masked Settings field**, never in chat. Storage requires the app's native confirmation and available OS encryption. Choose an explicit model; API usage is billed separately from a chat subscription. Connection tests and requests require their own native approval and may cost money. Do not connect GitHub/MCP or create credentials just to complete first launch.

## If something fails, send this—not secrets

```text
Sebby first-run report
Windows version / x64 or ARM64:
Node version:
npm version:
Source version / reviewed commit:
package-lock.json SHA-256:
Last successful step:
Failing command or exact UI action:
Exit code, if shown:
Sanitized error lines:
Did an Electron window open? Did a native approval dialog appear?
```

Copy the smallest useful error excerpt. Remove keys/tokens, authorization headers, credential URLs, private conversation/source content, and personal folder names. Do not send `.env` files, vault files, full app-data folders or private logs. A missing dependency or blocked step is useful evidence; it is not a reason to bypass a protection.
