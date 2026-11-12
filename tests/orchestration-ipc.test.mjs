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
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "sebby-plan-ipc-")),
  );
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
      return options.consent !== false;
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
test("full coordinated IPC flow has actual child provenance, final paid critique and separate acceptance", async (t) => {
  const f = await fixture(t);
  let plan = (await f.handlers.get("create-orchestration")(definition())).plan;
  assert.equal(f.sends.length, 0);
  const started = await f.handlers.get("start-orchestration-step")({
    planId: plan.id,
    digest: plan.digest,
  });
  assert.equal(started.started, true);
  plan = await f.ai.orchestration.wait(plan.id);
  assert.equal(plan.phase, "awaiting-step-review");
  const child = plan.children[0];
  plan = (
    await f.handlers.get("accept-orchestration-step")({
      planId: plan.id,
      taskId: child.taskId,
      resultDigest: child.resultDigest,
    })
  ).plan;
  assert.equal(plan.phase, "ready-final");
  await f.handlers.get("finalize-orchestration")({
    planId: plan.id,
    aggregateDigest: plan.aggregateDigest,
  });
  plan = await f.ai.orchestration.wait(plan.id);
  assert.equal(plan.phase, "awaiting-final-review");
  assert.equal(f.sends.length, 3);
  assert.deepEqual(f.sends[2].tools, []);
  assert.equal(f.sends[2].model, "test-model");
  plan = (
    await f.handlers.get("accept-orchestration-final")({
      planId: plan.id,
      finalResultDigest: plan.finalResult.sha256,
    })
  ).plan;
  assert.equal(plan.phase, "completed");
  assert.ok(f.prompts.some(([title]) => title.includes("final paid")));
  assert.equal(f.tasks.get(child.taskId).status, "completed");
});
test("cancel while child provider status is pending blocks late native approval and all dispatch", async (t) => {
  const statusGate = deferred(),
    f = await fixture(t, { statusGate });
  const plan = (await f.handlers.get("create-orchestration")(definition()))
    .plan;
  const started = f.handlers.get("start-orchestration-step")({
    planId: plan.id,
    digest: plan.digest,
  });
  started.catch(() => {});
  while (!f.statuses) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.ai.isBusy(), true);
  assert.throws(() => f.handlers.get("start-chat")({}), /active AI/);
  assert.throws(
    () =>
      f.handlers.get("update-provider-profile")({
        id: f.profile.id,
        patch: { model: "other" },
      }),
    /active AI/,
  );
  const cancelled = f.handlers.get("cancel-orchestration")({ planId: plan.id });
  statusGate.resolve();
  await Promise.allSettled([started, cancelled]);
  assert.equal(f.sends.length, 0);
  assert.equal(
    f.prompts.filter(([title]) => title.includes("specialist work")).length,
    0,
  );
  assert.equal(f.ai.isBusy(), false);
});
test("profile change invalidates a reviewed plan and selected output budget is a hard ceiling", async (t) => {
  const f = await fixture(t);
  const oversized = definition();
  oversized.finalLimits.maxOutputTokens = 3000;
  await assert.rejects(
    async () => f.handlers.get("create-orchestration")(oversized),
    /profile limit/,
  );
  const plan = (await f.handlers.get("create-orchestration")(definition()))
    .plan;
  await f.handlers.get("update-provider-profile")({
    id: f.profile.id,
    patch: { model: "another-model" },
  });
  const result = await f.handlers.get("start-orchestration-step")({
    planId: plan.id,
    digest: plan.digest,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.started, false);
  assert.equal(f.sends.length, 0);
});
