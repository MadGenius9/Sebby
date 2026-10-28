import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ReminderStore } from "../electron/reminders.mjs";
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-reminder-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let now = 1000;
  const store = new ReminderStore(dir, { now: () => now });
  await store.load();
  return { dir, store, advance: (n) => (now = n) };
}
test("reminders become due with injected clock and remain durable across restart", async (t) => {
  const { dir, store, advance } = await fixture(t);
  const r = await store.create({ title: "Review tests", dueAt: 2000 });
  assert.equal(store.due().length, 0);
  advance(2000);
  assert.equal(store.due()[0].id, r.id);
  const next = new ReminderStore(dir, { now: () => 3000 });
  await next.load();
  assert.equal(next.due()[0].title, "Review tests");
  await next.markDelivered(r.id);
  assert.equal(next.due().length, 0);
  assert.equal(next.list()[0].status, "delivered");
});
test("reminder snooze, dismiss and confirmed delete are explicit", async (t) => {
  const { store, advance } = await fixture(t);
  const r = await store.create({ title: "Check build", dueAt: 1000 });
  await store.markDelivered(r.id);
  await store.snooze(r.id, 3000);
  assert.equal(store.due().length, 0);
  advance(3000);
  assert.equal(store.due().length, 1);
  await store.dismiss(r.id);
  assert.equal(store.due().length, 0);
  await assert.rejects(store.remove(r.id), /Confirm/);
  await store.remove(r.id, { confirmed: true });
  assert.equal(store.list().length, 0);
});
test("reminders reject invalid times, labels and premature delivery", async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(store.create({ title: "", dueAt: 2000 }));
  await assert.rejects(store.create({ title: "ok", dueAt: Infinity }));
  const r = await store.create({ title: "ok", dueAt: 3000 });
  await assert.rejects(store.markDelivered(r.id), /due/);
  await assert.rejects(store.snooze(r.id, 999), /future/);
  await assert.rejects(store.create({ title: "x".repeat(501), dueAt: 3000 }));
});
test("reminder concurrent updates serialize; corruption does not reset data", async (t) => {
  const { dir, store } = await fixture(t);
  await Promise.all([
    store.create({ title: "One", dueAt: 2000 }),
    store.create({ title: "Two", dueAt: 3000 }),
  ]);
  assert.equal(store.list().length, 2);
  await fs.writeFile(path.join(dir, "sebby-reminders.json"), "broken");
  const next = new ReminderStore(dir);
  await assert.rejects(next.load(), /not overwritten/);
  assert.throws(() => next.list(), /Load/);
  assert.equal(
    await fs.readFile(path.join(dir, "sebby-reminders.json"), "utf8"),
    "broken",
  );
});
