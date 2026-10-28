# Provider profiles and bring-your-own-key boundary

These services implement local metadata and credential storage, **not account login, credential validation, model discovery, or a paid API request**. Development tests use isolated temporary directories, artificial sentinel strings, and deliberately fake encryption. No real credential was read or saved during implementation.

## Metadata API

`ProviderProfiles(userDataDirectory)` stores `sebby-provider-profiles.json`. Call `await load()` before use.

- `list()` → `{profiles, selectedProfileId}`; `get(id)` → cloned profile; `selected()` → selected profile or `null`.
- `create({name, provider, model?, useEnvironment?, options?})` returns a new UUID profile.
- `update(id, {name?, model?, useEnvironment?, options?})`; provider type and ID are immutable.
- `select(id)`; `remove(id)` → metadata-only removal. Removing metadata does **not** silently delete a credential; main must obtain explicit consent and coordinate key removal first, or clearly disclose retained encrypted credentials.
- Supported providers: `openai`, `anthropic`, `xai`. A model may be blank while configuring, but request orchestration must require an explicit valid model before sending.
- Options are deliberately limited to `maxOutputTokens` (256–8192, default 2048). No arbitrary endpoints, headers, environment-variable names, executable configuration, temperature/reasoning knobs, or credential fields are accepted.
- Names are distinct, bounded, and reject control/bidi characters and common obvious API-key patterns. Such checks are not general secret detection: users must not paste secrets into metadata.
- Maximum 50 profiles. Registry loading is bounded to 128 KiB; unknown schema fields, corrupt data, linked files/directories, invalid selection, and duplicate IDs fail closed without resetting existing data. Writes serialize through exclusive temporary files and atomic rename.

The first startup seeds one OpenAI profile with an empty model and `useEnvironment: true`, reflecting the user's explicit instruction to reuse their existing key. It does not read or copy that key into metadata. Additional profiles default to `useEnvironment: false`.

`validateProfilesDocument(value)` is a pure schema validator for backup import. **Only this non-secret metadata file may be added to backup allowlists.** Restoring metadata can restore selected profiles and environment opt-in choices; backup confirmation should disclose this. Restoring a profile does not restore a key, verify account access, or grant permission for paid requests.

## Encrypted vault API — main process only

`ProfileVault(userDataDirectory, {safeStorage})` uses the injected Electron `safeStorage` API. Its separate directory is:

```
sebby-profile-vault/<profile-UUID>.credential
```

**Exclude the entire `sebby-profile-vault` directory from backups, exports, logs, debugging bundles, and renderer reads.** Do not expose a generic path API for it.

- `status(id)` → `{configured, source, secureStorageAvailable, hasStoredCredential}`. Configured means encrypted material exists and OS encryption is available; it does not mean a key has been authenticated or a provider call will succeed.
- `save(id, key, {provider, confirmed: true})` → `{saved: true, profileId}`.
- `remove(id, {confirmed: true})` → `{removed: true, profileId}`.
- `getKey(id, {provider})` returns a plaintext string **internally to a trusted provider adapter only**. Never register it as IPC or put its result in a status/event/log.

Save/remove require an explicit main-process confirmation flag supplied **only after a native dialog**, never accepted from the renderer. Dialogs identify the provider and profile without showing the key. Main must first resolve the supplied UUID against the profile registry; vault UUID validation alone does not prove that a profile exists. Confirmed metadata deletion should coordinate with explicit vault removal so keys are not unintentionally orphaned.

Encrypted envelopes bind version, profile UUID and provider to the key. A restored metadata record that changes provider cannot redirect an existing stored key: mismatched or legacy raw-key ciphertext fails closed, without environment fallback.

Encryption must be available and must not use Electron's Linux `basic_text` fallback. Otherwise saving and decryption fail closed; no plaintext alternative is written. Existing unavailable/corrupt vault material is not silently replaced with an environment credential. Vault files are at most 16 KiB, use exclusive temporary writes with mode 0600, and reject symlink files/directories. Reads use bounded handles and `O_NOFOLLOW` where available. Encrypted buffers are cleared after use where practical.

This checkpoint targets the pinned Electron 45 synchronous safeStorage API. Electron documents those methods as deprecated in 45 and scheduled for removal in 46; do not upgrade the Electron major version without an explicit asynchronous-API migration and OS testing. See the [official safeStorage documentation](https://www.electronjs.org/docs/latest/api/safe-storage).

OS encryption protects data at rest according to that OS/user account; it is not a defense against all software already running as that user. JavaScript strings and IPC serialization cannot promise forensic zeroization of every transient copy. The implementation does not claim an adversarial concurrent-filesystem guarantee against another local process replacing directories between checks; use a private user-controlled app-data location.

## Masked key entry in Settings

The user explicitly authorized entering their own provider keys in Settings. The UI should therefore use an **uncontrolled password input accessed by a ref**. Do not store the key in React state, context, a global store, local/session storage, URL parameters, clipboard history, telemetry, or error messages. Clear the input as soon as submission begins and clear any temporary variable/reference after the IPC attempt settles. Do not implement a key-reveal/read-back operation.

The necessary save IPC carries only `{profileId, key}` transiently. Main validates the profile, opens native confirmation naming that profile/provider, and then calls vault save with its own `confirmed: true`. Renderer-provided `confirmed` or arbitrary filesystem targets must be rejected. Clear/cancel should not retain the input. Native denial or unsupported OS encryption must leave storage unchanged.

Lock profile switching, edits, credential updates/removal, and backup restore while chat or agent work is using a profile, so consent is not followed by a changed account/model/source. Maintain independent explicit cost/context consent for each chat send/test or bounded specialist run (including its coordinator call); storing or selecting a key never grants background paid-call authority.

## Runtime resolution

`RuntimeProfileCredentials(profileId, {profiles, vault, env})` is a main-process adapter with `status()` and internal `getKey()`.

1. An existing vault entry takes precedence, including when temporarily unavailable. Decryption failure does not switch accounts by falling back.
2. Only if no vault entry exists, and the profile explicitly opts in, use its fixed variable: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `XAI_API_KEY`.
3. No arbitrary variable names are accepted. Status returns configuration/source/OS availability only, not the value, suffix, length, or validity of a key.

The provider adapter remains responsible for fixed trusted API endpoints, request schemas, models, streaming, error sanitization, and network behavior. Model identifiers are user-entered metadata here; this service does not make an unapproved discovery request.

## Verification

`node --test tests/profiles.test.mjs tests/vault.test.mjs` exercises default reuse metadata, CRUD/select persistence, strict field validation, source opt-in and precedence, bounded/symlink-safe loading, serialized writes, native-confirmation gates, unavailable/basic-text refusal, encrypted-only test storage, and sanitized errors. These are module tests with fake OS encryption, not native Windows DPAPI/keyring or renderer/IPC integration evidence. No real keys or network calls were used.
