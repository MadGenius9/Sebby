import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { TeamStore } from "../electron/team.mjs";
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-team-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new TeamStore(directory);
  await store.load();
  return { store, directory };
}
test("Sebby assigns distinct authored names and persistent role/job without fake activity", async (t) => {
  const { store, directory } = await fixture(t);
  const team = await Promise.all(
    ["planner", "coder", "reviewer", "researcher"].map((role) =>
      store.create({ role, job: `Help with ${role} work` }),
    ),
  );
  assert.deepEqual(
    team.map((x) => x.name),
    ["Mira", "Finn", "Sage", "Nova"],
  );
  for (const item of team) {
    assert.equal(item.status, "executor-not-connected");
    assert.equal(item.nameOrigin, "sebby-assigned");
    assert.equal(item.assignedTaskId, null);
  }
  const another = await store.create({
    role: "planner",
    job: "Second planning specialty",
  });
  assert.equal(another.name, "Elliot");
  const restored = new TeamStore(directory);
  await restored.load();
  assert.deepEqual(restored.list(), store.list());
  const copy = store.list();
  copy[0].name = "fake";
  assert.equal(store.list()[0].name, "Mira");
});
test("rename, task references and retirement never claim actual execution", async (t) => {
  const { store } = await fixture(t);
  const a = await store.create({
      role: "coder",
      job: "Implement approved work",
    }),
    b = await store.create({ role: "reviewer", job: "Review evidence" });
  assert.equal((await store.rename(a.id, "Casey")).nameOrigin, "user-renamed");
  await assert.rejects(store.rename(b.id, "casey"), /distinct/);
  const task = randomUUID();
  const assigned = await store.assignTask(a.id, task);
  assert.equal(assigned.assignedTaskId, task);
  assert.equal(assigned.status, "executor-not-connected");
  assert.equal((await store.assignTask(a.id, null)).assignedTaskId, null);
  const retired = await store.retire(a.id);
  assert.equal(retired.status, "retired");
  assert.equal(retired.assignedTaskId, null);
  await assert.rejects(store.assignTask(a.id, task), /retired/);
});
test("authority fields, invalid roles/names/jobs and malformed task ids rejected", async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(store.create({ role: "admin", job: "bad" }));
  await assert.rejects(
    store.create({ role: "coder", job: "do stuff", tools: ["shell"] }),
    /authority/,
  );
  await assert.rejects(store.create({ role: "planner", job: "" }));
  const item = await store.create({ role: "planner", job: "Plan" });
  await assert.rejects(store.rename(item.id, "x\nspoof"));
  await assert.rejects(store.assignTask(item.id, "../task"));
});
test("corrupt identity store preserves file and does not invent team", async (t) => {
  const { directory } = await fixture(t);
  const file = path.join(directory, "sebby-team.json");
  await fs.writeFile(
    file,
    '{"version":1,"team":[{"name":"Root","status":"working"}]}',
  );
  const store = new TeamStore(directory);
  await assert.rejects(store.load(), /not overwritten/);
  assert.match(await fs.readFile(file, "utf8"), /working/);
  assert.throws(() => store.list(), /Load/);
});
