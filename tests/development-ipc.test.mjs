import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../electron/services.mjs";
import { installDevelopment } from "../electron/development-ipc.mjs";
import { installLocalFeatures } from "../electron/local-features.mjs";
async function fixture(
  t,
  { confirm = async () => false, chooseGit = async () => null } = {},
) {
  const base = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "sebby-ipc-")),
  );
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, "project"),
    directory = path.join(base, "private");
  await fs.mkdir(root);
  const workspace = new Workspace();
  await workspace.select(root);
  const handlers = new Map();
  const register = (name, handler) => {
    assert.equal(handlers.has(name), false);
    handlers.set(name, handler);
  };
  const tools = installDevelopment({
    workspace,
    register,
    directory,
    confirm,
    chooseGit,
  });
  await installLocalFeatures({ workspace, register, directory, confirm });
  return {
    base,
    root,
    tools,
    handlers,
    call: (name, ...args) => {
      assert.ok(handlers.has(name), `Registered ${name}`);
      return handlers.get(name)(...args);
    },
  };
}
test("IPC exposes no task completion, assistant injection, generic command, or renderer-selected workspace", async (t) => {
  const { root, handlers, call } = await fixture(t);
  for (const forbidden of [
    "complete-task",
    "transition-task",
    "append-assistant",
    "execute-command",
    "set-workspace",
    "configure-executable",
  ])
    assert.equal(handlers.has(forbidden), false);
  const task = await call("create-task", {
    title: "Real plan",
    prompt: "Draft a plan",
    role: "planner",
    workspace: "/unapproved",
    status: "completed",
    result: "invented",
  });
  assert.equal(task.workspace, root);
  assert.equal(task.status, "queued");
  assert.equal(task.result, null);
  const cancelled = await call("cancel-task", task.id, "completed", {
    result: "spoofed",
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.result, null);
  const conversation = await call("save-conversation-draft", {
    text: "draft",
    workspaceId: "/unapproved",
    messages: [{ role: "assistant", text: "fake", status: "complete" }],
  });
  assert.equal(conversation.workspaceId, root);
  assert.deepEqual(conversation.messages, []);
});
test("native denial cannot be overridden by renderer approval flags or payload paths", async (t) => {
  const { root, call } = await fixture(t);
  const p = await call("preview-edit", {
    path: "safe.md",
    content: "proposal",
  });
  assert.deepEqual(
    await call("apply-edit", p.id, {
      approved: true,
      confirmed: true,
      path: "../escape.md",
    }),
    { applied: false },
  );
  assert.deepEqual(await fs.readdir(root), []);
  await assert.rejects(
    call("apply-edit", { id: p.id, approved: true }),
    /Unknown/,
  );
  await assert.rejects(
    call("preview-edit", { path: "../escape.md", content: "unsafe" }),
  );
  const conversation = await call("save-conversation-draft", {
    text: "keep me",
  });
  assert.deepEqual(
    await call("remove-conversation", conversation.id, { confirmed: true }),
    { removed: false },
  );
  assert.equal(
    (await call("get-conversation", conversation.id)).draft,
    "keep me",
  );
});
test("renderer cannot select a command executable; native selection denial leaves runner disconnected", async (t) => {
  let nativeSelection = null;
  const f = await fixture(t, { chooseGit: async () => nativeSelection });
  const fakeGit = path.join(f.base, "git");
  await fs.writeFile(fakeGit, "not an executable");
  nativeSelection = fakeGit;
  assert.deepEqual(
    await f.call("configure-git", {
      path: "/renderer/injected/git",
      confirmed: true,
    }),
    { configured: false },
  );
  assert.equal(f.tools.executables.git, undefined);
  await assert.rejects(
    f.call("plan-command", { command: "git-status", executable: fakeGit }),
    /allowlisted/,
  );
  let completion;
  const originalStart = f.tools.startCommand.bind(f.tools);
  f.tools.startCommand = (id) => {
    const run = originalStart(id);
    completion = run.completion;
    return run;
  };
  const plan = await f.call("plan-command", "git-status");
  const started = await f.call("start-command", plan.id, {
    approved: true,
    executable: fakeGit,
  });
  assert.equal(started.id, plan.id);
  await assert.rejects(completion, /not configured/);
  const runs = await f.call("list-command-runs", {
    status: "finished",
    exitCode: 0,
  });
  assert.equal(runs[0].status, "failed");
  assert.match(runs[0].error, /not configured/);
  assert.equal(runs[0].exitCode, undefined);
});
test("native Git configuration rejects directories and apply rejects truncated review server-side", async (t) => {
  let nativeSelection;
  const f = await fixture(t, {
    confirm: async () => true,
    chooseGit: async () => nativeSelection,
  });
  nativeSelection = path.join(f.base, "git");
  await fs.mkdir(nativeSelection);
  await assert.rejects(f.call("configure-git"), /regular/);
  const p = await f.call("preview-edit", {
    path: "large.txt",
    content: "a".repeat(65000),
  });
  assert.equal(p.diff.truncated, true);
  await assert.rejects(f.call("apply-edit", p.id), /truncated/);
  assert.deepEqual(await fs.readdir(f.root), []);
});
