# Natural voice and bounded knowledge/tools follow-up

This continues the existing 0.11 implementation on the upgrade branch. The
working tree was clean at intake. Existing app stores, provider profiles,
memory, skills/tasks, Studio schema and scene storage were retained; no data
migration or reset was performed. Generated model/runtime files are outside
the repository. No cloud account or key was created, and no paid request was
made. PR #1 remains draft; no merge is part of this work.

## Acceptance criteria

1. A selectable local neural voice plays through the actual Windows Electron
   app; preference/pacing persist without changing the selected chat provider.
2. Local push-to-talk recognition works independently of an OpenAI chat
   profile, with native microphone consent, a visible listening state, bounded
   duration/bytes and separate input/reply-language choices.
3. Interruption stops current playback promptly, cancels owned stale chat,
   suppresses late audio/transcripts and releases capture tracks. Playback
   cannot intentionally overlap microphone capture.
4. Explicit conversation mode can stop a turn after speech followed by a
   pause, transcribe locally, prepare a native-reviewed chat request, and read
   only its completed owned reply. No wake word or automatic next recording.
5. Provider/model/device/language failures stay visible, never trigger a cloud
   fallback, and preserve unsent work. Existing regressions remain covered.
6. Knowledge preserves legacy notes, records source labels, searches saved
   material, inserts exact cited excerpts into an unsent draft, and reviews
   deletion. Corrupt/concurrently changed storage must not be overwritten.
7. A controlled local-HTML study records actual structural evidence and source
   hash, explains an original fixed-template blueprint, creates and tests a
   separate static artifact, and offers an explicitly approved restricted
   preview. No unknown target code, package scripts or remote assets execute.

## Gauntlet and independent critique

Independent voice research, knowledge/tools and testing specialists worked on
separate slices. A separate critic examined implementation and executed
regressions rather than accepting summaries. Findings fixed and retested:

- A stop during pending cancel IPC could revive a stale synthesis. Generation
  is now captured before awaiting cancellation and checked afterward.
- PTT now stops speech and cancels owned chat before waiting on permission.
- Cancelled/denied/failed/interrupted or duplicate completed events cannot
  trigger automatic reply speech. Unmount and pending-history fetches are
  guarded. Choosing neural speech updates the send-and-speak action.
- Spoken turns and Knowledge citations preserve existing typed drafts.
- Artifact tampering is bounded before allocation, and the original artifact
  hash is enforced on every preview read, including after native review.
- Voice/language/model/rate contracts are aligned. Blob audio has a narrow
  media CSP exception; renderer network access was not broadened.
- The actual Windows restricted preview stalled while enabling debugger guards
  on an uninitialized hidden renderer. A trusted blank-page bootstrap now
  initializes it before both guards are installed. Target content still loads
  only after those guards; negative and ordering tests cover this sequence.
- Pause detection begins only inside explicit local conversation capture,
  closes its AudioContext/timer on stop/unmount, and never starts another
  microphone recording. At the 60-second cap an all-silent recording may
  reach local recognition; the decoder rejects silence rather than fabricating
  a successful transcript.

The final full Windows gauntlet passed: 375 Node tests passed, 22 explicitly
skipped, and 138 component tests passed across 28 files. Typecheck, production
build and formatting passed. The installed speech environment separately
passed all ten Python HTTP/decoder tests. Evidence is in
`.jarvis-delivery-gauntlet.log` and `.gauntlet/latest.json` (local ignored logs).
Platform symlink/POSIX skips remain explicit; passing checks do not turn skipped
coverage into passes. CI remains subject to the previously reported GitHub
account billing/spending restriction; this run is local Windows evidence.

## Actual Windows evidence

On November 12, 2026, on the i7-12700F / RTX 3080 10 GB / 32 GB PC:

- The signed official Python installer and pinned/checksummed model assets
  were installed into a separate per-user speech environment. System Python,
  PATH and Ollama models were retained.
- Kokoro synthesized Heart, Emma and Spanish samples. The user listened to
  the female samples and chose **Heart — American English**. This is a user
  preference, not a universal naturalness rating or an exact voice imitation.
- Actual Electron IPC synthesis produced valid WAV; HTML audio emitted
  `playing` then `ended`, with no renderer/CSP/audio errors observed. The
  visible Preview selected voice control also played and completed.
- A user-approved actual microphone recording was recognized locally. The
  greeting and “can you hear me?” reached the draft; the model rendered the
  name Sebby as “Sebi”. This is real device evidence and a recognition limit.
- That real spoken draft was sent through native-reviewed local `qwen3:8b`.
  The reply completed (176 input + 31 output reported tokens) and Heart began
  reading the saved answer automatically. `ollama ps` still showed 100% GPU.
- A separate actual read-aloud was interrupted with Stop voice activity;
  the UI observed idle in about 18 ms. This is an observed software stop,
  not a measured speaker/acoustic tail guarantee.
- A user-authorized local HTML fixture was inspected and hashed, its original
  three-section static prototype passed four structural checks, and native
  approval opened a real rendered preview with JavaScript disabled, Node
  disabled and sandbox enabled. The initial preview failure was fixed and
  the complete inspect/build/preview flow was repeated successfully.
- Its actual evidence report was imported into Knowledge, saved with a source
  label, found by searching that label, and inserted into an unsent chat draft
  with note ID, revision timestamp, exact lines and a partial-excerpt marker.
  The acceptance report remains as a labelled local note; no AI request was
  made from it. Reviewed deletion is covered by automated tests only.

Kokoro CPU synthesis is batch-based. The measured eight-second sample took
about 4.9 seconds cold / 5.4 seconds warm after thread tuning. Whisper's
synthetic-audio roundtrip took 6.9 seconds including model load. Long text is
split into bounded sentence chunks after a complete reply; this is not
token-streaming speech or low-latency realtime conversation. The user initially
expected a wake-word reply; the test was in manual draft mode. The controls
now explain the modes and include Review, send and speak reply.

## Run and privacy controls

Double-click `Launch-Sebby.cmd` as before. It starts the already installed
local voice sidecar when its runtime/assets exist, starts Ollama if needed,
builds Sebby and opens Electron. It does not install models or change AI
providers. Fresh speech setup is explicitly separate:

```powershell
.\scripts\setup-local-voice.ps1
.\scripts\start-local-voice.ps1
npm run launch:local
```

In Chat, open Voice and speech settings, choose Local neural voice / Kokoro,
check availability, select a voice matching Reply language, and Preview it.
Choose Local / Whisper-small under Talk with Sebby and an input speech
language. Enable Conversation mode for spoken turns; Start recording, approve
the microphone request, speak and pause or press Stop. Native chat approval
still precedes dispatch. Existing typed drafts are preserved for explicit send.

Recordings and synthesized audio are transient memory, not saved recordings.
An unsent/failed recording remains in memory until Discard or leaving the page;
transcript drafts/sent history follow existing local persistence. Managed
memory cannot guarantee physical erasure. Synthetic comparison WAVs were
deliberately saved outside the repo as test artifacts. Local service trust and
its lack of authentication against other local processes are documented in
the runtime README. Credentials are not provided to the speech sidecar.

## Scope and remaining limits

Input recognition supports the sixteen listed app languages plus automatic
detection; actual quality depends on the language/device. Kokoro output is
limited to the exposed English, Spanish, French, Italian, Portuguese and Hindi
voices. Other output combinations are visibly unsupported with no automatic
English/remote substitution. Most multilingual combinations have automated
contract coverage only; English real microphone and English/Spanish synthetic
generation are narrower evidence. Windows device-local voices remain selectable.

Existing OpenAI transcription is optional, internet/charge-disclosed and uses
its existing credential/approval flow. Cloud voice synthesis, wake words,
continuous duplex conversation and cloning are not implemented. No end-to-end
claim of offline operation is made: networking was not physically disabled
across recognition, model, speech and tools. CPU inference can drain after
HTTP cancellation; stale delivery/playback is suppressed.

Knowledge citations are self-contained copied excerpts with note ID, saved
timestamp and line range. They are not immutable revision-history links or
proof that a user-provided source label was independently verified. Search is
keyword-based, without semantic embeddings, OCR, automatic retrieval or bank
backup integration. Deletion does not erase imported originals or chat copies.

The structural study uses counts/landmarks and a fixed original template; it
does not reconstruct arbitrary behavior, execute a package build, or certify
an execution sandbox. General desktop/browser automation and a real isolated
app-build runner remain gated. REA's actual license/dependencies were checked
but it was not installed or run. The four references' available descriptions
and chapters were reviewed; transcripts/full playback were unavailable. See
[the reference evidence map](JARVIS-NEXT-REFERENCES.md).

Kokoro weights/wrapper have Apache/MIT terms, but phonemizer/eSpeak dependencies
have GPL-family terms. Local installation is not installer/commercial
redistribution clearance. No API charges were incurred; models use roughly
840 MB of disk plus interpreter/packages and CPU/RAM/power.
