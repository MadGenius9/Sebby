import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { TaskStore } from "../electron/tasks.mjs";
import { TeamStore } from "../electron/team.mjs";
import { Workspace } from "../electron/services.mjs";
import { LocalExecutor } from "../electron/local-executor.mjs";
async function fixture(t, approve = async () => true) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "sebby-local-exec-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const project = path.join(directory, "project");
  await fs.mkdir(project);
  await fs.writeFile(
    path.join(project, "hello.ts"),
    "private contents should not appear",
  );
  await fs.writeFile(path.join(project, "README.md"), "# Hello");
  await fs.writeFile(path.join(project, ".env"), "SECRET");
  const tasks = new TaskStore(directory),
    team = new TeamStore(directory),
    workspace = new Workspace();
  await tasks.load();
  await team.load();
  await workspace.select(project);
  const executor = new LocalExecutor({ tasks, team, workspace, approve });
  return { directory, project, tasks, team, workspace, executor };
}
test("approved inventory runs against actual files, remains awaiting-review, and never completes unrelated goals", async (t) => {
  const { executor, tasks, team, project } = await fixture(t);
  const arbitrary = await tasks.create({
    title: "Build my app",
    prompt: "Build everything",
    role: "researcher",
    workspace: project,
  });
  const member = await team.create({
    role: "researcher",
    job: "Inspect inventory",
  });
  const run = await executor.startNew({
    kind: "workspace-inventory",
    memberId: member.id,
  });
  assert.equal(run.started, true);
  const result = await executor.wait(run.runId);
  assert.equal(result.kind, "local-inventory");
  assert.equal(result.status, "awaiting-review");
  assert.match(result.result, /hello.ts/);
  assert.match(result.result, /Observed supported files: 2/);
  assert.ok(!result.result.includes("private contents"));
  assert.ok(!result.result.includes("SECRET"));
  assert.equal(tasks.get(arbitrary.id).status, "queued");
  assert.equal(team.get(member.id).assignedTaskId, result.id);
  assert.equal(team.get(member.id).status, "executor-not-connected");
  assert.equal(
    (await executor.review(result.id, { approveReview: async () => false }))
      .reviewed,
    false,
  );
  const reviewed = await executor.review(result.id, {
    approveReview: async (payload) => {
      assert.match(payload.result, /deterministic/);
      return true;
    },
  });
  assert.equal(reviewed.task.status, "completed");
  await assert.rejects(
    executor.review(arbitrary.id, { approveReview: async () => true }),
    /authentic/,
  );
});
test("denied approval creates no task and mismatched members are rejected", async (t) => {
  const { executor, tasks, team } = await fixture(t, async () => false);
  assert.deepEqual(await executor.startNew({ kind: "project-brief" }), {
    started: false,
  });
  assert.equal(tasks.list().length, 0);
  const member = await team.create({ role: "coder", job: "Coding" });
  await assert.rejects(
    executor.startNew({ kind: "workspace-inventory", memberId: member.id }),
    /matching/,
  );
  await assert.rejects(executor.startNew({ kind: "shell" }), /Choose/);
  assert.equal(executor.isActive, false);
});
test("project brief is explicitly an unfilled deterministic template", async (t) => {
  const { executor } = await fixture(t);
  const run = await executor.startNew({ kind: "project-brief" }),
    result = await executor.wait(run.runId);
  assert.equal(result.kind, "local-brief");
  assert.match(result.result, /Outcome: \[not inferred\]/);
  assert.match(result.result, /No network requests/);
  assert.equal(result.status, "awaiting-review");
});
test("active scan observes AbortSignal and finishes cancelled without a result", async (t) => {
  const { executor, workspace } = await fixture(t);
  const original = workspace.list.bind(workspace);
  let resolveStarted;
  const started = new Promise((resolve) => (resolveStarted = resolve));
  workspace.list = async ({ signal }) => {
    resolveStarted();
    await new Promise((resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
    });
    return original({ signal });
  };
  const run = await executor.startNew({ kind: "workspace-inventory" });
  await started;
  assert.equal(executor.isActive, true);
  const cancelled = await executor.cancel(run.task.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.result, null);
  assert.equal(executor.isActive, false);
});
test("workspace change after approval blocks execution and review remains durable across restart", async (t) => {
  const { executor, workspace, tasks, directory } = await fixture(t);
  executor.approve = async () => {
    workspace.root = null;
    return true;
  };
  await assert.rejects(
    executor.startNew({ kind: "workspace-inventory" }),
    /workspace changed/,
  );
  assert.equal(tasks.list().length, 0);
  await workspace.select(path.join(directory, "project"));
  executor.approve = async () => true;
  const run = await executor.startNew({ kind: "workspace-inventory" });
  await executor.wait(run.runId);
  const loaded = new TaskStore(directory);
  await loaded.load();
  assert.equal(loaded.get(run.task.id).status, "awaiting-review");
  assert.equal(loaded.get(run.task.id).attempts, 1);
});
test("Workspace.list rejects an already aborted signal", async (t) => {
  const { workspace } = await fixture(t);
  const controller = new AbortController();
  controller.abort(Error("cancel scan"));
  await assert.rejects(
    workspace.list({ signal: controller.signal }),
    /cancel scan/,
  );
});
