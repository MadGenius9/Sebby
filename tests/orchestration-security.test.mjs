import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { installAI } from "../electron/ai-ipc.mjs";
import { TaskStore } from "../electron/tasks.mjs";
import { TeamStore } from "../electron/team.mjs";
import { Workspace, Store } from "../electron/services.mjs";
import { SkillRegistry } from "../electron/skills.mjs";
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const definition = () => ({
  goal: "A bounded plan",
  steps: [
    {
      role: "planner",
      title: "Plan",
      prompt: "Plan a tiny app",
      contextOptions: {
        includeMemory: false,
        allowReadTools: false,
        allowEdits: false,
        filePaths: [],
      },
      limits: { maxCalls: 2, maxOutputTokens: 500, maxTotalTokens: 100000 },
    },
  ],
  grantCeiling: {
    includeMemory: false,
    allowReadTools: false,
    allowEdits: false,
    skillIds: [],
    filePaths: [],
  },
  budget: { maxCalls: 3, maxTotalTokens: 200000 },
  finalLimits: { maxOutputTokens: 500, maxTotalTokens: 100000 },
});
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-plan-ipc-"));
  const root = path.join(directory, "project");
  await fs.mkdir(root);
  const workspace = new Workspace();
  await workspace.select(root);
  const tasks = new TaskStore(directory),
    team = new TeamStore(directory),
    store = new Store(directory),
    skills = new SkillRegistry(directory);
  await Promise.all([tasks.load(), team.load(), store.load(), skills.load()]);
  const handlers = new Map(),
    sends = [],
    prompts = [];
  let statuses = 0;
  class Adapter {
    async status() {
      statuses++;
      if (options.statusGate) await options.statusGate.promise;
      return { configured: true, provider: "openai" };
    }
    async send(input) {
      sends.push(input);
      return {
        status: "completed",
        text: "Mocked evidence, not actual execution",
        responseId: randomUUID(),
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        functionCalls: [],
        outputItems: [],
      };
    }
  }
  const ai = await installAI({
    directory,
    workspace,
    store,
    features: { tasks, team, skills, conversations: {} },
    safeStorage: { isEncryptionAvailable: () => false },
    register: (name, fn) => handlers.set(name, fn),
    confirm: async (...args) => {
      prompts.push(args);
      return options.confirm
        ? options.confirm(...args)
        : options.consent !== false;
    },
    env: {},
    adapters: { openai: Adapter, anthropic: Adapter, xai: Adapter },
  });
  const profile = ai.profiles.selected();
  await ai.profiles.update(profile.id, { model: "test-model" });
  t.after(async () => {
    await ai.shutdown();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return {
    ai,
    handlers,
    sends,
    prompts,
    tasks,
    profile,
    get statuses() {
      return statuses;
    },
  };
}
test("independent: cancel during native specialist consent prevents a late paid request", async (t) => {
  const gate = deferred();
  let shown = false;
  const f = await fixture(t, {
    confirm: async (title) => {
      if (title.includes("specialist work")) {
        shown = true;
        return gate.promise;
      }
      return true;
    },
  });
  const plan = (await f.handlers.get("create-orchestration")(definition()))
    .plan;
  const starting = f.handlers.get("start-orchestration-step")({
    planId: plan.id,
    digest: plan.digest,
  });
  while (!shown) await new Promise((resolve) => setImmediate(resolve));
  await f.handlers.get("cancel-orchestration")({ planId: plan.id });
  gate.resolve(true);
  await starting;
  assert.equal(f.sends.length, 0);
  assert.equal(f.ai.orchestration.get(plan.id).phase, "cancelled");
});
test("independent: profile identity drift during pending status cannot silently switch destination", async (t) => {
  const statusGate = deferred(),
    f = await fixture(t, { statusGate });
  const plan = (await f.handlers.get("create-orchestration")(definition()))
    .plan;
  const starting = f.handlers.get("start-orchestration-step")({
    planId: plan.id,
    digest: plan.digest,
  });
  while (!f.statuses) await new Promise((resolve) => setImmediate(resolve));
  // Deliberately bypass IPC to simulate an internal mutation; identity guards must still stop it.
  await f.ai.profiles.update(f.profile.id, { model: "drifted-model" });
  statusGate.resolve();
  await starting;
  assert.equal(f.sends.length, 0);
  assert.equal(
    f.prompts.filter(([title]) => title.includes("specialist work")).length,
    0,
  );
  assert.equal(f.ai.orchestration.get(plan.id).phase, "failed");
});
