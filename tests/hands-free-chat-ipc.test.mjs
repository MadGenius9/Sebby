import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installAI } from "../electron/ai-ipc.mjs";
import { ConversationStore } from "../electron/conversations.mjs";
import { Store } from "../electron/services.mjs";
import { SkillRegistry } from "../electron/skills.mjs";

test("hands-free IPC bypasses only per-turn local text approval, routes cancellation/status, and preserves ordinary approval", async (t) => {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "sebby-hf-ipc-")),
  );
  const conversations = new ConversationStore(directory),
    store = new Store(directory),
    skills = new SkillRegistry(directory);
  await Promise.all([conversations.load(), store.load(), skills.load()]);
  const handlers = new Map(),
    approvals = [],
    calls = [];
  let externalBusy = false,
    voiceChecks = 0;
  let profile;
  class Adapter {
    async status() {
      return { configured: true, provider: "ollama" };
    }
    async send(input) {
      calls.push(input);
      input.onEvent({ type: "request-dispatched" });
      return {
        status: "completed",
        responseId: "ipc-fixture",
        text: "Scoped local reply",
      };
    }
  }
  const ai = await installAI({
    directory,
    safeStorage: { isEncryptionAvailable: () => false },
    register: (name, fn) => handlers.set(name, fn),
    workspace: { root: null },
    store,
    features: { conversations, skills, tasks: {}, team: {} },
    confirm: async (...args) => {
      approvals.push(args);
      return true;
    },
    isExternalBusy: () => externalBusy,
    assertHandsFreeSession: async (id) => {
      assert.equal(id, "native-grant");
      voiceChecks++;
      return {
        consumed: true,
        context: {
          provider: "ollama",
          profileId: profile.id,
          model: profile.model,
        },
      };
    },
    adapters: { ollama: Adapter },
  });
  t.after(async () => {
    await ai.shutdown();
    await fs.rm(directory, { recursive: true, force: true });
  });
  profile = await ai.profiles.create({
    name: "Local fixture",
    provider: "ollama",
    model: "qwen3:8b",
  });
  await ai.profiles.select(profile.id);
  assert.equal(ai.voiceContext().model, "qwen3:8b");
  const grant = await handlers.get("begin-handsfree-chat")({});
  externalBusy = true; // The native-approved microphone reservation intentionally remains busy.
  assert.throws(() => handlers.get("start-chat")({}), /active AI/);
  assert.throws(
    () =>
      handlers.get("update-provider-profile")({
        id: profile.id,
        patch: { model: "other" },
      }),
    /active AI/,
  );
  const run = await handlers.get("start-handsfree-chat")({
    sessionId: grant.sessionId,
    voiceSessionId: "native-grant",
    text: "Wake phrase accepted locally",
  });
  await ai.handsFree.chat.wait(run.runId);
  assert.equal(handlers.get("chat-status")(run.runId).status, "completed");
  assert.deepEqual(handlers.get("cancel-chat")(run.runId), {
    cancelled: false,
  });
  assert.equal(voiceChecks, 4);
  assert.equal(approvals.length, 1);
  assert.equal(calls.length, 1);
  handlers.get("end-handsfree-chat")(grant.sessionId);
  externalBusy = false;
  const regular = await handlers.get("start-chat")({
    text: "Explicit typed turn",
    includeMemory: false,
    filePaths: [],
    skillIds: [],
  });
  await ai.chat.wait(regular.runId);
  assert.equal(approvals.length, 2);
  assert.match(approvals[1][0], /Run this local AI request/);
});
