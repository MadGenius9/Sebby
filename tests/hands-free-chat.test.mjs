import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HandsFreeChatSession } from "../electron/hands-free-chat.mjs";
import { ConversationStore } from "../electron/conversations.mjs";
import { Store } from "../electron/services.mjs";
import { SkillRegistry } from "../electron/skills.mjs";

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
async function fixture(t, options = {}) {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "sebby-hf-chat-")),
  );
  const conversations = new ConversationStore(directory),
    store = new Store(directory),
    skills = new SkillRegistry(directory);
  await Promise.all([conversations.load(), store.load(), skills.load()]);
  let clock = 1000;
  const identity = {
    provider: "ollama",
    profileId: "local-profile",
    model: "qwen3:8b",
    workspaceRoot: null,
    revision: 0,
    maxOutputTokens: 2048,
  };
  const calls = [],
    approvals = [],
    voiceCalls = [];
  const session = new HandsFreeChatSession({
    getIdentity: () => ({ ...identity }),
    now: () => clock,
    assertVoiceSession: async (id) => {
      voiceCalls.push(id);
      if (options.voiceGate) await options.voiceGate.promise;
      return (
        options.voice ?? {
          consumed: true,
          context: {
            provider: "ollama",
            profileId: identity.profileId,
            model: identity.model,
          },
        }
      );
    },
    confirm: async (...args) => {
      approvals.push(args);
      return options.consentGate
        ? options.consentGate.promise
        : options.consent !== false;
    },
    provider: {
      status: async () => ({
        configured: true,
        provider: options.provider ?? "ollama",
      }),
      send: async (input) => {
        calls.push(input);
        input.onEvent({ type: "request-dispatched" });
        if (options.sendGate) await options.sendGate.promise;
        input.onEvent({ type: "text-delta", delta: "Local answer" });
        return {
          status: "completed",
          text: "Local answer",
          responseId: "local-fixture-response",
        };
      },
    },
    conversations,
    workspace: { root: null },
    store,
    skills,
  });
  t.after(async () => {
    await session.shutdown();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const begin = () => session.begin();
  const start = (grant, text = "Hello Sebby") =>
    session.start({
      sessionId: grant.sessionId,
      voiceSessionId: "native-voice-grant",
      text,
    });
  return {
    session,
    identity,
    calls,
    approvals,
    conversations,
    voiceCalls,
    begin,
    start,
    setClock: (value) => (clock = value),
  };
}

test("one native grant creates dedicated local history; later turns have no dialog and no privileged context", async (t) => {
  const f = await fixture(t),
    grant = await f.begin();
  assert.equal(grant.maxTurns, 60);
  assert.equal(grant.maxOutputTokens, 512);
  for (const text of ["First spoken turn", "Second spoken turn"]) {
    const run = await f.start(grant, text);
    assert.equal(run.conversationId, grant.conversationId);
    assert.equal((await f.session.chat.wait(run.runId)).status, "completed");
  }
  assert.equal(f.approvals.length, 1);
  assert.equal(f.voiceCalls.length, 8);
  assert.equal(f.calls.length, 2);
  for (const call of f.calls) {
    assert.equal(call.model, "qwen3:8b");
    assert.equal(call.maxOutputTokens, 512);
    assert.deepEqual(call.tools, []);
    assert.doesNotMatch(JSON.stringify(call.input), /untrusted-reference-only/);
  }
  assert.equal(f.calls[1].input.length, 3);
  assert.equal(f.conversations.get(grant.conversationId).messages.length, 4);
});

test("native denial and cancellation while consent is pending create no conversation or provider dispatch", async (t) => {
  const denied = await fixture(t, { consent: false });
  assert.deepEqual(await denied.begin(), { status: "denied" });
  assert.equal(denied.session.grant, null);
  const consentGate = deferred(),
    f = await fixture(t, { consentGate });
  const pending = f.begin();
  assert.equal(f.session.isBusy, true);
  f.session.end("");
  consentGate.resolve(true);
  await assert.rejects(pending, /cancelled/);
  assert.equal(f.session.grant, null);
  assert.equal(f.calls.length, 0);
});

test("cloud selection, duplicate setup, changed scope during consent and shutdown cannot produce a grant", async (t) => {
  const cloud = await fixture(t);
  cloud.identity.provider = "openai";
  await assert.rejects(cloud.begin(), /local Ollama/);
  assert.equal(cloud.approvals.length, 0);
  for (const closing of [false, true]) {
    const consentGate = deferred(),
      f = await fixture(t, { consentGate });
    const pending = f.begin();
    await assert.rejects(f.begin(), /existing/);
    if (closing) await f.session.shutdown();
    else f.identity.revision++;
    consentGate.resolve(true);
    await assert.rejects(pending, /cancelled|scope changed/);
    assert.equal(f.session.grant, null);
    assert.equal(f.approvals.length, 1);
    assert.equal(f.calls.length, 0);
  }
});

test("profile, model, workspace, revision and expiry changes invalidate the exact grant before dispatch", async (t) => {
  for (const key of [
    "profileId",
    "model",
    "workspaceRoot",
    "revision",
    "provider",
  ]) {
    const f = await fixture(t),
      grant = await f.begin();
    f.identity[key] = key === "revision" ? 1 : "changed";
    await assert.rejects(f.start(grant), /expired|changed/);
    assert.equal(f.calls.length, 0);
  }
  const f = await fixture(t),
    grant = await f.begin();
  f.setClock(grant.expiresAt);
  await assert.rejects(f.start(grant), /expired/);
  assert.equal(f.calls.length, 0);
});

test("unconsumed or mismatched native microphone grants fail closed", async (t) => {
  for (const voice of [
    null,
    {
      consumed: false,
      context: { provider: "ollama", profileId: "local-profile" },
    },
    {
      consumed: true,
      context: { provider: "openai", profileId: "local-profile" },
    },
    { consumed: true, context: { provider: "ollama", profileId: "other" } },
    {
      consumed: true,
      context: {
        provider: "ollama",
        profileId: "local-profile",
        model: "other",
      },
    },
  ]) {
    const f = await fixture(t, { voice: voice ?? {} }),
      grant = await f.begin();
    await assert.rejects(f.start(grant), /profiles do not match/);
    assert.equal(f.calls.length, 0);
  }
});

test("pending native validation reserves the turn and stopping it prevents late dispatch", async (t) => {
  const voiceGate = deferred(),
    f = await fixture(t, { voiceGate }),
    grant = await f.begin();
  const pending = f.start(grant);
  assert.equal(f.session.isBusy, true);
  await assert.rejects(f.start(grant), /busy/);
  f.session.end(grant.sessionId);
  voiceGate.resolve();
  await assert.rejects(pending, /expired/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.session.isBusy, false);
});

test("renderer cannot inject conversation IDs, context, tools or a different session", async (t) => {
  const f = await fixture(t),
    grant = await f.begin();
  const base = {
    sessionId: grant.sessionId,
    voiceSessionId: "native",
    text: "Hi",
  };
  for (const extra of [
    { conversationId: "other" },
    { includeMemory: true },
    { filePaths: ["secret"] },
    { tools: ["command"] },
    { model: "cloud" },
  ])
    await assert.rejects(f.session.start({ ...base, ...extra }), /Invalid/);
  await assert.rejects(
    f.session.start({ ...base, sessionId: "other" }),
    /invalid/,
  );
  assert.equal(f.calls.length, 0);
});

test("nonlocal provider status cannot fall back and ending active generation suppresses its late reply", async (t) => {
  const cloud = await fixture(t, { provider: "openai" }),
    cloudGrant = await cloud.begin();
  const blocked = await cloud.start(cloudGrant);
  assert.equal((await cloud.session.chat.wait(blocked.runId)).status, "error");
  assert.equal(cloud.calls.length, 0);
  const sendGate = deferred(),
    f = await fixture(t, { sendGate }),
    grant = await f.begin();
  const run = await f.start(grant);
  while (!f.calls.length) await new Promise((r) => setImmediate(r));
  f.session.end(grant.sessionId);
  sendGate.resolve();
  assert.equal((await f.session.chat.wait(run.runId)).status, "cancelled");
  assert.equal(
    f.conversations
      .get(grant.conversationId)
      .messages.some((m) => m.role === "assistant" && m.status === "complete"),
    false,
  );
});

test("sixty-turn cap is enforced without extending the original permission expiry", async (t) => {
  const f = await fixture(t),
    grant = await f.begin();
  for (let i = 0; i < 60; i++) {
    const run = await f.start(grant, `Turn ${i}`);
    assert.equal((await f.session.chat.wait(run.runId)).status, "completed");
  }
  await assert.rejects(f.start(grant), /60-turn/);
  assert.equal(f.calls.length, 60);
  assert.equal(f.session.grant.expiresAt, grant.expiresAt);
});
