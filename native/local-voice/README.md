# Local speech sidecar

This is an explicitly installed, fixed-loopback speech service. It does not
replace Sebby's Ollama profiles, app data, memory, Studio, or cloud adapters.
The first slice uses CPU Kokoro ONNX synthesis and CPU int8 Whisper-small
recognition, leaving RTX 3080 VRAM available for Ollama. Neural synthesis does
not reproduce any referenced assistant's exact voice or guarantee subjective
naturalness.

## Install and start on Windows

Run from the repository in PowerShell:

```powershell
.\scripts\setup-local-voice.ps1
.\scripts\start-local-voice.ps1
```

Setup makes explicit network downloads: Python 3.12.10 from python.org when
needed, Python packages from PyPI, and fixed-revision model files from upstream
GitHub/Hugging Face. Python's installer signature and all model file SHA-256
hashes are checked. An existing mismatching model is preserved and setup stops.
Python 3.14 is outside the selected Kokoro package's supported version range;
the dedicated Python 3.12 install does not alter system Python or PATH.

Runtime and models live at `%LOCALAPPDATA%\Sebby\local-voice`, with the
dedicated interpreter at `%LOCALAPPDATA%\Sebby\Python312`. Downloads are
roughly 840 MB of models, plus interpreter and packages. No API fee applies to
local CPU inference. Power, memory and disk are still used.

Startup binds **127.0.0.1:11435 only**. It downloads nothing. TTS/ASR models
are lazy-loaded from explicit local paths. Hugging Face offline/telemetry flags
are set; these flags are not evidence that the whole app ran with networking
physically disabled. There is no authentication against other trusted local
processes. Browser requests carrying Origin, cross-origin preflights, wrong
Host headers, arbitrary routes and remote model configuration are rejected.

## Contract

- `GET /health`: available process, asset readiness, separate TTS/ASR warmed
  flags, selectable voices, recognition-language codes, memory-only retention.
- `POST /synthesize`: JSON `{text, voice, language, speed}`, returns PCM16 WAV.
  Voice/language pairing is checked, text is limited to 6,000 characters, rate
  to 0.7–1.3. Speech output has a ten-minute bound.
- `POST /transcribe`: JSON `{audio: base64, language}`, returns `{text, language}`.
  Only WAV and WebM are accepted, at most 5 MiB and **60 seconds of actual decoded
  audio**, decoded incrementally in memory. Silence is rejected before ASR.
- Only one inference runs at a time; another request gets HTTP 409. Missing
  models/inference failure gets 503, malformed requests 400, oversized bodies
  413. Errors contain no recording, transcript, credentials or private path.

Inference is batch-based, not a streaming speech endpoint. Closing HTTP stops
delivery; already running CPU work may drain before the next inference can
start. The renderer must stop playback immediately and reject stale results
using its session generation. No server claim of immediate compute cancellation
is made. The microphone must be stopped before playback to avoid self-hearing.

Audio request bytes and decoded samples are held only in process memory. The
service does not write recordings, transcripts, synthesized output, or request
bodies to disk. Managed memory cannot guarantee physical erasure. Explicitly
saved synthetic comparison samples are separate test artifacts, not automatic
recording retention. Once a transcript becomes a reviewed chat draft, normal
Sebby draft/history retention applies.

## Available languages

Selected synthesis uses English (US/UK), Spanish, French, Italian, Brazilian
Portuguese and Hindi voices. Japanese/Mandarin Kokoro voices are not exposed:
their phonemizer setup is outside this slice. Other unavailable output languages
must be labeled unsupported, never silently mapped to English. Model quality
varies by voice and language; the model card explicitly warns of uneven
non-English coverage.

Whisper-small recognizes the app's sixteen language codes, plus automatic
detection. Input and output choices are separate; detecting a language does
not make a matching output voice available. Only English and Spanish synthetic
audio interoperability checks have been attempted in this environment; live
microphone recognition and subjective multilingual quality need separate checks.

## Technology choice and license boundaries

| Option | Practical tradeoff on this PC | License/offline boundary |
|---|---|---|
| Kokoro ONNX CPU (selected) | Small neural TTS, selectable voices and speed; uses CPU to avoid competing with Qwen3 VRAM. Batch audio, not this service's realtime stream. | Kokoro weights Apache-2.0; wrapper MIT. Actual phonemizer/eSpeak dependencies are GPLv3-family, so the whole runtime is not an all-permissive bundle. Local assets support offline execution. |
| Sherpa-ONNX | Native/WASM/Node and Python APIs can unify offline recognition and TTS. Model-specific language/phonemizer support matters. | Apache-2.0 engine; each model and bundled phonemizer has separate terms. Its documented Kokoro multilingual recipe specifically enables English/Chinese rather than every upstream voice language. |
| Piper | Fast local TTS and many voices, useful on low-resource CPU systems. Voice quality must be auditioned rather than ranked from metadata. | Current engine GPL-3.0-or-later. Voice model cards and fine-tuning ancestry require individual review; do not assume the engine license covers voice weights. |
| Faster-whisper CPU int8 (selected) | Multilingual local recognition; avoids Windows CUDA/cuDNN setup and leaves GPU for Ollama. Batch push-to-talk, not an automatic streaming ASR service. | MIT implementation; selected Systran converted Whisper model declares MIT. PyAV bundles its audio-decoder libraries; distribution needs a full dependency-license review. |
| Faster-whisper GPU | May reduce recognition latency, but competes with Ollama and requires compatible CUDA 12 cuBLAS and cuDNN 9 libraries. | Not enabled or benchmarked here. Driver availability alone does not establish those runtime libraries. |
| Configured cloud speech | May offer expressive voices or low-latency streaming, depending on selected API. Internet and usage costs apply; nothing falls back automatically. | Existing OpenAI transcription remains opt-in with its approval/key flow. This sidecar never accesses cloud credentials. Cloud synthesis was not implemented or charged by this sidecar. |

No commercial redistribution clearance is implied. This local setup installs
upstream packages in a separate environment; shipping them inside an installer
needs complete notices/source and model-license review.

Primary references:

- [Kokoro model](https://huggingface.co/hexgrad/Kokoro-82M) and
  [voice quality/language notes](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md).
- [Kokoro ONNX API and setup](https://github.com/thewh1teagle/kokoro-onnx),
  [dependencies](https://github.com/thewh1teagle/kokoro-onnx/blob/main/pyproject.toml).
- [Sherpa-ONNX Kokoro recipes](https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/kokoro.html).
- [Piper voice licensing](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/LICENSING.md).
- [Faster-whisper API, requirements and published benchmarks](https://github.com/SYSTRAN/faster-whisper).
- [Phonemizer license](https://github.com/bootphon/phonemizer/blob/master/LICENSE),
  [eSpeak-ng license](https://github.com/espeak-ng/espeak-ng/blob/master/COPYING).

## Checks observed on November 12, 2026

Python contract/HTTP tests use standard-library/stub fixtures; decoder tests
exercise the actual PyAV path when installed. Run them with:

```powershell
& "$env:LOCALAPPDATA\Sebby\local-voice\venv\Scripts\python.exe" -m unittest discover -s native/local-voice -p 'test_*.py'
```

Actual neural synthesis on Windows succeeded for `af_heart`, `bf_emma` and
Spanish `ef_dora`. A roughly eight-second English sample took 16.8 seconds
including first load with the original default ONNX thread pool; warm requests
took 10.9–11.6 seconds. Limiting the TTS CPU pool to four threads reduced the
same cold/warm checks to 4.9/5.4 seconds. These are local observations, not
latency guarantees, and other active work changes the result.

The generated English sample was decoded and recognized by the actual local
Whisper model in 6.9 seconds including first model load. Text matched the test
phrase apart from punctuation and the name “Sebby” becoming “Sebi”. This
establishes a synthetic file roundtrip, not actual microphone accuracy or a
listening-quality rating. No full disconnected-network test has been performed.
