import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { EventEmitter } from "node:events";
import { VoiceTranscriber, directVoiceTransport } from "../electron/voice.mjs";
import { VoiceController } from "../electron/voice-controller.mjs";
const fakeKey = "SYNTHETIC_VOICE_KEY_NOT_REAL";
const credentials = {
  status: async () => ({ configured: true }),
  getKey: async () => fakeKey,
};
const input = () => ({
  bytes: new Uint8Array([7, 8, 9]),
  mimeType: "audio/webm",
  durationMs: 1000,
  model: "test-audio",
});
const response = (data) => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: (async function* () {
    yield Buffer.from(JSON.stringify(data));
  })(),
});
test("voice direct transport has fixed official verified HTTPS endpoint and no redirect following", async (t) => {
  const original = https.request;
  t.after(() => (https.request = original));
  let requests = 0;
  const controller = new AbortController(),
    body = Buffer.from("synthetic audio");
  https.request = (url, options, callback) => {
    requests++;
    assert.equal(url, "https://api.openai.com/v1/audio/transcriptions");
    assert.equal(options.agent, false);
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.signal, controller.signal);
    assert.equal(options.headers.Authorization, `Bearer ${fakeKey}`);
    const request = new EventEmitter();
    request.end = (sent) => {
      assert.equal(sent, body);
      callback({
        statusCode: 307,
        headers: { location: "https://not-a-provider.invalid" },
      });
    };
    return request;
  };
  const result = await directVoiceTransport({
    body,
    contentType: "multipart/form-data; boundary=fixture",
    key: fakeKey,
    signal: controller.signal,
    url: "https://ignored.invalid",
  });
  assert.equal(result.status, 307);
  assert.equal(requests, 1);
});
test("voice abort during credential status prevents later upload consent and key access", async () => {
  let resolve,
    approvals = 0,
    keys = 0;
  const provider = new VoiceTranscriber({
    credentials: {
      status: () => new Promise((r) => (resolve = r)),
      getKey: () => {
        keys++;
        return fakeKey;
      },
    },
    approve: () => {
      approvals++;
      return true;
    },
    transport: () => {
      throw Error("unexpected");
    },
  });
  const pending = provider.transcribe(input());
  provider.cancel();
  resolve({ configured: true });
  assert.equal((await pending).status, "cancelled");
  assert.equal(approvals, 0);
  assert.equal(keys, 0);
});
test("voice transport errors are sanitized and multipart buffers cleared after failure", async () => {
  let buffer;
  const provider = new VoiceTranscriber({
    credentials,
    approve: async () => true,
    transport: async ({ body }) => {
      buffer = body;
      throw Error(fakeKey);
    },
  });
  const result = await provider.transcribe(input());
  assert.equal(result.status, "error");
  assert.equal(JSON.stringify(result).includes(fakeKey), false);
  assert.ok(buffer.every((byte) => byte === 0));
});
test("controller never accepts unconsumed microphone permission or cross-window upload", async () => {
  let uploads = 0;
  const controller = new VoiceController({
    getContext: () => ({
      provider: "openai",
      profileId: "fixture",
      credentials,
    }),
    approveCapture: async () => true,
    approveUpload: async () => {
      uploads++;
      return true;
    },
    transport: async () => response({ text: "draft" }),
  });
  const { captureId } = await controller.begin({ model: "test-audio" }, 3);
  controller.end(captureId, 3);
  const payload = input();
  delete payload.model;
  await assert.rejects(
    controller.transcribe({ ...payload, captureId }, 3),
    /expired or invalid/,
  );
  await assert.rejects(
    controller.transcribe({ ...payload, captureId }, 4),
    /session unavailable/,
  );
  assert.equal(uploads, 0);
  controller.shutdown();
});
test("accepted main IPC audio is zeroed even when native paid upload is denied", async () => {
  const controller = new VoiceController({
    getContext: () => ({
      provider: "openai",
      profileId: "fixture",
      credentials,
    }),
    approveCapture: async () => true,
    approveUpload: async () => false,
  });
  const { captureId } = await controller.begin({ model: "test-audio" }, 3);
  controller.consumePermission({ windowId: 3, audioOnly: true });
  controller.end(captureId, 3);
  const payload = input();
  delete payload.model;
  const result = await controller.transcribe({ ...payload, captureId }, 3);
  assert.equal(result.status, "denied");
  assert.ok(payload.bytes.every((byte) => byte === 0));
  controller.shutdown();
});
