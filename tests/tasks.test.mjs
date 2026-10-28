import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TaskStore } from "../electron/tasks.mjs";
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-tasks-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new TaskStore(directory);
  await store.load();
  return { store, directory };
}
const input = {
  title: "Review a file",
  prompt: "Review the selected file without modifying it.",
  role: "reviewer",
};
test("task lifecycle persists real state and validates transitions", async (t) => {
  const { store, directory } = await fixture(t);
  const task = await store.create(input);
  assert.equal(task.status, "queued");
  assert.equal(task.attempts, 0);
  await assert.rejects(store.transition(task.id, "completed"), /Cannot move/);
  await assert.rejects(store.remove(task.id), /Cancel/);
  await store.transition(task.id, "running");
  const done = await store.transition(task.id, "completed", {
    result: "Reviewed; no commands executed.",
  });
  assert.equal(done.attempts, 1);
  assert.equal(done.result, "Reviewed; no commands executed.");
  await assert.rejects(store.transition(task.id, "running"), /Cannot move/);
  const restored = new TaskStore(directory);
  await restored.load();
  assert.equal(restored.get(task.id).status, "completed");
  await restored.remove(task.id);
  assert.equal(restored.list().length, 0);
});
test("restart interrupts running tasks but never replays them", async (t) => {
  const { store, directory } = await fixture(t);
  const task = await store.create(input),
    queued = await store.create({ ...input, title: "Still queued" });
  await store.transition(task.id, "running");
  const restored = new TaskStore(directory);
  await restored.load();
  assert.equal(restored.get(task.id).status, "interrupted");
  assert.equal(restored.get(queued.id).status, "queued");
  assert.match(restored.get(task.id).logs.at(-1).message, /side effects/);
  await restored.transition(task.id, "queued");
  await restored.transition(task.id, "running");
  assert.equal(restored.get(task.id).attempts, 2);
  await restored.transition(task.id, "cancelled");
  assert.equal(restored.get(task.id).status, "cancelled");
});
test("task storage serializes writes and cloned reads do not mutate state", async (t) => {
  const { store } = await fixture(t);
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      store.create({ ...input, title: `Task ${i}` }),
    ),
  );
  assert.equal(store.list().length, 10);
  const records = store.list();
  records[0].title = "Mutated";
  assert.notEqual(store.list()[0].title, "Mutated");
  const id = records[0].id;
  for (let i = 0; i < 105; i++)
    await store.appendLog(id, { level: "info", message: `Log ${i}` });
  assert.equal(store.get(id).logs.length, 100);
  assert.equal(store.get(id).logs.at(-1).message, "Log 104");
});
test("invalid task payloads and corrupt store fail closed", async (t) => {
  const { store, directory } = await fixture(t);
  await assert.rejects(store.create({ ...input, role: "admin" }));
  await assert.rejects(store.create({ ...input, prompt: "x".repeat(16001) }));
  const task = await store.create(input);
  await assert.rejects(
    store.appendLog(task.id, { level: "fatal", message: "no" }),
  );
  await assert.rejects(
    store.transition(task.id, "running", { result: "not done" }),
  );
  const file = path.join(directory, "sebby-tasks.json");
  await fs.writeFile(file, "broken");
  const corrupt = new TaskStore(directory);
  await assert.rejects(corrupt.load(), /not overwritten/);
  assert.equal(await fs.readFile(file, "utf8"), "broken");
  assert.throws(() => corrupt.list(), /Load/);
});

test("researcher role is accepted as metadata without new privileges", async (t) => {
  const { store } = await fixture(t);
  const task = await store.create({ ...input, role: "researcher" });
  assert.equal(task.role, "researcher");
  assert.equal(task.status, "queued");
  assert.equal(task.attempts, 0);
});
