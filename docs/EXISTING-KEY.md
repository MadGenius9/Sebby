# Use your existing key, without sending it through chat

The user chose to reuse an existing OpenAI API key. No new key was created. No usable credential was available in this build environment, and none was read, stored, or used for a live request.

Sebby reads `OPENAI_API_KEY` only in its main process at runtime. There is no renderer key field, no automatic env-file loading, no key in source, and no persistent credential write. A presence check does not prove the key is valid or has access to your selected model. Each actual model request needs explicit context/cost approval.

## Windows source launch

After reviewing the source and installing its dependencies, explicitly run:

```powershell
.\scripts\start-sebby-secure.ps1
```

The launcher builds without exposing the key to build tooling, then uses an already-set process environment key or a hidden **local** prompt for your existing key. It launches the local Electron executable without putting the credential in command-line arguments, a file, clipboard, console output or shell history. When the app exits it restores the original process environment. Nothing here creates a key or starts a model request automatically.

Do not paste a key into this conversation, Sebby's chat, project memory, a connector URL, or a repository. There is no reason for Codex or the renderer to see it. Do not bypass PowerShell or OS security policy to run the launcher; use your normal trusted local policy and ask for help if it is blocked.

## Limits

Runtime environment credentials exist in the desktop process's memory. A malicious process with sufficient local access, a debugger, or an OS crash dump may read process memory; this is not a hardened secret enclave. Project command execution intentionally does not inherit the provider environment variable. No long-term OS-vault storage is claimed or silently configured.

This PowerShell launcher has static policy tests only. It has not been run on Windows here. Live credential validity, real model streaming, billing, native UI and OS behavior remain unverified until the user supplies the key locally and explicitly approves a test request.
