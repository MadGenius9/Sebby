import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ConversationStore } from "../electron/conversations.mjs";
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-history-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new ConversationStore(dir, { now: () => 1000 });
  await store.load();
  return { dir, store };
}
test("conversations persist drafts and unsent messages without inventing replies", async (t) => {
  const { dir, store } = await fixture(t);
  const c = await store.create({
    title: "Build app",
    workspaceId: "project-1",
  });
  await store.saveDraft(c.id, "Draft");
  assert.equal(store.get(c.id).draft, "Draft");
  await store.appendUser(c.id, "Hello");
  assert.deepEqual(
    store.get(c.id).messages.map((x) => [x.role, x.status]),
    [["user", "unsent"]],
  );
  const next = new ConversationStore(dir);
  await next.load();
  assert.equal(next.get(c.id).messages[0].text, "Hello");
  assert.equal(next.get(c.id).draft, "");
  assert.equal(next.list()[0].workspaceId, "project-1");
});
test("conversation validation bounds payloads and requires response provenance", async (t) => {
  const { store } = await fixture(t);
  const c = await store.create();
  await assert.rejects(store.appendAssistant(c.id, "fake"), /provenance/);
  await assert.rejects(
    store.appendUser(c.id, "x", { status: "complete" }),
    /status/,
  );
  await assert.rejects(store.saveDraft(c.id, "x".repeat(65537)), /text/);
  await assert.rejects(store.create({ title: "\0" }), /text/);
  await store.appendAssistant(c.id, "An externally supplied response", {
    requestId: "response-id",
    status: "interrupted",
  });
  assert.equal(store.get(c.id).messages[0].status, "interrupted");
});
test("conversation serialized saves and explicit deletion", async (t) => {
  const { store } = await fixture(t);
  const c = await store.create();
  await Promise.all([
    store.appendUser(c.id, "one"),
    store.appendUser(c.id, "two"),
  ]);
  assert.equal(store.get(c.id).messages.length, 2);
  const exported = store.export();
  exported.conversations[0].title = "Mutated";
  assert.notEqual(store.get(c.id).title, "Mutated");
  await assert.rejects(store.remove(c.id), /Confirm/);
  await store.remove(c.id, { confirmed: true });
  assert.equal(store.list().length, 0);
});
test("conversation corrupt data preserved and use requires successful load", async (t) => {
  const { dir } = await fixture(t);
  await fs.writeFile(path.join(dir, "sebby-conversations.json"), "broken");
  const store = new ConversationStore(dir);
  await assert.rejects(store.load(), /not overwritten/);
  assert.throws(() => store.list(), /Load/);
  assert.equal(
    await fs.readFile(path.join(dir, "sebby-conversations.json"), "utf8"),
    "broken",
  );
});
