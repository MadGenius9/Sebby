import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installAI } from "../electron/ai-ipc.mjs";
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
async function fixture(t, { statusGate, consentGate, consent = true } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-ai-ipc-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const handlers = new Map(),
    sends = [],
    approvals = [];
  const features = {
    conversations: {},
    skills: {},
    tasks: {},
    team: {},
    conversationRemovalPending: false,
  };
  class Adapter {
    constructor({ credentials }) {
      this.credentials = credentials;
    }
    async status() {
      if (statusGate) await statusGate.promise;
      return { ...(await this.credentials.status()), provider: "openai" };
    }
    async send(input) {
      sends.push(input);
      return {
        status: "completed",
        responseId: "fixture-response",
        text: "OK",
        usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      };
    }
  }
  const ai = await installAI({
    directory,
    safeStorage: { isEncryptionAvailable: () => false },
    register: (name, fn) => handlers.set(name, fn),
    workspace: { root: null },
    store: {},
    features,
    confirm: async (...args) => {
      approvals.push(args);
      return consentGate ? consentGate.promise : consent;
    },
    env: { OPENAI_API_KEY: "SYNTHETIC_TEST_KEY_NOT_REAL" },
    adapters: { openai: Adapter, anthropic: Adapter, xai: Adapter },
  });
  const profile = ai.profiles.selected();
  await ai.profiles.update(profile.id, { model: "test-model" });
  return { ai, handlers, sends, approvals, features, id: profile.id };
}
test("connection test reserves settings and execution lock before credential status resolves", async (t) => {
  const statusGate = deferred();
  const f = await fixture(t, { statusGate });
  const pending = f.handlers.get("test-provider-profile")(f.id);
  assert.equal(f.ai.isBusy(), true);
  assert.throws(
    () => f.handlers.get("test-provider-profile")(f.id),
    /active AI/,
  );
  assert.throws(
    () =>
      f.handlers.get("update-provider-profile")({
        id: f.id,
        patch: { model: "changed" },
      }),
    /active AI/,
  );
  assert.throws(() => f.handlers.get("start-chat")({}), /active AI/);
  statusGate.resolve();
  assert.equal((await pending).status, "completed");
  assert.equal(f.sends.length, 1);
  assert.equal(f.sends[0].model, "test-model");
  assert.equal(f.ai.isBusy(), false);
});
test("cancel during connection consent prevents dispatch and releases lock", async (t) => {
  const consentGate = deferred();
  const f = await fixture(t, { consentGate });
  const pending = f.handlers.get("test-provider-profile")(f.id);
  while (!f.approvals.length) await new Promise((r) => setImmediate(r));
  f.handlers.get("cancel-provider-test")();
  consentGate.resolve(true);
  await assert.rejects(pending, /abort/i);
  assert.equal(f.sends.length, 0);
  assert.equal(f.ai.isBusy(), false);
});
test("shutdown drains pending connection consent and permanently prevents new paid work", async (t) => {
  const consentGate = deferred();
  const f = await fixture(t, { consentGate });
  const pending = f.handlers.get("test-provider-profile")(f.id);
  pending.catch(() => {});
  while (!f.approvals.length) await new Promise((r) => setImmediate(r));
  let settled = false;
  const shutdown = f.ai.shutdown().then(() => (settled = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(settled, false);
  assert.throws(
    () => f.handlers.get("test-provider-profile")(f.id),
    /active AI/,
  );
  consentGate.resolve(true);
  await shutdown;
  await assert.rejects(pending, /abort/i);
  assert.equal(f.sends.length, 0);
});
test("test denial and invalid profile release the lock without dispatch", async (t) => {
  const f = await fixture(t, { consent: false });
  await assert.rejects(f.handlers.get("test-provider-profile")("bad"));
  assert.equal(f.ai.isBusy(), false);
  assert.equal(
    (await f.handlers.get("test-provider-profile")(f.id)).status,
    "denied",
  );
  assert.equal(f.sends.length, 0);
  assert.equal(f.ai.isBusy(), false);
});

test("shutdown drains metadata mutation and refuses mutation not started before shutdown", async (t) => {
  const f = await fixture(t);
  const pending = f.handlers.get("update-provider-profile")({
    id: f.id,
    patch: { model: "changed" },
  });
  pending.catch(() => {});
  await f.ai.shutdown();
  await assert.rejects(pending, /closing/);
  assert.equal(f.ai.profiles.selected().model, "test-model");
  assert.throws(
    () => f.handlers.get("select-provider-profile")(f.id),
    /active AI/,
  );
});

test("pending conversation deletion prevents a new chat before any service work", async (t) => {
  const f = await fixture(t);
  f.features.conversationRemovalPending = true;
  assert.throws(
    () => f.handlers.get("start-chat")({}),
    /pending conversation removal/,
  );
  assert.equal(f.ai.chat.isActive, false);
  assert.equal(f.sends.length, 0);
});
