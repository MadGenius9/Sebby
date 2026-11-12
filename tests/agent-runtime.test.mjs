import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AgentRuntime } from "../electron/agent-runtime.mjs";
import { TaskStore } from "../electron/tasks.mjs";
import { TeamStore } from "../electron/team.mjs";
import { Workspace, Store } from "../electron/services.mjs";
import { SkillRegistry } from "../electron/skills.mjs";
import { DevelopmentTools, contentHash } from "../electron/development.mjs";
const response = (text, extra = {}) => ({
  status: "completed",
  text,
  responseId: `response-${text.length}`,
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  functionCalls: [],
  ...extra,
});
async function fixture(
  t,
  {
    send,
    approve = async () => true,
    editApprove = async () => true,
    role = "planner",
  } = {},
) {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "sebby-agent-")),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const project = path.join(directory, "project");
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, "app.js"), "old source");
  const workspace = new Workspace();
  await workspace.select(project);
  const tasks = new TaskStore(directory),
    team = new TeamStore(directory),
    store = new Store(directory),
    skills = new SkillRegistry(directory);
  await Promise.all([tasks.load(), team.load(), store.load(), skills.load()]);
  const task = await tasks.create({
      title: "Plan my app",
      prompt: "Explain a sensible first version and limitations.",
      role,
      workspace: project,
    }),
    member = await team.create({ role, job: "Work on approved goals" });
  await team.assignTask(member.id, task.id);
  const calls = [],
    provider = {
      status: async () => ({ configured: true }),
      send: async (input) => {
        calls.push(input);
        return send
          ? send(input, calls.length)
          : response(
              calls.length === 1
                ? "Specialist result"
                : "Coordinator critique: verify requirements.",
            );
      },
    };
  const development = new DevelopmentTools(workspace, {
    backupRoot: path.join(directory, "backups"),
    approve: editApprove,
  });
  const runtime = new AgentRuntime({
    tasks,
    team,
    workspace,
    provider,
    store,
    skills,
    development,
    approve,
  });
  return {
    directory,
    project,
    tasks,
    team,
    store,
    skills,
    workspace,
    development,
    task,
    member,
    runtime,
    calls,
  };
}
const start = (f) =>
  f.runtime.start({
    taskId: f.task.id,
    memberId: f.member.id,
    model: "explicit-test-model",
  });
test("named specialist and separate coordinator responses persist before native acceptance", async (t) => {
  const f = await fixture(t);
  const run = await start(f),
    result = await f.runtime.wait(run.runId);
  assert.equal(result.status, "awaiting-review");
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].tools.length, 0);
  assert.match(f.calls[1].instructions, /coordinator reviewer/);
  const evidence = JSON.parse(result.result);
  assert.equal(evidence.member.name, "Mira");
  assert.equal(evidence.usage.totalTokens, 30);
  assert.match(evidence.coordinator.text, /critique/);
  assert.equal(
    (await f.runtime.review(f.task.id, { approveReview: async () => false }))
      .reviewed,
    false,
  );
  assert.equal(
    (await f.runtime.review(f.task.id, { approveReview: async () => true }))
      .task.status,
    "completed",
  );
});
test("denied initial approval makes no provider request, and model/context/role remain bounded", async (t) => {
  const f = await fixture(t, { approve: async () => false });
  assert.deepEqual(await start(f), { started: false });
  assert.equal(f.calls.length, 0);
  assert.equal(f.tasks.get(f.task.id).status, "queued");
  await assert.rejects(
    f.runtime.start({ taskId: f.task.id, model: "", contextOptions: {} }),
    /model/i,
  );
  await assert.rejects(
    f.runtime.start({
      taskId: f.task.id,
      model: "test",
      contextOptions: { filePaths: ["../outside"] },
    }),
  );
  await assert.rejects(
    f.runtime.start({
      taskId: f.task.id,
      model: "test",
      contextOptions: { allowEdits: true },
    }),
    /coder/,
  );
});
test("actual selected memory, skill and files are assembled from trusted services and disclosed", async (t) => {
  let consent;
  const f = await fixture(t, {
    approve: async (payload) => {
      consent = payload;
      return true;
    },
  });
  await f.store.saveMemory(f.project, "Prefer small changes");
  const run = await f.runtime.start({
    taskId: f.task.id,
    memberId: f.member.id,
    model: "test",
    contextOptions: {
      includeMemory: true,
      skillId: "app-plan",
      filePaths: ["app.js"],
    },
  });
  await f.runtime.wait(run.runId);
  assert.equal(consent.context.memory, "Prefer small changes");
  assert.equal(consent.context.files[0].content, "old source");
  assert.equal(consent.context.skill.id, "app-plan");
  assert.match(f.calls[0].input[0].content, /untrusted/);
});
test("read tool contents require additional native consent; denied text never goes outbound", async (t) => {
  const f = await fixture(t, {
    send: async (input, n) =>
      n === 1
        ? response("", {
            functionCalls: [
              {
                callId: "c1",
                name: "read_file",
                arguments: '{"path":"app.js"}',
              },
            ],
          })
        : response(
            n === 2
              ? "Could not inspect denied file."
              : "Coordinator notes file was denied.",
          ),
    approve: async (p) => p.kind !== "agent-send-file",
  });
  const run = await f.runtime.start({
    taskId: f.task.id,
    model: "test",
    contextOptions: { allowReadTools: true },
  });
  const result = await f.runtime.wait(run.runId);
  assert.equal(result.status, "awaiting-review");
  assert.ok(!JSON.stringify(f.calls[1].input).includes("old source"));
  assert.match(JSON.stringify(f.calls[1].input), /denied/);
});
test("unapproved tools, traversal and incomplete outputs never execute side effects", async (t) => {
  const f = await fixture(t, {
    send: async (input, n) =>
      n === 1
        ? response("", {
            functionCalls: [
              {
                callId: "c1",
                name: "read_file",
                arguments: '{"path":"../outside"}',
              },
              { callId: "c2", name: "shell", arguments: "{}" },
            ],
          })
        : response(
            n === 2 ? "Cannot do that." : "Coordinator confirms refusals.",
          ),
  });
  const run = await f.runtime.start({
    taskId: f.task.id,
    model: "test",
    contextOptions: { allowReadTools: true },
  });
  assert.equal((await f.runtime.wait(run.runId)).status, "awaiting-review");
  assert.match(JSON.stringify(f.calls[1].input), /rejected/);
  const second = await fixture(t, {
    send: async () =>
      response("partial", {
        status: "incomplete",
        functionCalls: [
          { callId: "bad", name: "propose_edit", arguments: "{}" },
        ],
      }),
  });
  const r = await start(second);
  assert.equal((await second.runtime.wait(r.runId)).status, "failed");
  assert.equal(second.calls.length, 1);
});
test("cumulative conservative budget stops before paid transport and step limit cannot loop forever", async (t) => {
  const f = await fixture(t);
  const run = await f.runtime.start({
    taskId: f.task.id,
    model: "test",
    limits: { maxTotalTokens: 1000 },
  });
  assert.equal((await f.runtime.wait(run.runId)).status, "failed");
  assert.equal(f.calls.length, 0);
  const looping = await fixture(t, {
    send: async (input, n) =>
      response("", {
        functionCalls: [
          { callId: `call-${n}`, name: "list_files", arguments: "{}" },
        ],
      }),
  });
  const r = await looping.runtime.start({
    taskId: looping.task.id,
    model: "test",
    limits: { maxCalls: 3 },
    contextOptions: { allowReadTools: true },
  });
  assert.equal((await looping.runtime.wait(r.runId)).status, "failed");
  assert.equal(looping.calls.length, 2);
});
test("cancellation reaches provider signal and task never completes", async (t) => {
  let entered;
  const waiting = new Promise((resolve) => (entered = resolve));
  const f = await fixture(t, {
    send: async ({ signal }) => {
      entered();
      return new Promise((resolve) =>
        signal.addEventListener(
          "abort",
          () => resolve({ status: "cancelled" }),
          { once: true },
        ),
      );
    },
  });
  const run = await start(f);
  await waiting;
  const cancelled = await f.runtime.cancel(f.task.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(f.runtime.isActive, false);
  assert.equal((await f.runtime.wait(run.runId)).result, null);
});
test("cancel while native edit approval is pending prevents filesystem write", async (t) => {
  let entered, resolveApproval;
  const waiting = new Promise((resolve) => (entered = resolve));
  const f = await fixture(t, {
    role: "coder",
    send: async () =>
      response("", {
        functionCalls: [
          {
            callId: "edit1",
            name: "propose_edit",
            arguments: JSON.stringify({
              path: "app.js",
              content: "new source",
              expectedHash: contentHash("old source"),
            }),
          },
        ],
      }),
    editApprove: async () => {
      entered();
      return new Promise((resolve) => (resolveApproval = resolve));
    },
  });
  const run = await f.runtime.start({
    taskId: f.task.id,
    memberId: f.member.id,
    model: "test",
    contextOptions: { allowEdits: true },
  });
  await waiting;
  const cancellation = f.runtime.cancel(f.task.id);
  resolveApproval(true);
  assert.equal((await cancellation).status, "cancelled");
  assert.equal(
    await fs.readFile(path.join(f.project, "app.js"), "utf8"),
    "old source",
  );
  await f.runtime.wait(run.runId);
});
test("native approved edit actually changes fixture and coordinator sees evidence", async (t) => {
  const f = await fixture(t, {
    role: "coder",
    send: async (input, n) =>
      n === 1
        ? response("", {
            functionCalls: [
              {
                callId: "edit1",
                name: "propose_edit",
                arguments: JSON.stringify({
                  path: "app.js",
                  content: "new source",
                  expectedHash: contentHash("old source"),
                }),
              },
            ],
          })
        : response(
            n === 2
              ? "Applied approved change; no tests run."
              : "Coordinator: change applied, tests remain unrun.",
          ),
  });
  const run = await f.runtime.start({
    taskId: f.task.id,
    model: "test",
    contextOptions: { allowEdits: true },
  });
  const result = await f.runtime.wait(run.runId);
  assert.equal(result.status, "awaiting-review");
  assert.equal(
    await fs.readFile(path.join(f.project, "app.js"), "utf8"),
    "new source",
  );
  assert.equal(JSON.parse(result.result).evidence[0].applied, true);
  assert.match(JSON.stringify(f.calls[2].input), /applied/);
});

test("provider continuation items stay in memory and never enter task evidence", async (t) => {
  const opaque = "encrypted-reasoning-never-persist";
  const call = {
    type: "function_call",
    call_id: "c1",
    name: "list_files",
    arguments: "{}",
  };
  const f = await fixture(t, {
    send: async (input, n) =>
      n === 1
        ? response("", {
            functionCalls: [
              { callId: "c1", name: "list_files", arguments: "{}" },
            ],
            outputItems: [
              {
                type: "reasoning",
                id: "r1",
                summary: [],
                encrypted_content: opaque,
              },
              call,
            ],
          })
        : response(
            n === 2
              ? "Inventory inspected."
              : "Coordinator reviewed inventory.",
          ),
  });
  const run = await f.runtime.start({
    taskId: f.task.id,
    model: "test",
    contextOptions: { allowReadTools: true },
  });
  const result = await f.runtime.wait(run.runId);
  assert.equal(result.status, "awaiting-review");
  assert.ok(JSON.stringify(f.calls[1].input).includes(opaque));
  assert.equal(
    f.calls[1].input.filter((item) => item.type === "function_call").length,
    1,
  );
  assert.ok(!JSON.stringify(result).includes(opaque));
  assert.ok(
    !(
      await fs.readFile(path.join(f.directory, "sebby-tasks.json"), "utf8")
    ).includes(opaque),
  );
});

test("omitted member creates a named local identity before approval and only assigns after consent", async (t) => {
  let disclosed;
  const f = await fixture(t, {
    approve: async (details) => {
      disclosed = details;
      return false;
    },
  });
  await f.team.assignTask(f.member.id, null);
  const denied = await f.runtime.start({ taskId: f.task.id, model: "test" });
  assert.equal(denied.started, false);
  assert.equal(disclosed.member.name, "Elliot");
  const identity = f.team.get(disclosed.member.id);
  assert.equal(identity.nameOrigin, "sebby-assigned");
  assert.equal(identity.assignedTaskId, null);
  assert.equal(f.calls.length, 0);
  f.runtime.approve = async () => true;
  const run = await f.runtime.start({ taskId: f.task.id, model: "test" });
  const result = await f.runtime.wait(run.runId);
  assert.equal(JSON.parse(result.result).member.name, "Elliot");
  assert.equal(f.team.get(identity.id).assignedTaskId, f.task.id);
});

test("reported usage from incomplete response remains in sanitized durable logs", async (t) => {
  const f = await fixture(t, {
    send: async () =>
      response("untrusted raw response", {
        status: "incomplete",
        usage: { inputTokens: 40, outputTokens: 10, totalTokens: 50 },
      }),
  });
  const run = await start(f);
  const result = await f.runtime.wait(run.runId);
  assert.equal(result.status, "failed");
  assert.match(
    JSON.stringify(result.logs),
    /Known reported cumulative tokens: 50/,
  );
  assert.ok(!JSON.stringify(result.logs).includes("untrusted raw response"));
  assert.equal(result.result, null);
});

test("unconfigured provider fails before approval and leaves task queued", async (t) => {
  let approvals = 0;
  const f = await fixture(t, {
    approve: async () => {
      approvals++;
      return true;
    },
  });
  f.runtime.provider.status = async () => ({ configured: false });
  await assert.rejects(start(f), /not configured/);
  assert.equal(approvals, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(f.tasks.get(f.task.id).status, "queued");
  assert.equal(f.runtime.isActive, false);
});

test("shutdown during delayed provider status permanently blocks later consent and task start", async (t) => {
  const f = await fixture(t);
  let resolveStatus, entered;
  const pending = new Promise((resolve) => (entered = resolve));
  f.runtime.provider.status = async () => {
    entered();
    return new Promise((resolve) => (resolveStatus = resolve));
  };
  let consent = 0;
  f.runtime.approve = async () => {
    consent++;
    return true;
  };
  const starting = start(f);
  await pending;
  const rejection = assert.rejects(starting, /shut down/);
  const stopping = f.runtime.shutdown();
  resolveStatus({ configured: true });
  await rejection;
  await stopping;
  assert.equal(consent, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(f.tasks.get(f.task.id).status, "queued");
  await assert.rejects(start(f), /shut down/);
});
test("shutdown blocks completion after a pending native result review accepts", async (t) => {
  const f = await fixture(t),
    run = await start(f);
  await f.runtime.wait(run.runId);
  let resolveReview, entered;
  const pending = new Promise((resolve) => (entered = resolve));
  const reviewing = f.runtime.review(f.task.id, {
    approveReview: async () => {
      entered();
      return new Promise((resolve) => (resolveReview = resolve));
    },
  });
  await pending;
  const rejection = assert.rejects(reviewing, /shut down/);
  await f.runtime.shutdown();
  resolveReview(true);
  await rejection;
  assert.equal(f.tasks.get(f.task.id).status, "awaiting-review");
  await assert.rejects(
    f.runtime.review(f.task.id, { approveReview: async () => true }),
    /shut down/,
  );
});

test("shutdown during delayed team creation cannot later prompt or send", async (t) => {
  const f = await fixture(t);
  await f.team.assignTask(f.member.id, null);
  const original = f.team.create.bind(f.team);
  let resume, entered;
  const pending = new Promise((resolve) => (entered = resolve));
  f.team.create = async (input) => {
    entered();
    await new Promise((resolve) => (resume = resolve));
    return original(input);
  };
  let approvals = 0;
  f.runtime.approve = async () => {
    approvals++;
    return true;
  };
  const starting = f.runtime.start({ taskId: f.task.id, model: "test" });
  await pending;
  const rejection = assert.rejects(starting, /shut down/);
  const stopping = f.runtime.shutdown();
  resume();
  await rejection;
  await stopping;
  assert.equal(approvals, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(f.tasks.get(f.task.id).status, "queued");
});
