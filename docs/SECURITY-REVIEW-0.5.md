# Incremental security review — 0.5

Reviewed locally on 2026-10-28. No microphone capture, live provider request, GitHub authentication/request, actual credential inspection, or native Windows process execution occurred. Test transports, media objects and credentials are synthetic.

## Voice

- Main owns the selected provider/profile/credential context; it is not an IPC endpoint. Busy capture/upload blocks profile mutations and paid chat/test/agent starts.
- A native capture confirmation precedes a short-lived, single-use permission grant bound to the trusted window/main-frame/app URL and audio only. Permission checks default-deny; requests consume the grant. Camera/display/other permissions remain denied. This is source and fake-handler validation, not proof of native Chromium behavior.
- Separate native paid-upload approval discloses provider/model/profile/size/duration. Fixed OpenAI HTTPS endpoint, verified TLS and no redirect/proxy/retry. Audio has a real 5 MiB input bound; the 60-second duration is renderer timer/declared metadata, **not decoded audio enforcement or an independently verified native cutoff**.
- Cancellation/shutdown during asynchronous preparation or approval blocks dispatch. Upload busy state remains until the cancelled request drains. Capture expires and shutdown is permanent.
- Review found incomplete temporary-byte cleanup and stale recorder callbacks that could affect a newer session. Owner fixed main accepted IPC bytes and UI temporary bytes with finally cleanup and added generation/alive guards. Blobs/JS/browser memory cannot guarantee physical erasure.
- Transcripts enter a reviewable draft only. No automatic chat send or audio persistence. Aborting cannot undo remote processing or charges.

Independent `tests/voice-security.test.mjs`: **5/5 PASS**. Combined voice/controller/media-policy tests: **15/15 PASS**. These cover fixed transport, cancellation before consent/key access, sanitized errors, buffer cleanup, window/grant binding and permission denials.

## Read-only GitHub

Reviewed fixed `api.github.com` GET transport, public-only DNS resolution and pinned verified TLS, no redirects/proxies/retries, independent per-request native approval, explicit token opt-in and dedicated host-bound encrypted vault. Blob reads are restricted to retained bounded tree entries, require matching size/SHA and recomputed Git blob hash, and accept bounded UTF-8 text only. No repository content is automatically attached to AI, executed or written to the workspace. Tokens use an uncontrolled masked entry with transient renderer exposure, not readback.

Flagged a cancellation guard after asynchronous vault status so shutdown/cancel cannot trigger a later native read prompt; owner applied the correction and regression coverage passes. Arbitrary endpoint/header/token fields are not accepted. Native vault behavior, GitHub account permissions and live endpoint interoperability remain unverified.

## Windows job runner prototype

Inspected source-only disabled prototype: no Electron/UI execution integration, explicit trusted-host opt-in, expected executable hash, bounded protocol/argv, minimal environment, restricted handle inheritance, suspended process creation with atomic job assignment, membership check before resume, job/process/memory/output/time bounds and cancellation. This is lifecycle containment, **not a filesystem/network/credential sandbox**. Executable filename denylisting is an accident guard, not defense against renamed interpreters or malicious approved native binaries. C# compilation and all native behavior require Windows validation; no claim of safe enabled command execution follows from JS contract tests.

## Evidence and remaining gates

`node --test tests/ai-ipc-security.test.mjs tests/voice*.test.mjs tests/media-permissions.test.mjs tests/github*.test.mjs`: **35/35 PASS** at review time. Owner suites may grow after this snapshot. Actual Electron permission transitions, microphone-track stop/teardown, file capture/upload compatibility, OS encryption, real API/GitHub auth and billing, Windows process containment and signed installer execution remain untested. Retain the explicit disabled native runner until those gates are met.

Protocol references consulted: [Electron session permissions](https://www.electronjs.org/docs/latest/api/session), [OpenAI transcription reference](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create), and [GitHub API versioning](https://docs.github.com/en/rest/about-the-rest-api/api-versions).
