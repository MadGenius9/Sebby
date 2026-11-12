import base64
import importlib.util
from pathlib import Path
import tempfile
import unittest
import wave
import io

spec = importlib.util.spec_from_file_location("sebby_voice", Path(__file__).with_name("server.py"))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class ContractTests(unittest.TestCase):
    def test_missing_models_are_not_reported_ready_or_downloaded(self):
        with tempfile.TemporaryDirectory() as folder:
            health = server.SpeechEngine(folder).health()
            self.assertFalse(health["assetsReady"])
            self.assertEqual(health["warmed"], {"tts": False, "asr": False})
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_voice_language_speed_and_unknown_fields(self):
        good = {"text": "Hello Sebby.", "voice": "bm_george", "language": "en", "speed": 1.0}
        self.assertEqual(server.synthesis_input(good)[1]["phonemes"], "en-gb")
        for patch in [{"speed": True}, {"speed": float("nan")}, {"speed": 3}, {"language": "ja"}, {"voice": "unknown"}, {"text": ""}, {"text": "x" * 6001}, {"url": "https://example.com"}]:
            with self.assertRaises(ValueError):
                server.synthesis_input({**good, **patch})

    def test_duplicate_json_and_non_objects_rejected(self):
        for data in ['{"text":"a","text":"b"}', '[]', '{"speed":NaN}']:
            with self.assertRaises(ValueError):
                server.strict_json(data)

    def test_audio_types_and_languages(self):
        audio = base64.b64encode(b"RIFF1234WAVEbytes").decode()
        self.assertEqual(server.transcription_input({"audio": audio, "language": "de"})[1], "de")
        for value in [{"audio": audio, "language": "wrong"}, {"audio": "!!!", "language": "auto"}, {"audio": base64.b64encode(b"not audio").decode(), "language": "en"}, {"audio": "", "language": "en"}, {"audio": audio, "language": "en", "path": "secret.wav"}]:
            with self.assertRaises(ValueError):
                server.transcription_input(value)

    def test_actual_decoder_rejects_silent_and_excess_duration(self):
        try:
            import av
            import numpy
        except ImportError:
            self.skipTest("Audio decoder dependencies require explicit local voice setup")
        for seconds, amplitude in [(1, 0), (61, 1000)]:
            audio = io.BytesIO()
            with wave.open(audio, "wb") as out:
                out.setnchannels(1)
                out.setsampwidth(2)
                out.setframerate(16000)
                out.writeframes(amplitude.to_bytes(2, "little", signed=True) * (16000 * seconds))
            with self.assertRaises(ValueError):
                server.SpeechEngine.decode(audio.getvalue())


if __name__ == "__main__":
    unittest.main()
