import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import {
  LocalVoiceClient,
  localVoiceTransport,
  LOCAL_VOICE_LIMITS,
} from "../electron/local-voice.mjs";
import { VoiceController } from "../electron/voice-controller.mjs";

const metadata = {
  available: true,
  assetsReady: true,
  voices: [{ id: "af_heart", name: "Heart", language: "en" }],
  inputLanguages: ["auto", "en", "es"],
};
function response(body, type = "application/json", statusCode = 200) {
  const stream = Readable.from([
    Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)),
  ]);
  stream.statusCode = statusCode;
  stream.headers = { "content-type": type };
  return stream;
}
function wav() {
  const bytes = Buffer.alloc(48);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(40, 4);
  bytes.write("WAVE", 8);
  return bytes;
}
const speech = () => ({
  text: "A real response supplied by the caller.",
  voice: "af_heart",
  language: "en",
  speed: 1,
});

test("local voice transport fixes loopback port/routes and never follows a redirect", async (t) => {
  const original = http.request;
  t.after(() => (http.request = original));
  let requests = 0;
  http.request = (options, callback) => {
    requests++;
    assert.equal(options.hostname, "127.0.0.1");
    assert.equal(options.port, 11435);
    assert.equal(options.path, "/synthesize");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.equal(options.headers.Authorization, undefined);
    const request = new EventEmitter();
    request.setTimeout = () => {};
    request.end = (body) => {
      assert.equal(JSON.parse(body).text, "Only this local request");
      callback(response({}, "application/json", 307));
    };
    return request;
  };
  const result = await localVoiceTransport("/synthesize", {
    text: "Only this local request",
  });
  assert.equal(result.statusCode, 307);
  result.destroy();
  assert.equal(requests, 1);
  assert.throws(() => localVoiceTransport("https://other.invalid", null));
  assert.equal(requests, 1);
});

test("local synthesis checks installed assets and exact voice/language before dispatch", async () => {
  const calls = [];
  const client = new LocalVoiceClient({
    transport: async (route, body) => {
      calls.push({ route, body });
      return route === "/health"
        ? response(metadata)
        : response(wav(), "audio/wav");
    },
  });
  const bytes = await client.synthesize(speech());
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(Buffer.from(bytes).toString("ascii", 0, 4), "RIFF");
  assert.deepEqual(
    calls.map((c) => c.route),
    ["/health", "/synthesize"],
  );
  assert.deepEqual(calls[1].body, speech());
  await assert.rejects(
    client.synthesize({ ...speech(), language: "es" }),
    /language/,
  );
  assert.equal(calls.filter((c) => c.route === "/synthesize").length, 1);
});

test("missing assets, remote redirect and malformed WAV never produce playable audio", async () => {
  for (const final of [
    response({}, "audio/wav", 302),
    response(Buffer.alloc(48), "audio/wav"),
    response(wav(), "application/json"),
    response(Buffer.alloc(LOCAL_VOICE_LIMITS.responseBytes + 1), "audio/wav"),
  ]) {
    const client = new LocalVoiceClient({
      transport: async (route) =>
        route === "/health" ? response(metadata) : final,
    });
    await assert.rejects(client.synthesize(speech()));
    assert.equal(final.destroyed, true);
  }
  const calls = [];
  const missing = new LocalVoiceClient({
    transport: async (route) => {
      calls.push(route);
      return response({ ...metadata, assetsReady: false });
    },
  });
  await assert.rejects(missing.synthesize(speech()), /assets are missing/);
  assert.deepEqual(calls, ["/health"]);
});

test("speech validation rejects oversized text, unknown options and invalid pacing before transport", async () => {
  let calls = 0;
  const client = new LocalVoiceClient({
    transport: async () => {
      calls++;
    },
  });
  for (const patch of [
    { text: "x".repeat(LOCAL_VOICE_LIMITS.textCharacters + 1) },
    { text: "\0" },
    { speed: Infinity },
    { speed: 0.1 },
    { language: "auto" },
    { voice: "../voice" },
    { url: "https://other.invalid" },
  ])
    await assert.rejects(client.synthesize({ ...speech(), ...patch }));
  assert.equal(calls, 0);
});

test("speech cancellation during pending health suppresses late audio and drains busy state", async () => {
  let release;
  const calls = [];
  const client = new LocalVoiceClient({
    transport: async (route) => {
      calls.push(route);
      return new Promise((resolve) => (release = resolve));
    },
  });
  const pending = client.synthesize(speech());
  await assert.rejects(client.synthesize(speech()), /busy/);
  client.cancelSpeech();
  release(response(metadata));
  await assert.rejects(pending);
  assert.deepEqual(calls, ["/health"]);
  assert.equal(client.speech, null);
  client.shutdown();
  await assert.rejects(client.synthesize(speech()), /unavailable/);
});

test("local transcription sends only memory audio and selected input language, then zeroes input", async () => {
  const calls = [];
  const client = new LocalVoiceClient({
    transport: async (route, body) => {
      calls.push({ route, body });
      return response(
        route === "/health" ? metadata : { text: "Hola", language: "es" },
      );
    },
  });
  const bytes = new Uint8Array([1, 2, 3]);
  const result = await client
    .transcriber("es")
    .transcribe({ bytes, mimeType: "audio/webm", durationMs: 900 });
  assert.deepEqual(result, {
    status: "completed",
    text: "Hola",
    language: "es",
  });
  assert.deepEqual(calls[1], {
    route: "/transcribe",
    body: { audio: "AQID", language: "es" },
  });
  assert.ok(bytes.every((value) => value === 0));
});

test("invalid audio and unavailable input language never dispatch transcription or cloud fallback", async () => {
  let requests = 0;
  const client = new LocalVoiceClient({
    transport: async () => {
      requests++;
      return response(metadata);
    },
  });
  for (const patch of [
    { mimeType: "video/webm" },
    { durationMs: 60001 },
    { bytes: new Uint8Array(LOCAL_VOICE_LIMITS.audioBytes + 1) },
  ]) {
    const result = await client.transcriber("en").transcribe({
      bytes: new Uint8Array([1]),
      mimeType: "audio/webm",
      durationMs: 10,
      ...patch,
    });
    assert.equal(result.status, "error");
    assert.match(result.error, /No cloud fallback/);
  }
  assert.equal(requests, 0);
  const unavailable = await client.transcriber("ja").transcribe({
    bytes: new Uint8Array([1]),
    mimeType: "audio/webm",
    durationMs: 10,
  });
  assert.equal(unavailable.status, "error");
  assert.equal(requests, 1);
});

test("transcription cancellation during pending health suppresses stale text and clears audio", async () => {
  let release;
  const calls = [];
  const client = new LocalVoiceClient({
    transport: async (route) => {
      calls.push(route);
      return new Promise((resolve) => (release = resolve));
    },
  });
  const transcriber = client.transcriber("en"),
    bytes = new Uint8Array([1]);
  const pending = transcriber.transcribe({
    bytes,
    mimeType: "audio/webm",
    durationMs: 10,
  });
  transcriber.cancel();
  release(response(metadata));
  assert.equal((await pending).status, "cancelled");
  assert.ok(bytes.every((value) => value === 0));
  assert.deepEqual(calls, ["/health"]);
});

test("only HTTP 409 exposes a local busy code, with no automatic retry or retained input audio", async () => {
  for (const status of [409, 400, 403, 500, 503]) {
    const calls = [];
    const client = new LocalVoiceClient({
      transport: async (route) => {
        calls.push(route);
        return route === "/health"
          ? response(metadata)
          : response(
              { error: "untrusted service details" },
              "application/json",
              status,
            );
      },
    });
    const bytes = new Uint8Array([1, 2, 3]);
    const result = await client.transcriber("en").transcribe({
      bytes,
      mimeType: "audio/webm",
      durationMs: 900,
    });
    assert.equal(result.status, "error");
    assert.equal(result.code, status === 409 ? "LOCAL_VOICE_BUSY" : undefined);
    assert.doesNotMatch(JSON.stringify(result), /untrusted service details/);
    assert.deepEqual(calls, ["/health", "/transcribe"]);
    assert.deepEqual([...bytes], [0, 0, 0]);
  }
});

test("cancellation wins over a late HTTP 409 and cannot trigger busy retries", async () => {
  let release;
  const client = new LocalVoiceClient({
    transport: async (route) =>
      route === "/health"
        ? response(metadata)
        : new Promise((resolve) => {
            release = resolve;
          }),
  });
  const transcriber = client.transcriber("en");
  const pending = transcriber.transcribe({
    bytes: new Uint8Array([1]),
    mimeType: "audio/webm",
    durationMs: 900,
  });
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  transcriber.cancel();
  release(response({}, "application/json", 409));
  const result = await pending;
  assert.equal(result.status, "cancelled");
  assert.equal(result.code, undefined);
});

test("local microphone grant is independent of cloud profile and remains one-shot/window-bound", async () => {
  const approvals = [],
    transcribed = [];
  const localVoice = {
    status: async () => ({ available: true, inputLanguages: ["en"] }),
    transcriber: (language) => ({
      transcribe: async (input) => {
        transcribed.push({ language, input });
        return { status: "completed", text: "Local draft" };
      },
    }),
  };
  const controller = new VoiceController({
    localVoice,
    getContext: () => {
      throw Error("Cloud context must not be read");
    },
    approveUpload: () => {
      throw Error("Cloud upload must not be offered");
    },
    approveCapture: async (details) => {
      approvals.push(details);
      return true;
    },
  });
  const { captureId } = await controller.begin(
    { model: "whisper-small", provider: "local", language: "en" },
    7,
  );
  assert.equal(approvals[0].provider, "local");
  assert.match(approvals[0].disclosure, /127.0.0.1:11435/);
  assert.equal(
    controller.consumePermission({ windowId: 8, audioOnly: true }),
    false,
  );
  assert.equal(
    controller.consumePermission({ windowId: 7, audioOnly: true }),
    true,
  );
  assert.equal(
    controller.consumePermission({ windowId: 7, audioOnly: true }),
    false,
  );
  controller.end(captureId, 7);
  const bytes = new Uint8Array([1, 2]);
  const result = await controller.transcribe(
    { captureId, bytes, mimeType: "audio/webm", durationMs: 10 },
    7,
  );
  assert.equal(result.text, "Local draft");
  assert.equal(transcribed[0].language, "en");
  assert.ok(bytes.every((value) => value === 0));
  controller.shutdown();
});

test("denied local capture and shutdown during availability check grant no microphone access", async () => {
  let release,
    approvals = 0;
  const controller = new VoiceController({
    localVoice: { status: () => new Promise((resolve) => (release = resolve)) },
    approveCapture: async () => {
      approvals++;
      return true;
    },
  });
  const pending = controller.begin(
    { model: "whisper-small", provider: "local", language: "en" },
    7,
  );
  controller.shutdown();
  release({ available: true, inputLanguages: ["en"] });
  await assert.rejects(pending);
  assert.equal(approvals, 0);
  assert.equal(
    controller.checkPermission({ windowId: 7, audioOnly: true }),
    false,
  );
  const denied = new VoiceController({
    localVoice: {
      status: async () => ({ available: true, inputLanguages: ["en"] }),
    },
    approveCapture: async () => false,
  });
  await assert.rejects(
    denied.begin(
      { model: "whisper-small", provider: "local", language: "en" },
      7,
    ),
    /declined/,
  );
  assert.equal(denied.isBusy(), false);
});
