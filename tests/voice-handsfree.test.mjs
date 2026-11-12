import test from "node:test";
import assert from "node:assert/strict";
import { VoiceController } from "../electron/voice-controller.mjs";

function fixture(overrides = {}) {
  const approvals = [];
  const voice = new VoiceController({
    getContext: async () => ({
      provider: "ollama",
      profileId: "local-profile",
      model: "qwen3:8b",
    }),
    approveCapture: async (request) => {
      approvals.push(request);
      return true;
    },
    approveUpload: async () => {
      throw Error("No cloud upload consent may be requested");
    },
    localVoice: {
      status: async () => ({ available: true, inputLanguages: ["auto", "en"] }),
      transcriber: () => ({
        transcribe: async () => ({ status: "completed", text: "Hello Sebby" }),
        cancel() {},
        shutdown() {},
      }),
    },
    ...overrides,
  });
  return { voice, approvals };
}
const recording = (sessionId, patch = {}) => ({
  sessionId,
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: "audio/webm",
  durationMs: 1500,
  ...patch,
});

test("hands-free requires one explicit local-only session consent and binds profile/window", async (t) => {
  const { voice, approvals } = fixture();
  t.after(() => voice.shutdown());
  const run = await voice.startHandsFree({ language: "en" }, 4);
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].handsFree, true);
  assert.match(approvals[0].disclosure, /Hello Sebby/);
  assert.match(approvals[0].disclosure, /30 minutes/);
  assert.match(approvals[0].disclosure, /No cloud fallback/);
  assert.deepEqual(voice.requireHandsFree(run.sessionId, 4).context, {
    provider: "ollama",
    profileId: "local-profile",
    model: "qwen3:8b",
  });
  assert.throws(() => voice.requireHandsFree(run.sessionId, 5));
  assert.throws(() => voice.stopHandsFree("wrong", 4));
  assert.equal(voice.isBusy(), true);
  assert.equal(voice.isHandsFreeSession(run.sessionId), true);
  assert.equal(voice.canPlaySpeech(), true);
  await assert.rejects(
    voice.begin({ provider: "local", model: "whisper-small" }, 4),
  );
});

test("hands-free refuses cloud profiles, unsupported language and declined session without granting mic", async () => {
  for (const overrides of [
    {
      getContext: async () => ({ provider: "openai", profileId: "cloud" }),
    },
    { approveCapture: async () => false },
    {
      localVoice: {
        status: async () => ({ available: true, inputLanguages: [] }),
      },
    },
  ]) {
    const { voice } = fixture(overrides);
    await assert.rejects(voice.startHandsFree({ language: "en" }, 4));
    assert.equal(
      voice.consumePermission({ windowId: 4, audioOnly: true }),
      false,
    );
    assert.equal(voice.isBusy(), false);
    voice.shutdown();
  }
});

test("hands-free capture grant is audio-only, single-use and must be consumed before transcription", async (t) => {
  const { voice } = fixture();
  t.after(() => voice.shutdown());
  const { sessionId } = await voice.startHandsFree({ language: "auto" }, 8);
  await assert.rejects(voice.transcribeHandsFree(recording(sessionId), 8));
  assert.equal(
    voice.consumePermission({ windowId: 8, audioOnly: false }),
    false,
  );
  assert.equal(
    voice.consumePermission({ windowId: 9, audioOnly: true }),
    false,
  );
  assert.equal(voice.consumePermission({ windowId: 8, audioOnly: true }), true);
  assert.equal(
    voice.consumePermission({ windowId: 8, audioOnly: true }),
    false,
  );
  const input = recording(sessionId);
  assert.equal((await voice.transcribeHandsFree(input, 8)).text, "Hello Sebby");
  assert.deepEqual([...input.bytes], [0, 0, 0]);
});

test("bounded hands-free chunks reject extra authority, overlong audio and wrong window", async (t) => {
  const { voice } = fixture();
  t.after(() => voice.shutdown());
  const { sessionId } = await voice.startHandsFree({ language: "en" }, 4);
  voice.consumePermission({ windowId: 4, audioOnly: true });
  for (const patch of [
    { durationMs: 30001 },
    { durationMs: 0 },
    { bytes: new Uint8Array(5 * 1024 * 1024 + 1) },
    { mimeType: "application/octet-stream" },
    { provider: "openai" },
    { language: "fr" },
    { sessionId: "other" },
  ])
    await assert.rejects(
      voice.transcribeHandsFree(recording(sessionId, patch), 4),
    );
  await assert.rejects(voice.transcribeHandsFree(recording(sessionId), 5));
});

test("stop cancels active recognition, suppresses late result, drains busy state and revokes capture", async () => {
  let finish,
    cancelled = false;
  const { voice } = fixture({
    localVoice: {
      status: async () => ({ available: true, inputLanguages: ["en"] }),
      transcriber: () => ({
        transcribe: () => new Promise((resolve) => (finish = resolve)),
        cancel: () => (cancelled = true),
        shutdown() {},
      }),
    },
  });
  const { sessionId } = await voice.startHandsFree({ language: "en" }, 4);
  voice.consumePermission({ windowId: 4, audioOnly: true });
  const input = recording(sessionId);
  const pending = voice.transcribeHandsFree(input, 4);
  assert.equal(voice.canPlaySpeech(), false);
  await assert.rejects(voice.transcribeHandsFree(recording(sessionId), 4));
  voice.stopHandsFree(sessionId, 4);
  assert.equal(cancelled, true);
  assert.equal(voice.isBusy(), true);
  finish({ status: "completed", text: "late private transcript" });
  assert.deepEqual(await pending, { status: "cancelled" });
  assert.deepEqual([...input.bytes], [0, 0, 0]);
  assert.equal(voice.isBusy(), false);
  assert.equal(
    voice.consumePermission({ windowId: 4, audioOnly: true }),
    false,
  );
  voice.shutdown();
});

test("session expiry revokes authority and notifies renderer to release microphone tracks", async () => {
  let now = 1000;
  const expired = [];
  const { voice } = fixture({
    now: () => now,
    onHandsFreeExpired: (event) => expired.push(event.sessionId),
  });
  const { sessionId, expiresAt } = await voice.startHandsFree(
    { language: "en" },
    4,
  );
  assert.equal(expiresAt, 1000 + 30 * 60_000);
  now = expiresAt;
  assert.throws(() => voice.requireHandsFree(sessionId, 4), /expired/);
  assert.deepEqual(expired, [sessionId]);
  assert.equal(voice.isHandsFreeSession(), false);
  assert.equal(voice.isBusy(), false);
  voice.shutdown();
});

test("stopping pending session consent prevents a late native approval from enabling capture", async () => {
  let approve;
  const { voice } = fixture({
    approveCapture: () => new Promise((resolve) => (approve = resolve)),
  });
  const pending = voice.startHandsFree({ language: "en" }, 4);
  while (!approve) await new Promise((resolve) => setImmediate(resolve));
  voice.stopHandsFree("", 4);
  approve(true);
  await assert.rejects(pending, /cancelled/);
  assert.equal(voice.isHandsFreeSession(), false);
  assert.equal(
    voice.consumePermission({ windowId: 4, audioOnly: true }),
    false,
  );
  voice.shutdown();
});

test("shutdown during recognition suppresses result and prevents all session reuse", async () => {
  let finish,
    stopped = false;
  const { voice } = fixture({
    localVoice: {
      status: async () => ({ available: true, inputLanguages: ["en"] }),
      transcriber: () => ({
        transcribe: () => new Promise((resolve) => (finish = resolve)),
        cancel() {},
        shutdown: () => (stopped = true),
      }),
    },
  });
  const { sessionId } = await voice.startHandsFree({ language: "en" }, 4);
  voice.consumePermission({ windowId: 4, audioOnly: true });
  const pending = voice.transcribeHandsFree(recording(sessionId), 4);
  voice.shutdown();
  finish({ status: "completed", text: "must not return" });
  assert.deepEqual(await pending, { status: "cancelled" });
  assert.equal(stopped, true);
  await assert.rejects(voice.startHandsFree({ language: "en" }, 4));
  assert.throws(() => voice.requireHandsFree(sessionId, 4));
});
