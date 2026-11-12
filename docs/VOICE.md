# Explicit voice drafts (0.5 track)

## Opt-in hands-free follow-up

The current source also adds a separate local-only wake-phrase session with
continuous microphone capture, Hello Sebby recognition, automatic local chat
and spoken follow-up turns, plus interruption. It is off by default, requires
headphones and native session approval, and keeps ordinary paid/tool approvals.
See [HANDS-FREE.md](HANDS-FREE.md) for controls, retention, bounds and evidence.
Older no-wake-word statements below describe the historical draft-only path.

## Natural local voice follow-up

The current source adds local Kokoro speech, local Whisper-small recognition,
voice/pacing selection, independent input/reply languages and an opt-in
push-to-talk conversation mode. The original OpenAI draft path below remains
available only when explicitly selected/configured; it still requires paid
upload approval. Historical fake-only/native-unverified statements below
describe the older checkpoint. Current actual evidence and limits are in
[NATURAL-VOICE-ACCEPTANCE.md](NATURAL-VOICE-ACCEPTANCE.md); runtime setup,
API/privacy details, primary-source comparisons and licensing are in
[the local speech README](../native/local-voice/README.md).

Implemented: OpenAI-only bounded file transcription; microphone start/stop UI; separate paid-upload native approval; transcript returned for draft review, never automatic chat send. No wake word, continuous listening, cloud voice synthesis, background recording, Anthropic/xAI audio, or audio storage. Live microphone, native permissions and API use remain unverified; tests use fake media and transport only.

## Contract and integration

`VoiceController({getContext, approveCapture, approveUpload, transport?, now?})` owns one transient window/profile-bound session. `getContext()` main-only returns `{provider,profileId,credentials}`. Credentials expose `status()` and `getKey()`, never IPC. `begin({model},windowId)` reserves busy state before awaiting context/native local microphone consent. Explicit transcription model is entered per session; blank default, never inferred from chat model. `end(id,windowId)` revokes capture permission before upload; `transcribe({captureId,bytes,mimeType,durationMs},windowId)` requires consumed microphone grant and ended capture. Every upload asks native approval again, including provider/model/profile, bytes, duration and paid external disclosure. `cancel`, `shutdown`, `isBusy`, `status` complete the contract.

Bridge: `voiceStatus`, `beginVoiceCapture({model})`, `endVoiceCapture(id)`, `transcribeVoice(input)`, `cancelVoice(id)`. Main must validate trusted top-level window and exact app URL on every IPC, serialize against chat/agent/profile mutation, tear down on navigation/close/quit, and never expose context or credentials. Status includes configured/provider/defaultModel(empty)/supportedFormats only.

Main permission policy denies checks by default (avoids Chromium skipping request handler). Request handler grants only `media` with exactly audio, matching trusted main frame/window/app URL, through `consumePermission({windowId,audioOnly:true})`. Grant is single-use and expires after 10 seconds. Camera, screen capture and extra requests are denied. Controller `checkPermission` is a pure lifecycle predicate, NOT authorization to auto-allow browser permission checks. Actual Chromium/Electron behavior needs native validation.

Renderer `VoiceControls({report,onTranscript})` requests audio-only media after grant, releases every track on stop/discard/error/unmount, stops after 60 seconds, and discards above 5 MiB. Finished audio remains transient in memory for explicit upload or discard; controller upload session expires after 10 minutes. No audio bytes enter logs, files, backups, or conversation history. Managed JS/browser memory cannot guarantee physical erasure; owned main Buffer copies are zeroed when request ends. Transcript becomes ordinary user-reviewable draft and is subject to normal draft/chat persistence only afterward.

## API compatibility

`VoiceTranscriber` uses fixed `https://api.openai.com/v1/audio/transcriptions`, direct TLS verification, no redirect/proxy/autoretry. Multipart fields are `model`, `response_format=json`, and `file`; no source file paths or prompts. Supported subset: audio/webm (including opus MIME), audio/mp4, audio/wav. Main enforces 5 MiB, 60-second declared duration (not a media decoder), 128 KiB JSON response, 32,000 transcript characters and 60-second network timeout. Unknown/error/provider responses are sanitized; only transcript and numeric reported usage are returned. Cost is not estimated. Cancellation cannot undo an already dispatched charge or remote processing.

Official sources checked 2026-10-28:
- [OpenAI file transcription guide](https://developers.openai.com/api/docs/guides/speech-to-text)
- [Create transcription reference](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create)

The current guide documents `gpt-transcribe`; use an explicitly selected supported transcription model, not a hardcoded chat default. This adapter intentionally implements only JSON file transcription, not realtime sessions or speech output. API model availability/account access needs user-authorized live validation.

## Verification

Fake-only node tests cover consent order, multipart serialization, normalization, rejection limits, sanitized redirect failure, cancellation during approval, window/audio binding, one-shot/expired grant, concurrent begin and shutdown. Component tests cover empty model gate, no auto-record/upload, stop/unmount track release, oversize discard, declined upload and draft-only transcription. Native Windows microphone permissions, actual encoded audio upload, provider charges and transcript quality are not tested here.

## Local response reading

An explicit button on actual assistant messages reads at most 6,000 characters using only an English voice marked `localService` by the OS speech engine. No remote voice fallback or autoplay. Starting microphone capture stops speech first; stop/navigation releases the current utterance. Engine locality and actual audio output remain native-unverified.

## Turn-based session controls (0.10)

The chat panel coordinates observed capture/transcription/chat/local-speech state. Recording and local playback do not overlap intentionally. “Stop voice activity” stops capture/upload and local reading without cancelling unrelated tasks; “Stop voice and current chat” additionally requests cancellation of the panel-owned chat, including a run ID received after the stop request. It never cancels other agents or plans.

Every stage is deliberate: start capture, stop, approve transcription upload, review draft, send chat, choose local read-aloud. No automatic upload, send, next recording or reading occurs. Reading status follows the actual speech-start callback, not just queueing an utterance. Late/stale callbacks are guarded and independent cleanup continues when a device API throws. Stop is a request, not proof of remote rollback or refunded charges. This is **not realtime conversation**, and native device behavior remains untested.
