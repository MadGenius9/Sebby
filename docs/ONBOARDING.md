# Sebby first-run guide — development checkpoint

Sebby is a Windows-oriented personal workbench under development, not yet a verified/signed public Windows release. Follow `RELEASE.md` for an approved native test setup. Do not disable operating-system protections or install unknown software to bypass a warning. This guide describes implemented/source-reviewed controls and the 0.6 preview work being integrated; it does **not** assert that native Windows checks have passed.

## 1. Start local and keep control

Open a reviewed source build only through your normal trusted development process. Browser preview is different: it cannot use native folder access, OS key storage or desktop-only capabilities. Choose a disposable project folder first, not a drive root or irreplaceable production project.

Set your companion/palette and personality. These are local preferences, not permission to access accounts or run tools. Add non-secret goals/decisions to Memory. Local memory, tasks, drafts, results and exported backups are plaintext; never put API keys, GitHub tokens or passwords in them.

## 2. Reuse your existing AI key

In Settings, choose/create a provider profile, select the correct provider, enter an explicit model identifier you are authorized to use, and choose the output limit. Profile creation does not create an account, key or subscription and does not make a provider request.

- If you explicitly enable the existing environment-key option, Sebby checks only the provider's fixed supported variable in its main process. It does not search other applications or expose the value.
- If OS-protected storage is available, the profile has a masked key field for **your existing key**. That field is local to Sebby's credential entry UI, not chat. Saving requires native confirmation, clears the input immediately after IPC submission, and stores only through the OS-encrypted vault. It is not retained in React state/browser storage or shown afterward; JavaScript/IPC memory copies cannot promise forensic zeroization.
- If protected storage is unavailable, saving is disabled. There is no plaintext fallback. Do not paste a key into a task, conversation, memory, URL, connector name or this assistant conversation.
- “Key available” means presence, **not verified access**. Connection testing is a separate explicit provider request that can incur charges. Inspect its native consent and model/budget before choosing to run it. No such live test was performed during implementation.

Switching profiles does not transfer a key to another provider; encrypted credentials are bound to their profile/provider. Backups contain profile metadata, not vaults. See `BYOK.md`, `PROVIDERS.md` and `PRIVACY.md`.

## 3. Chat and named specialists

Drafts do not send automatically. When you explicitly send, inspect what text/context leaves the device and the selected provider/model. A failed or missing provider produces an honest blocked/error state, not a fabricated answer.

For a larger goal, create a workspace-bound AI task. Sebby can give a specialist a distinct authored name and job, or use an assigned teammate. Starting the task requires native outbound-data/tool approval. Optional file reads require their own exact-content approval; coder changes need full diff review plus native confirmation. No shell/publish permission is implied.

The specialist result is followed by a separate provider coordinator critique and stays **awaiting review** until you accept it. Inspect evidence and tests actually performed; a model's confidence is not verification. Deterministic inventory/brief-template utilities are clearly labeled local utilities, not AI app-building completion. Cancellation stops pending work cooperatively; previously approved committed edits may remain.

## 4. GitHub, read-only

In Connections, configure the exact GitHub.com owner/repository/ref. Saving configuration makes no request. A repository bookmark does not prove access or connect an account.

Use a public unauthenticated read when appropriate, or explicitly opt into an existing environment token / OS-encrypted token. The dedicated masked token field is for credential entry only; it clears after submission and needs native save confirmation. Never put a token in the repository URL, name, chat or memory. Use the narrow access appropriate to the repository; token creation/account authorization is your separate action, not something Sebby silently performs.

Metadata, tree and file reads each have distinct native approval. Received text is inert/untrusted and is not automatically sent to AI. This connector does not push, clone, execute code, change issues or publish. Actual GitHub access remains live-unverified in this checkpoint. See `GITHUB.md`.

## 5. Voice is opt-in, not always listening

Voice controls require an explicit record action and native microphone permission/consent. There is no wake word or background recording. Review the selected transcription provider/model and limits. Audio is held temporarily, and upload/transcription requires a separate confirmation that can incur provider charges. The transcript becomes a draft; it is not automatically sent as a chat message or command. Cancel/navigation releases recording resources. Local read-aloud uses an explicitly selected supported local voice and does not autoplay or silently fall back to a remote voice.

Actual microphone access, local voice availability, audio encoding/upload and speech quality have not been verified on Windows here. If unavailable, use typed text; do not grant broader device permissions to force it to work. See `VOICE.md`.

## 6. Manual HTML preview — 0.6 integration scope

The single-file preview service is being integrated for manually selected supported `.html`/`.htm` files. It is not a development server, general browser automation, build command or evidence that an app works. Open only via the explicit workspace preview action, inspect the file/hash/native warning, then review the isolated preview window.

The preview is static-only: project JavaScript is disabled, and HTML is parsed and sanitized before display. The intended isolated window has no Sebby preload/tools/credentials, blocks network/navigation/download/device/file-picker access and is manually closable. This is not an interactive app preview; disabling scripts also avoids promising a complete WebRTC network sandbox. External resources and many ordinary web-app features will not work. Native adapter behavior remains a separate validation gate; do not describe source tests as proven hostile-page isolation. See `PREVIEW.md`.

## 7. Back up deliberately

Use the explicit backup/export controls. Backups may contain sensitive local text and paths but exclude API/GitHub credential vaults. Keep exports private. Review listed stores before restore, stop active work, and restart afterward. Restoring metadata does not restore credentials or authorize network requests. See `BACKUP.md`.

If a dialog, provider response or task result is unclear, stop and review the scope rather than granting broader access. Publishing, paid services, native containment enablement and public release remain separate decisions.
