import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HandsFreeChatSession } from "../electron/hands-free-chat.mjs";
import { ConversationStore } from "../electron/conversations.mjs";
import { Store } from "../electron/services.mjs";
import { SkillRegistry } from "../electron/skills.mjs";

test("revoking only microphone-session authority during provider preparation prevents later model dispatch", async (t) => {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "sebby-hf-critic-")),
  );
  const conversations = new ConversationStore(directory),
    store = new Store(directory),
    skills = new SkillRegistry(directory);
  await Promise.all([conversations.load(), store.load(), skills.load()]);
  let voiceActive = true,
    releaseStatus,
    dispatches = 0;
  const identity = {
    provider: "ollama",
    profileId: "local-profile",
    model: "qwen3:8b",
    workspaceRoot: null,
    revision: 0,
    maxOutputTokens: 1024,
  };
  const session = new HandsFreeChatSession({
    getIdentity: () => ({ ...identity }),
    assertVoiceSession: async () => {
      if (!voiceActive) throw Error("Microphone session was revoked");
      return {
        consumed: true,
        context: {
          provider: "ollama",
          profileId: identity.profileId,
          model: identity.model,
        },
      };
    },
    confirm: async () => true,
    provider: {
      status: () =>
        new Promise((resolve) => {
          releaseStatus = resolve;
        }),
      send: async (input) => {
        dispatches++;
        input.onEvent({ type: "request-dispatched" });
        return {
          status: "completed",
          text: "Must not dispatch after revocation",
          responseId: "fixture",
        };
      },
    },
    conversations,
    store,
    skills,
    workspace: { root: null },
  });
  t.after(async () => {
    await session.shutdown();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const grant = await session.begin();
  const run = await session.start({
    sessionId: grant.sessionId,
    voiceSessionId: "voice-session",
    text: "A local spoken request",
  });
  while (!releaseStatus) await new Promise((resolve) => setImmediate(resolve));
  voiceActive = false;
  releaseStatus({ configured: true, provider: "ollama" });
  const result = await session.chat.wait(run.runId);
  assert.equal(dispatches, 0);
  assert.notEqual(result.status, "completed");
  assert.equal(
    conversations
      .get(grant.conversationId)
      .messages.some((m) => m.role === "assistant" && m.status === "complete"),
    false,
  );
});

test("revoking microphone authority during local inference suppresses a late successful reply", async (t) => {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "sebby-hf-late-")),
  );
  const conversations = new ConversationStore(directory),
    store = new Store(directory),
    skills = new SkillRegistry(directory);
  await Promise.all([conversations.load(), store.load(), skills.load()]);
  let voiceActive = true,
    releaseReply,
    dispatches = 0;
  const identity = {
    provider: "ollama",
    profileId: "local-profile",
    model: "qwen3:8b",
    workspaceRoot: null,
    revision: 0,
    maxOutputTokens: 1024,
  };
  const session = new HandsFreeChatSession({
    getIdentity: () => ({ ...identity }),
    assertVoiceSession: async () => {
      if (!voiceActive) throw Error("Microphone session was revoked");
      return {
        consumed: true,
        context: {
          provider: "ollama",
          profileId: identity.profileId,
          model: identity.model,
        },
      };
    },
    confirm: async () => true,
    provider: {
      status: async () => ({ configured: true, provider: "ollama" }),
      send: async (input) => {
        dispatches++;
        input.onEvent({ type: "request-dispatched" });
        await new Promise((resolve) => {
          releaseReply = resolve;
        });
        return {
          status: "completed",
          text: "Late answer that must not be accepted",
          responseId: "fixture",
        };
      },
    },
    conversations,
    store,
    skills,
    workspace: { root: null },
  });
  t.after(async () => {
    await session.shutdown();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const grant = await session.begin();
  const run = await session.start({
    sessionId: grant.sessionId,
    voiceSessionId: "voice-session",
    text: "A spoken turn before revocation",
  });
  while (!releaseReply) await new Promise((resolve) => setImmediate(resolve));
  voiceActive = false;
  releaseReply();
  const result = await session.chat.wait(run.runId);
  assert.equal(dispatches, 1);
  assert.notEqual(result.status, "completed");
  const history = conversations.get(grant.conversationId);
  assert.equal(
    history.messages.some(
      (m) => m.role === "assistant" && m.status === "complete",
    ),
    false,
  );
  assert.equal(history.messages.filter((m) => m.role === "user").length, 1);
});
