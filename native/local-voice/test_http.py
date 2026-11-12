"""Exercise HTTP permission boundaries without models or recorded microphone data."""

import http.client
import importlib.util
import json
from pathlib import Path
import threading
import unittest

spec = importlib.util.spec_from_file_location("sebby_voice_http", Path(__file__).with_name("server.py"))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class StubEngine:
    def __init__(self):
        self.ready = True
        self.lock = threading.Lock()
        self.calls = []

    def health(self):
        return {"available": True, "assetsReady": self.ready}

    def synthesize(self, value):
        self.calls.append(("synthesize", value))
        return b"RIFF-test-WAVE"

    def transcribe(self, value):
        self.calls.append(("transcribe", value))
        return {"text": "Synthetic test phrase", "language": "en"}


class HttpBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.engine = StubEngine()
        self.http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.handler_for(self.engine))
        self.http.daemon_threads = True
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join(timeout=2)

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.http.server_port, timeout=3)
        values = {"Host": f"127.0.0.1:{server.PORT}"}
        if headers:
            values.update(headers)
        if isinstance(body, dict):
            body = json.dumps(body).encode()
            values.setdefault("Content-Type", "application/json")
        try:
            connection.request(method, path, body=body, headers=values)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    @staticmethod
    def speech():
        return {"text": "Hello Sebby.", "voice": "af_heart", "language": "en", "speed": 1}

    def test_browser_origin_foreign_host_and_preflight_are_rejected_without_inference(self):
        for headers in [{"Origin": "https://example.invalid"}, {"Origin": "null"}, {"Host": "attacker.invalid"}]:
            status, response_headers, _ = self.request("POST", "/synthesize", self.speech(), headers)
            self.assertEqual(status, 403)
            self.assertNotIn("Access-Control-Allow-Origin", response_headers)
        self.assertEqual(self.request("OPTIONS", "/synthesize")[0], 403)
        self.assertEqual(self.engine.calls, [])

    def test_health_does_not_infer_or_offer_path_install_or_remote_operations(self):
        status, headers, data = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(data)["assetsReady"])
        self.assertEqual(headers["Cache-Control"], "no-store")
        for method, path in [("GET", "/health?remote=true"), ("GET", "/models/download"), ("POST", "/install"), ("POST", "/read-file")]:
            self.assertEqual(self.request(method, path, self.speech() if method == "POST" else None)[0], 404)
        self.assertEqual(self.engine.calls, [])

    def test_content_type_body_bounds_and_bad_json_fail_before_inference(self):
        cases = [
            (json.dumps(self.speech()), {"Content-Type": "text/plain"}, 415),
            (b"", {"Content-Type": "application/json", "Content-Length": str(server.MAX_BODY + 1)}, 413),
            (b"{", {"Content-Type": "application/json"}, 400),
            (b'{"text":"a","text":"b"}', {"Content-Type": "application/json"}, 400),
        ]
        for body, headers, expected in cases:
            self.assertEqual(self.request("POST", "/synthesize", body, headers)[0], expected)
        self.assertEqual(self.engine.calls, [])

    def test_missing_models_and_busy_inference_do_not_queue_or_fallback(self):
        self.engine.ready = False
        self.assertEqual(self.request("POST", "/synthesize", self.speech())[0], 503)
        self.engine.ready = True
        self.engine.lock.acquire()
        try:
            self.assertEqual(self.request("POST", "/synthesize", self.speech())[0], 409)
        finally:
            self.engine.lock.release()
        self.assertEqual(self.engine.calls, [])

    def test_valid_audio_response_is_in_memory_and_non_cacheable(self):
        status, headers, data = self.request("POST", "/synthesize", self.speech())
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "audio/wav")
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(int(headers["Content-Length"]), len(data))
        self.assertEqual(self.engine.calls, [("synthesize", self.speech())])
        self.assertFalse(self.engine.lock.locked())


if __name__ == "__main__":
    unittest.main()
