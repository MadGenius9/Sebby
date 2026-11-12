import test from "./platform-test.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { OrchestrationService } from "../electron/orchestration.mjs";
import { AgentRuntime } from "../electron/agent-runtime.mjs";
import { TaskStore } from "../electron/tasks.mjs";
import { TeamStore } from "../electron/team.mjs";
import { Workspace, Store } from "../electron/services.mjs";
import { SkillRegistry } from "../electron/skills.mjs";
const response = (text = "Real mocked response") => ({
  status: "completed",
  text,
  responseId: randomUUID(),
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  functionCalls: [],
  outputItems: [],
});
function definition(count = 2) {
  return {
    goal: "Develop an explicitly reviewed small app plan.",
    steps: Array.from({ length: count }, (_, i) => ({
      role: i ? "reviewer" : "planner",
      title: `Step ${i + 1}`,
      prompt: i ? "Review the preceding plan." : "Plan a small app.",
      contextOptions: {
        includeMemory: false,
        allowReadTools: false,
        allowEdits: false,
        filePaths: [],
      },
      limits: { maxCalls: 2, maxOutputTokens: 500, maxTotalTokens: 100000 },
    })),
    grantCeiling: {
      includeMemory: false,
      allowReadTools: false,
      allowEdits: false,
      skillIds: [],
      filePaths: [],
    },
    budget: { maxCalls: count * 2 + 1, maxTotalTokens: (count + 1) * 100000 },
    finalLimits: { maxOutputTokens: 500, maxTotalTokens: 100000 },
  };
}
async function fixture(t, overrides = {}) {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "sebby-orchestration-")),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "project");
  await fs.mkdir(root);
  const workspace = new Workspace();
  await workspace.select(root);
  const tasks = new TaskStore(directory),
    team = new TeamStore(directory),
    store = new Store(directory),
    skills = new SkillRegistry(directory);
  await Promise.all([tasks.load(), team.load(), store.load(), skills.load()]);
  const calls = [],
    approvals = [];
  const currentIdentity = {
    workspaceRoot: root,
    profileId: randomUUID(),
    profileRevision: "a".repeat(64),
    provider: "openai",
    model: "test-model",
  };
  const provider = {
    status: async () => ({ configured: true }),
    send: async (request) => {
      calls.push({ kind: "child", ...request });
      return response(
        calls.length % 2
          ? "Specialist evidence"
          : "Coordinator critique with limitations",
      );
    },
  };
  const runtime = new AgentRuntime({
    tasks,
    team,
    workspace,
    provider,
    store,
    skills,
    approve: async (detail) => {
      approvals.push(detail);
      return true;
    },
  });
  const adapters = {
    directory,
    tasks,
    runtime,
    getIdentity: async () => ({ ...currentIdentity }),
    approvePlan: async (detail) => {
      approvals.push(detail);
      return true;
    },
    approveFinalRequest: async (detail) => {
      approvals.push(detail);
      return true;
    },
    aggregateProvider: async (request) => {
      calls.push({ kind: "final", ...request });
      return response(
        "Final critique: verify the implementation before relying on it.",
      );
    },
    approveFinalAcceptance: async (detail) => {
      approvals.push(detail);
      return true;
    },
    ...overrides,
  };
  const service = new OrchestrationService(adapters);
  await service.load();
  return {
    service,
    directory,
    tasks,
    team,
    workspace,
    runtime,
    provider,
    calls,
    approvals,
    currentIdentity,
    adapters,
  };
}
async function create(f, count = 2) {
  const r = await f.service.create(definition(count));
  assert.equal(r.created, true);
  return r.plan;
}
async function child(f, p, { accept = true } = {}) {
  const started = await f.service.startNext({ planId: p.id, digest: p.digest });
  assert.equal(started.started, true);
  const waiting = await f.service.wait(p.id);
  assert.equal(waiting.phase, "awaiting-step-review");
  const c = waiting.children.at(-1);
  if (!accept) return waiting;
  const accepted = await f.service.acceptStep(
    { planId: p.id, taskId: c.taskId, resultDigest: c.resultDigest },
    { approveReview: async () => true },
  );
  assert.equal(accepted.reviewed, true);
  return accepted.plan;
}
test("real task/runtime/team sequential flow, accepted untrusted handoff, one final critique and distinct acceptance", async (t) => {
  const f = await fixture(t);
  let p = await create(f);
  assert.equal(f.calls.length, 0);
  p = await child(f, p);
  assert.equal(p.phase, "ready");
  assert.equal(p.children[0].accepted, true);
  assert.ok(p.children[0].member.name);
  p = await child(f, p);
  assert.equal(p.phase, "ready-final");
  assert.equal(f.calls.length, 4);
  assert.match(
    f.tasks.get(p.children[1].taskId).prompt,
    /UNTRUSTED ACCEPTED PRIOR-STEP EVIDENCE/,
  );
  assert.equal(f.tasks.get(p.children[0].taskId).status, "completed");
  assert.equal(
    f.team.get(p.children[0].member.id).name,
    p.children[0].member.name,
  );
  const started = await f.service.finalize({
    planId: p.id,
    aggregateDigest: p.aggregateDigest,
  });
  assert.equal(started.started, true);
  p = await f.service.wait(p.id);
  assert.equal(p.phase, "awaiting-final-review");
  assert.equal(f.calls.length, 5);
  assert.equal(f.calls.at(-1).kind, "final");
  assert.equal(f.calls.at(-1).identity.profileId, f.currentIdentity.profileId);
  assert.equal(f.calls.at(-1).tools, undefined);
  assert.equal(p.finalResult.usage.totalTokens, 15);
  assert.notEqual(p.phase, "completed");
  const accepted = await f.service.acceptFinal({
    planId: p.id,
    finalResultDigest: p.finalResult.sha256,
  });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.plan.phase, "completed");
  assert.equal(f.calls.length, 5);
});
test("scope ceilings and aggregate reservations reject widening before any child call", async (t) => {
  const f = await fixture(t);
  for (const change of [
    (d) => (d.steps[0].contextOptions.allowReadTools = true),
    (d) => {
      d.steps[0].contextOptions.allowEdits = true;
      d.grantCeiling.allowEdits = true;
    },
    (d) => (d.steps[0].contextOptions.filePaths = ["app.js"]),
    (d) => (d.steps[0].contextOptions.skillId = "unknown"),
    (d) => (d.budget.maxCalls = 3),
    (d) => (d.budget.maxTotalTokens = 2000),
    (d) => d.steps.push(...d.steps, ...d.steps),
    (d) => (d.steps[0].model = "renderer-override"),
  ]) {
    const d = definition();
    change(d);
    assert.equal((await f.service.create(d)).status, "failed");
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.tasks.list().length, 0);
});
test("native plan/child/final request denials never become implicit acceptance or extra calls", async (t) => {
  const denied = await fixture(t, { approvePlan: async () => false });
  assert.equal((await denied.service.create(definition())).created, false);
  assert.equal(denied.service.list().length, 0);
  const f = await fixture(t);
  let p = await create(f, 1);
  f.runtime.approve = async () => false;
  const start = await f.service.startNext({ planId: p.id, digest: p.digest });
  assert.equal(start.started, false);
  assert.equal(start.plan.phase, "ready");
  assert.equal(f.calls.length, 0);
  f.runtime.approve = async () => true;
  p = await child(f, start.plan, { accept: false });
  const c = p.children[0];
  const deniedReview = await f.service.acceptStep(
    { planId: p.id, taskId: c.taskId, resultDigest: c.resultDigest },
    { approveReview: async () => false },
  );
  assert.equal(deniedReview.reviewed, false);
  await assert.rejects(f.service.startNext({ planId: p.id, digest: p.digest }));
  p = (
    await f.service.acceptStep(
      { planId: p.id, taskId: c.taskId, resultDigest: c.resultDigest },
      { approveReview: async () => true },
    )
  ).plan;
  f.service.approveFinalRequest = async () => false;
  assert.equal(
    (
      await f.service.finalize({
        planId: p.id,
        aggregateDigest: p.aggregateDigest,
      })
    ).started,
    false,
  );
  assert.equal(f.calls.length, 2);
  assert.equal(f.service.get(p.id).phase, "ready-final");
});
test("renderer cannot spoof acceptance results/model/child IDs/digests", async (t) => {
  const f = await fixture(t);
  const p = await create(f, 1);
  await assert.rejects(
    f.service.startNext({ planId: p.id, digest: p.digest, model: "other" }),
  );
  await assert.rejects(
    f.service.startNext({ planId: p.id, digest: "b".repeat(64) }),
  );
  const waiting = await child(f, p, { accept: false });
  const c = waiting.children[0];
  await assert.rejects(
    f.service.acceptStep(
      {
        planId: p.id,
        taskId: c.taskId,
        resultDigest: c.resultDigest,
        approved: true,
      },
      { approveReview: async () => true },
    ),
  );
  assert.equal(f.service.get(p.id).phase, "awaiting-step-review");
  assert.equal(f.calls.length, 2);
});
test("identity drift before next child or final send stops plan with no paid request", async (t) => {
  const f = await fixture(t);
  const p = await create(f, 1);
  f.currentIdentity.profileRevision = "b".repeat(64);
  assert.equal(
    (await f.service.startNext({ planId: p.id, digest: p.digest })).status,
    "failed",
  );
  assert.equal(f.calls.length, 0);
  const g = await fixture(t);
  const ready = await child(g, await create(g, 1));
  g.service.approveFinalRequest = async () => {
    g.currentIdentity.model = "different";
    return true;
  };
  const result = await g.service.finalize({
    planId: ready.id,
    aggregateDigest: ready.aggregateDigest,
  });
  assert.equal(result.status, "failed");
  assert.equal(g.calls.length, 2);
});
test("accepted child result mutation prevents final aggregate without trusting renderer evidence", async (t) => {
  const f = await fixture(t);
  const p = await child(f, await create(f, 1));
  await f.tasks.update((records) => {
    records[0].result = records[0].result.replace(
      "Specialist evidence",
      "Changed evidence",
    );
    return null;
  });
  assert.equal(
    (
      await f.service.finalize({
        planId: p.id,
        aggregateDigest: p.aggregateDigest,
      })
    ).status,
    "failed",
  );
  assert.equal(f.calls.length, 2);
});
test("incomplete/tool-calling/missing-provenance final responses never become complete", async (t) => {
  for (const final of [
    { ...response(), status: "incomplete" },
    { ...response(), responseId: null },
    { ...response(), functionCalls: [{ name: "execute" }] },
  ]) {
    const f = await fixture(t, { aggregateProvider: async () => final });
    const p = await child(f, await create(f, 1));
    assert.equal(
      (
        await f.service.finalize({
          planId: p.id,
          aggregateDigest: p.aggregateDigest,
        })
      ).started,
      true,
    );
    const failed = await f.service.wait(p.id);
    assert.equal(failed.phase, "failed");
    assert.equal(failed.finalResult, null);
    await assert.rejects(
      f.service.finalize({ planId: p.id, aggregateDigest: p.aggregateDigest }),
    );
  }
});
test("cancellation during final native consent blocks eventual send permanently", async (t) => {
  let resolve;
  const f = await fixture(t, {
    approveFinalRequest: () => new Promise((r) => (resolve = r)),
  });
  const p = await child(f, await create(f, 1));
  const starting = f.service.finalize({
    planId: p.id,
    aggregateDigest: p.aggregateDigest,
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(f.service.isBusy, true);
  await f.service.cancel({ planId: p.id });
  resolve(true);
  assert.equal((await starting).status, "cancelled");
  assert.equal(f.calls.length, 2);
  assert.equal(f.service.get(p.id).phase, "cancelled");
});
test("cancel active final call drains adapter; no false final result from late completion", async (t) => {
  let finish;
  const f = await fixture(t, {
    aggregateProvider: () => new Promise((r) => (finish = r)),
  });
  const p = await child(f, await create(f, 1));
  await f.service.finalize({
    planId: p.id,
    aggregateDigest: p.aggregateDigest,
  });
  await f.service.cancel({ planId: p.id });
  assert.equal(f.service.isBusy, true);
  finish(response("Late response must not complete"));
  const result = await f.service.wait(p.id);
  assert.equal(result.phase, "cancelled");
  assert.equal(result.finalResult, null);
  assert.equal(f.service.isBusy, false);
});
test("restart interrupts all unfinished plans, no replay and strict corrupt-store preservation", async (t) => {
  const f = await fixture(t);
  const p = await create(f, 1);
  const fresh = new OrchestrationService(f.adapters);
  await fresh.load();
  assert.equal(fresh.get(p.id).phase, "interrupted");
  await assert.rejects(fresh.startNext({ planId: p.id, digest: p.digest }));
  assert.equal(f.calls.length, 0);
  const file = path.join(f.directory, "sebby-orchestration.json");
  const original = await fs.readFile(file, "utf8");
  await fs.writeFile(
    file,
    original.replace('"phase":"interrupted"', '"phase":"completed"'),
  );
  const bad = new OrchestrationService(f.adapters);
  await assert.rejects(bad.load(), /corrupt/);
  assert.match(await fs.readFile(file, "utf8"), /"phase":"completed"/);
});
test("symlink stores rejected and completion persists real provenance without credentials", async (t) => {
  const f = await fixture(t);
  let p = await child(f, await create(f, 1));
  await f.service.finalize({
    planId: p.id,
    aggregateDigest: p.aggregateDigest,
  });
  p = await f.service.wait(p.id);
  await f.service.acceptFinal({
    planId: p.id,
    finalResultDigest: p.finalResult.sha256,
  });
  const fresh = new OrchestrationService(f.adapters);
  await fresh.load();
  assert.equal(fresh.get(p.id).phase, "completed");
  const file = path.join(f.directory, "sebby-orchestration.json");
  const text = await fs.readFile(file, "utf8");
  assert.equal(text.includes("Authorization"), false);
  assert.equal(text.includes("apiKey"), false);
  assert.ok(text.includes(p.finalResult.responseId));
  await fs.rename(file, file + ".original");
  await fs.symlink(file + ".original", file);
  await assert.rejects(new OrchestrationService(f.adapters).load(), /corrupt/);
});
test("oversized accepted handoff is refused rather than truncated or silently summarized", async (t) => {
  const f = await fixture(t);
  f.provider.send = async () => response("x".repeat(6000));
  let p = await create(f, 2);
  p = await child(f, p);
  const next = await f.service.startNext({ planId: p.id, digest: p.digest });
  assert.equal(next.status, "failed");
  assert.equal(f.tasks.list().length, 1);
});

test("runtime adapter gets independently abortable guard before active runtime exists", async (t) => {
  const f = await fixture(t);
  let release, received;
  const p = await create(f, 1);
  f.service.runtime = {
    isActive: false,
    start: async (_input, guard) => {
      received = guard;
      await new Promise((r) => (release = r));
      guard.signal.throwIfAborted();
      throw Error("unreachable");
    },
    cancel: async () => {
      throw Error("No active runtime yet");
    },
    wait: async () => {},
  };
  const start = f.service.startNext({ planId: p.id, digest: p.digest });
  while (!release) await new Promise((r) => setImmediate(r));
  assert.deepEqual(received.identity, f.currentIdentity);
  await f.service.cancel({ planId: p.id });
  assert.equal(received.signal.aborted, true);
  release();
  assert.equal((await start).status, "cancelled");
  assert.equal(f.calls.length, 0);
});

test("cancellation observed during final-result persistence cannot leave an acceptable result", async (t) => {
  const f = await fixture(t);
  const p = await child(f, await create(f, 1));
  let cancelled = false;
  f.service.onEvent = (status) => {
    if (
      !cancelled &&
      status.plans.some(
        (x) => x.id === p.id && x.phase === "awaiting-final-review",
      )
    ) {
      cancelled = true;
      void f.service.cancel({ planId: p.id });
    }
  };
  await f.service.finalize({
    planId: p.id,
    aggregateDigest: p.aggregateDigest,
  });
  const stopped = await f.service.wait(p.id);
  assert.equal(stopped.phase, "cancelled");
  await assert.rejects(
    f.service.acceptFinal({
      planId: p.id,
      finalResultDigest: stopped.finalResult.sha256,
    }),
  );
});

test("store link is rejected before opening even without relying on O_NOFOLLOW", async (t) => {
  const f = await fixture(t);
  await create(f, 1);
  const file = path.join(f.directory, "sebby-orchestration.json");
  await fs.rename(file, file + ".target");
  await fs.symlink(file + ".target", file);
  const original = fs.open;
  let attempted = false;
  fs.open = async function (target, ...args) {
    if (target === file) attempted = true;
    return original.call(this, target, ...args);
  };
  try {
    await assert.rejects(
      new OrchestrationService(f.adapters).load(),
      /corrupt/,
    );
    assert.equal(attempted, false);
  } finally {
    fs.open = original;
  }
});
test("shutdown during final identity validation cannot persist a newly approved plan", async (t) => {
  const f = await fixture(t);
  let count = 0,
    release;
  f.service.getIdentity = async () => {
    if (++count === 2) await new Promise((r) => (release = r));
    return { ...f.currentIdentity };
  };
  const pending = f.service.create(definition(1));
  while (!release) await new Promise((r) => setImmediate(r));
  const closing = f.service.shutdown();
  release();
  assert.equal((await pending).status, "interrupted");
  await closing;
  assert.equal(f.service.list().length, 0);
});
