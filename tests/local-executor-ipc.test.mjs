import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Workspace } from "../electron/services.mjs";
import { installLocalFeatures } from "../electron/local-features.mjs";
import { installLocalExecutor } from "../electron/local-executor-ipc.mjs";
async function fixture(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "sebby-utility-ipc-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const project = path.join(directory, "project");
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, "sample.ts"), "secret contents");
  const workspace = new Workspace();
  await workspace.select(project);
  const handlers = new Map();
  let approve = false;
  const confirmations = [];
  const confirm = async (title, detail) => {
    confirmations.push({ title, detail });
    return approve;
  };
  const register = (name, fn) => {
    assert.equal(handlers.has(name), false);
    handlers.set(name, fn);
  };
  const stores = await installLocalFeatures({
    directory,
    register,
    workspace,
    confirm,
  });
  const executor = installLocalExecutor({
    ...stores,
    workspace,
    register,
    confirm,
  });
  return {
    executor,
    stores,
    handlers,
    confirmations,
    setApproval: (value) => {
      approve = value;
    },
    call: (name, ...args) => handlers.get(name)(...args),
  };
}
test("utility IPC ignores forged approval/results and normal goals cannot masquerade as executable utilities", async (t) => {
  const f = await fixture(t);
  const goal = await f.call("create-task", {
    title: "Build everything",
    prompt: "Create an app",
    role: "planner",
    kind: "local-brief",
    status: "awaiting-review",
    result: "Forged completion",
    workspace: "/forged",
  });
  assert.equal(goal.kind, "ai");
  assert.equal(goal.status, "queued");
  assert.equal(goal.result, null);
  await assert.rejects(
    f.call("review-local-utility", goal.id, {
      approved: true,
      result: "all done",
    }),
    /authentic/,
  );
  assert.equal(f.confirmations.length, 0);
  await assert.rejects(
    f.call("start-local-utility", {
      kind: "project-brief",
      approved: true,
      result: "forged",
    }),
    /Unsupported/,
  );
  const denied = await f.call(
    "start-local-utility",
    { kind: "project-brief" },
    { approved: true },
  );
  assert.deepEqual(denied, { started: false });
  assert.equal(f.stores.tasks.list().length, 1);
  assert.equal(f.stores.tasks.get(goal.id).status, "queued");
  assert.equal(f.handlers.has("complete-task"), false);
  assert.equal(f.handlers.has("transition-task"), false);
});
test("only actual local report can be completed after a separate native review; renderer text never substitutes evidence", async (t) => {
  const f = await fixture(t);
  f.setApproval(true);
  const run = await f.call("start-local-utility", {
    kind: "workspace-inventory",
  });
  const actual = await f.executor.wait(run.runId);
  assert.equal(actual.status, "awaiting-review");
  assert.match(actual.result, /sample.ts/);
  assert.doesNotMatch(actual.result, /secret contents/);
  f.setApproval(false);
  const denied = await f.call("review-local-utility", actual.id, {
    approved: true,
    result: "FORGED SUCCESS",
  });
  assert.equal(denied.reviewed, false);
  assert.equal(f.stores.tasks.get(actual.id).status, "awaiting-review");
  assert.equal(f.stores.tasks.get(actual.id).result, actual.result);
  f.setApproval(true);
  const accepted = await f.call("review-local-utility", actual.id, {
    result: "FORGED SUCCESS",
  });
  assert.equal(accepted.reviewed, true);
  assert.equal(accepted.task.status, "completed");
  assert.equal(accepted.task.result, actual.result);
  assert.match(f.confirmations.at(-1).detail, /Report SHA-256: [a-f0-9]{64}/);
  assert.match(f.confirmations.at(-1).detail, /specific local utility only/);
  assert.equal(f.executor.isActive, false);
});
