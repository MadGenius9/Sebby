# Independent source review — turn-based voice and isolated-image contract

This review covers the new voice-session UI and source-only image recipe contract, their supporting cancellation paths, and the test-only isolation adapter. It does not establish native audio, container isolation, image safety or successful real builds.

## Checked evidence

- Scoped voice-session/security/voice/chat component run: **21 tests passed**, including two independent regressions in `component-tests/voice-session-security.spec.tsx`.
- `node --test tests/isolation*.test.mjs`: **31 tests passed**, including three independent pure-parser regressions in `tests/isolation-wrapper-security.test.mjs`.
- No microphone, provider API, container engine, image build/pull, npm project script, dependency installation or native executor was invoked by this review. Wrapper tests import inert functions and inject benign executor doubles.

## Findings corrected

1. A stopped chat could disclose its owned run ID via an event before the pending start promise returned. The event now honors the retained stop intent immediately; the response path retains a fallback without cancelling unrelated runs.
2. A synchronous failure in microphone or device speech cleanup could prevent the distinct owned-chat cancellation branch. Stop actions are independently guarded; a failed device branch no longer prevents the remaining cancellation request. Track cleanup continues after individual track failures.
3. Artifact traversal previously allocated a complete directory listing before checking its count. It now iterates with `opendir`, an entry cap and explicit depth cap before collecting bounded regular-file artifacts.

## Retained boundaries and limitations

Voice activity is turn-based and explicit: capture, upload approval, draft review, chat send and local read-aloud remain separate actions. Voice-only stop does not cancel chat. The combined stop targets the current owned chat, including pending start intent. Speech state distinguishes queued playback from observed `onstart`; stale utterance events cannot revive a stopped session. Labels describe a **stop request**, not guaranteed remote cancellation or reversed charges. Native consent, media-device behavior and OS-local speech still require target-device validation.

The image recipe receives bounded canonical JSON source bytes over stdin rather than a host staging bind mount. This avoids assuming container UID 65532 can read host-owned mode-0400 files, but the new delivery contract itself is only source/mock tested. Production execution remains unconditionally unavailable and no runner transport is exposed over IPC.

The wrapper verifies bounded paths, duplicate/prototype keys, canonical base64, per-file hashes, complete snapshot identity, recipe and exact preprovisioned dependency-lock identity before materializing an exclusive temporary project. Its fixed npm recipe does not install dependencies, and its child output is bounded. An explicit npm script nevertheless remains arbitrary untrusted code; `--offline` and `--ignore-scripts` do not sandbox that script. A dependency cache hash identifies expected bytes, not trustworthy dependencies.

A hostile same-UID project process may attack its wrapper, output or other processes. Process-group killing is not proof that all descendants terminated. A matching wrapper hash/result envelope is not authenticated evidence that a build genuinely succeeded. The outer engine must enforce whole-container resource/network/filesystem boundaries, stop and verified cleanup before quarantine. The test-only adapter now checks stopped state before accepting artifacts; mocked inspection does not prove real kernel or daemon behavior. Partial operations remain uncertain when ownership or cleanup cannot be confirmed.

The Dockerfile is a source template with no default base image and no supplied dependency cache. Image provenance, fixed runtime paths, read-only cache ownership, whole-container deadlines, daemon privilege, OS containment, resource limits and cancellation must all be independently validated before any future production enablement. No such enablement is claimed here.
