"""Sebby local speech. Fixed loopback API; no recording files or runtime downloads."""

import argparse
import base64
import io
import json
import math
import os
from pathlib import Path
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

PORT = 11435
MAX_AUDIO = 5 * 1024 * 1024
MAX_BODY = 7 * 1024 * 1024
MAX_SECONDS = 60
# Only voice/language combinations this backend can phonemize locally are offered.
# Japanese and Mandarin require additional phonemizers and are deliberately absent.
VOICES = [
    {"id": "af_heart", "name": "Heart · American English", "language": "en", "phonemes": "en-us"},
    {"id": "af_bella", "name": "Bella · American English", "language": "en", "phonemes": "en-us"},
    {"id": "am_michael", "name": "Michael · American English", "language": "en", "phonemes": "en-us"},
    {"id": "bf_emma", "name": "Emma · British English", "language": "en", "phonemes": "en-gb"},
    {"id": "bm_george", "name": "George · British English", "language": "en", "phonemes": "en-gb"},
    {"id": "ef_dora", "name": "Dora · Spanish", "language": "es", "phonemes": "es"},
    {"id": "ff_siwis", "name": "Siwis · French", "language": "fr", "phonemes": "fr-fr"},
    {"id": "if_sara", "name": "Sara · Italian", "language": "it", "phonemes": "it"},
    {"id": "pf_dora", "name": "Dora · Brazilian Portuguese", "language": "pt", "phonemes": "pt-br"},
    {"id": "hf_alpha", "name": "Alpha · Hindi", "language": "hi", "phonemes": "hi"},
]
INPUT_LANGUAGES = ["auto", "en", "es", "fr", "de", "it", "pt", "nl", "hi", "ur", "ar", "ja", "ko", "zh", "ru", "tr", "pl"]


def strict_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate JSON field")
            result[key] = value
        return result

    value = json.loads(data, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Invalid number")))
    if not isinstance(value, dict):
        raise ValueError("JSON object required")
    return value


def synthesis_input(value):
    if set(value) != {"text", "voice", "language", "speed"}:
        raise ValueError("Expected text, voice, language and speed")
    text = value["text"]
    if not isinstance(text, str) or not text.strip() or len(text) > 6000 or "\0" in text:
        raise ValueError("Speech text must contain 1–6000 characters")
    voice = next((v for v in VOICES if v["id"] == value["voice"]), None)
    if not voice or value["language"] != voice["language"]:
        raise ValueError("Unsupported voice and output-language combination")
    speed = value["speed"]
    if isinstance(speed, bool) or not isinstance(speed, (float, int)) or not math.isfinite(speed) or not .7 <= speed <= 1.3:
        raise ValueError("Speech speed must be between 0.7 and 1.3")
    return text, voice, speed


def transcription_input(value):
    if set(value) != {"audio", "language"} or value["language"] not in INPUT_LANGUAGES:
        raise ValueError("Unsupported input language or recording fields")
    if not isinstance(value["audio"], str) or len(value["audio"]) > 4 * ((MAX_AUDIO + 2) // 3):
        raise ValueError("Recording exceeds 5 MiB")
    try:
        data = base64.b64decode(value["audio"], validate=True)
    except Exception as exc:
        raise ValueError("Invalid recording encoding") from exc
    if not data or len(data) > MAX_AUDIO:
        raise ValueError("Recording must contain 1 byte–5 MiB")
    # Restrict decoder entry to WAV or Chromium's WebM container.
    if not (data.startswith(b"\x1a\x45\xdf\xa3") or (data.startswith(b"RIFF") and data[8:12] == b"WAVE")):
        raise ValueError("Use WebM or WAV audio")
    return data, value["language"]


class SpeechEngine:
    def __init__(self, assets):
        self.assets = Path(assets).resolve()
        self.tts = None
        self.asr = None
        self.lock = threading.Lock()

    def health(self):
        ready = all((self.assets / p).is_file() for p in [
            "kokoro-v1.0.onnx", "voices-v1.0.bin", "whisper-small/model.bin",
            "whisper-small/config.json", "whisper-small/tokenizer.json", "whisper-small/vocabulary.txt",
        ])
        return {
            "available": True, "assetsReady": ready,
            "warmed": {"tts": self.tts is not None, "asr": self.asr is not None},
            "voices": [{k: v[k] for k in ["id", "name", "language"]} for v in VOICES],
            "inputLanguages": INPUT_LANGUAGES, "retention": "memory-only",
            "ttsProvider": "kokoro-onnx-cpu", "asrProvider": "faster-whisper-small-cpu-int8",
            "streaming": False,
            "notice": "Local files only. Audio is decoded in memory, never retained. Cancelled CPU work may finish before the next request can start.",
        }

    def synthesize(self, value):
        text, voice, speed = synthesis_input(value)
        if self.tts is None:
            from kokoro_onnx import Kokoro
            import onnxruntime as ort
            options = ort.SessionOptions()
            options.intra_op_num_threads = 4
            options.inter_op_num_threads = 1
            session = ort.InferenceSession(str(self.assets / "kokoro-v1.0.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
            self.tts = Kokoro.from_session(session, str(self.assets / "voices-v1.0.bin"))
        samples, rate = self.tts.create(text, voice=voice["id"], speed=speed, lang=voice["phonemes"])
        if len(samples) > rate * 600:
            raise ValueError("Speech output exceeds ten minutes")
        import soundfile
        out = io.BytesIO()
        soundfile.write(out, samples, rate, format="WAV", subtype="PCM_16")
        return out.getvalue()

    @staticmethod
    def decode(data):
        import av
        import numpy as np
        # Decode incrementally so a highly compressed recording cannot expand
        # beyond the duration limit before validation.
        chunks, total = [], 0
        with av.open(io.BytesIO(data), mode="r") as container:
            resampler = av.AudioResampler(format="fltp", layout="mono", rate=16000)
            for frame in container.decode(audio=0):
                for converted in resampler.resample(frame):
                    total += converted.samples
                    if total > 16000 * MAX_SECONDS:
                        raise ValueError("Recording exceeds 60 seconds")
                    chunks.append(converted.to_ndarray().reshape(-1))
            for converted in resampler.resample(None):
                total += converted.samples
                if total > 16000 * MAX_SECONDS:
                    raise ValueError("Recording exceeds 60 seconds")
                chunks.append(converted.to_ndarray().reshape(-1))
        if not total:
            raise ValueError("Recording contains no audio")
        waveform = np.concatenate(chunks).astype(np.float32)
        if not np.all(np.isfinite(waveform)):
            raise ValueError("Invalid audio samples")
        if float(np.sqrt(np.mean(waveform ** 2))) < 0.0001:
            raise ValueError("No audible speech detected")
        return waveform

    def transcribe(self, value):
        data, language = transcription_input(value)
        waveform = self.decode(data)
        if self.asr is None:
            from faster_whisper import WhisperModel
            self.asr = WhisperModel(str(self.assets / "whisper-small"), device="cpu", compute_type="int8", cpu_threads=6, local_files_only=True)
        segments, info = self.asr.transcribe(waveform, language=None if language == "auto" else language, beam_size=1, vad_filter=True, condition_on_previous_text=False)
        text = " ".join(segment.text.strip() for segment in segments).strip()
        if len(text) > 32000:
            raise ValueError("Transcript exceeds limit")
        return {"text": text, "language": info.language}


def handler_for(engine):
    class Handler(BaseHTTPRequestHandler):
        server_version = "SebbyLocalVoice/1"

        def log_message(self, *_):
            pass  # No text, recordings, request bodies or paths enter logs.

        def setup(self):
            super().setup()
            self.connection.settimeout(30)

        def allowed(self):
            return self.client_address[0] == "127.0.0.1" and "Origin" not in self.headers and self.headers.get("Host") in [f"127.0.0.1:{PORT}", f"localhost:{PORT}"]

        def respond(self, status, body, mime="application/json"):
            if isinstance(body, dict):
                body = json.dumps(body).encode()
            try:
                self.send_response(status)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass  # Request cancellation cannot publish a late result.

        def do_GET(self):
            if not self.allowed():
                return self.respond(403, {"error": "Only the local desktop client is allowed"})
            if self.path != "/health":
                return self.respond(404, {"error": "Unknown route"})
            self.respond(200, engine.health())

        def do_OPTIONS(self):
            self.respond(403, {"error": "Browser access is disabled"})

        def do_POST(self):
            if not self.allowed():
                return self.respond(403, {"error": "Only the local desktop client is allowed"})
            if self.path not in ["/synthesize", "/transcribe"]:
                return self.respond(404, {"error": "Unknown route"})
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json" or self.headers.get("Transfer-Encoding"):
                return self.respond(415, {"error": "Bounded JSON request required"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= MAX_BODY:
                    return self.respond(413, {"error": "Request exceeds limit"})
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise ValueError("Incomplete request")
                value = strict_json(raw)
                (synthesis_input if self.path == "/synthesize" else transcription_input)(value)
            except (ValueError, UnicodeError):
                return self.respond(400, {"error": "Invalid speech request or unsupported language/voice"})
            if not engine.health()["assetsReady"]:
                return self.respond(503, {"error": "Local voice models are missing. Run the explicit setup script."})
            if not engine.lock.acquire(blocking=False):
                return self.respond(409, {"error": "Local voice is busy; cancelled CPU work may still be draining"})
            try:
                if self.path == "/synthesize":
                    self.respond(200, engine.synthesize(value), "audio/wav")
                else:
                    self.respond(200, engine.transcribe(value))
            except ValueError:
                self.respond(400, {"error": "Invalid recording, no speech, or duration/output limit exceeded"})
            except Exception:
                self.respond(503, {"error": "Local speech failed. Check the model files and runtime. No cloud fallback was used."})
            finally:
                engine.lock.release()

    return Handler


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--assets", required=True)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), handler_for(SpeechEngine(args.assets)))
    server.daemon_threads = True
    print(f"Sebby local voice listening only on 127.0.0.1:{PORT}; no audio retention", flush=True)
    server.serve_forever()
