import test from "node:test";
import assert from "node:assert/strict";
import { VoiceTranscriber, VOICE_LIMITS } from "../electron/voice.mjs";
import { VoiceController } from "../electron/voice-controller.mjs";
const credentials = {
  status: async () => ({ configured: true }),
  getKey: async () => "fake-voice-key",
};
const input = {
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: "audio/webm",
  durationMs: 1000,
  model: "gpt-transcribe",
};
function response(
  data = {
    text: "A draft",
    usage: {
      type: "tokens",
      input_tokens: 2,
      output_tokens: 3,
      total_tokens: 5,
    },
  },
) {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: (async function* () {
      yield Buffer.from(JSON.stringify(data));
    })(),
  };
}
test("explicit approval precedes key lookup/upload; multipart and normalized result", async () => {
  const order = [];
  const v = new VoiceTranscriber({
    credentials: {
      ...credentials,
      getKey: async () => {
        order.push("key");
        return "fake";
      },
    },
    approve: async () => {
      order.push("approve");
      return true;
    },
    transport: async ({ body, key, contentType }) => {
      order.push("upload");
      assert.equal(key, "fake");
      assert.match(contentType, /multipart/);
      assert.match(body.toString(), /name="model"\r\n\r\ngpt-transcribe/);
      return response();
    },
  });
  assert.deepEqual(await v.transcribe(input), {
    status: "completed",
    text: "A draft",
    usage: { type: "tokens", inputTokens: 2, outputTokens: 3, totalTokens: 5 },
  });
  assert.deepEqual(order, ["approve", "key", "upload"]);
  assert.equal(v.isBusy(), false);
});
test("denied approval never retrieves secret or uploads", async () => {
  const v = new VoiceTranscriber({
    credentials: {
      ...credentials,
      getKey: () => {
        throw Error("must not read");
      },
    },
    approve: async () => false,
    transport: () => {
      throw Error("must not upload");
    },
  });
  assert.equal((await v.transcribe(input)).status, "denied");
});
test("invalid MIME, limits and injected multipart model fail before approval", async () => {
  let approved = 0;
  const v = new VoiceTranscriber({
    credentials,
    approve: () => {
      approved++;
      return true;
    },
  });
  for (const patch of [
    { mimeType: "video/webm" },
    { durationMs: 60001 },
    { bytes: new Uint8Array(VOICE_LIMITS.maxBytes + 1) },
    { model: "x\r\nheader" },
  ])
    assert.equal((await v.transcribe({ ...input, ...patch })).status, "error");
  assert.equal(approved, 0);
});
test("errors never expose response bodies or key; redirects rejected", async () => {
  const v = new VoiceTranscriber({
    credentials,
    approve: async () => true,
    transport: async () => ({
      status: 302,
      headers: { location: "https://evil.invalid" },
      body: response().body,
    }),
  });
  assert.equal((await v.transcribe(input)).status, "error");
});
test("shutdown during approval cancels without upload", async () => {
  let grant;
  const v = new VoiceTranscriber({
    credentials,
    approve: () => new Promise((r) => (grant = r)),
    transport: () => {
      throw Error("must not upload");
    },
  });
  const promise = v.transcribe(input);
  await new Promise((r) => setImmediate(r));
  v.shutdown();
  grant(true);
  assert.equal((await promise).status, "cancelled");
});
test("controller binds window/profile, expires one-shot audio permission and revokes on end", async () => {
  let now = 0;
  const c = new VoiceController({
    getContext: () => ({ provider: "openai", profileId: "p", credentials }),
    approveCapture: async () => true,
    approveUpload: async () => true,
    transport: async () => response(),
    now: () => now,
  });
  const { captureId } = await c.begin({ model: "gpt-transcribe" }, 7);
  assert.equal(c.consumePermission({ windowId: 8, audioOnly: true }), false);
  assert.equal(c.consumePermission({ windowId: 7, audioOnly: false }), false);
  assert.equal(c.consumePermission({ windowId: 7, audioOnly: true }), true);
  assert.equal(c.checkPermission({ windowId: 7, audioOnly: true }), true);
  assert.equal(c.consumePermission({ windowId: 7, audioOnly: true }), false);
  c.end(captureId, 7);
  assert.equal(c.checkPermission({ windowId: 7, audioOnly: true }), false);
  assert.equal(
    (
      await c.transcribe(
        {
          bytes: input.bytes,
          mimeType: input.mimeType,
          durationMs: input.durationMs,
          captureId,
        },
        7,
      )
    ).text,
    "A draft",
  );
  c.cancel(captureId, 7);
  assert.equal(c.isBusy(), false);
  await c.begin({ model: "gpt-transcribe" }, 7);
  now = 10001;
  assert.equal(c.consumePermission({ windowId: 7, audioOnly: true }), false);
  c.shutdown();
});
test("controller reserves begin synchronously and shutdown invalidates pending consent", async () => {
  let resolve;
  const c = new VoiceController({
    getContext: () => ({ provider: "openai", credentials }),
    approveCapture: () => new Promise((r) => (resolve = r)),
  });
  const p = c.begin({ model: "gpt-transcribe" }, 1);
  await assert.rejects(c.begin({ model: "gpt-transcribe" }, 1));
  await new Promise((r) => setImmediate(r));
  c.shutdown();
  resolve(true);
  await assert.rejects(p);
  assert.equal(c.isBusy(), false);
});
test("cancel keeps busy while paid-consent promise drains, shutdown is permanent", async () => {
  let grant;
  const c = new VoiceController({
    getContext: () => ({ provider: "openai", credentials }),
    approveCapture: async () => true,
    approveUpload: () => new Promise((r) => (grant = r)),
    transport: () => {
      throw Error("must not upload");
    },
  });
  const { captureId } = await c.begin({ model: "gpt-transcribe" }, 1);
  c.consumePermission({ windowId: 1, audioOnly: true });
  c.end(captureId, 1);
  const p = c.transcribe(
    {
      captureId,
      bytes: input.bytes,
      mimeType: input.mimeType,
      durationMs: input.durationMs,
    },
    1,
  );
  await new Promise((r) => setImmediate(r));
  c.cancel(captureId, 1);
  assert.equal(c.isBusy(), true);
  await assert.rejects(c.begin({ model: "gpt-transcribe" }, 1));
  grant(true);
  assert.equal((await p).status, "cancelled");
  assert.equal(c.isBusy(), false);
  c.shutdown();
  await assert.rejects(c.begin({ model: "gpt-transcribe" }, 1));
});
