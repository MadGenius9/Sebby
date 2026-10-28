import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GitHubHistory } from "../electron/github-history.mjs";
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-history-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const h = new GitHubHistory(root);
  await h.load();
  return { root, h };
}
const input = () => ({
  owner: "Owner",
  repo: "Project",
  baseBranch: "main",
  baseSHA: "a".repeat(40),
  newBranch: "sebby/change-1",
  files: [{ path: "src/a.ts", sha256: "b".repeat(64) }],
});
const commit = {
  phase: "commit-created",
  commitSHA: "c".repeat(40),
  treeSHA: "d".repeat(40),
};
test("metadata-only journal requires verified stage evidence before published", async (t) => {
  const { h } = await fixture(t);
  const op = await h.begin(input());
  assert.equal(op.owner, "owner");
  assert.match(op.id, /^[a-f0-9-]{36}$/);
  await assert.rejects(
    h.advance(op.id, { phase: "published", prNumber: 1 }),
    /transition/,
  );
  await h.advance(op.id, { phase: "creating-objects" });
  await assert.rejects(
    h.advance(op.id, { phase: "commit-created" }),
    /evidence/,
  );
  await h.advance(op.id, commit);
  await h.advance(op.id, { phase: "creating-branch" });
  await h.advance(op.id, { phase: "branch-created" });
  await h.advance(op.id, { phase: "creating-pr" });
  await assert.rejects(h.advance(op.id, { phase: "published" }), /evidence/);
  const done = await h.advance(op.id, { phase: "published", prNumber: 42 });
  assert.equal(done.outcome, "published");
  assert.equal(done.commitSHA, commit.commitSHA);
  await assert.rejects(
    h.advance(op.id, { phase: "creating-pr" }),
    /transition/,
  );
});
test("restart uncertain, branch evidence stable, no replay and immutable evidence", async (t) => {
  const { root, h } = await fixture(t);
  const a = await h.begin(input()),
    b = await h.begin({ ...input(), newBranch: "sebby/change-2" });
  await h.advance(b.id, { phase: "creating-objects" });
  await h.advance(b.id, commit);
  await h.advance(b.id, { phase: "creating-branch" });
  await h.advance(b.id, { phase: "branch-created" });
  const reopened = new GitHubHistory(root);
  await reopened.load();
  assert.equal(reopened.get(a.id).phase, "uncertain");
  assert.equal(reopened.get(a.id).errorCode, "restart-interrupted");
  assert.equal(reopened.get(b.id).phase, "branch-created");
  await assert.rejects(
    reopened.advance(a.id, { phase: "creating-objects" }),
    /transition/,
  );
  await assert.rejects(
    reopened.advance(b.id, { phase: "creating-pr", commitSHA: "e".repeat(40) }),
    /immutable/,
  );
});
test("strict metadata rejects source/errors/unknown fields and traversal", async (t) => {
  const { h } = await fixture(t);
  assert.throws(() => h.begin({ ...input(), content: "SECRET" }));
  await assert.rejects(
    h.begin({
      ...input(),
      files: [{ path: "../secret", sha256: "b".repeat(64) }],
    }),
  );
  await assert.rejects(
    h.begin({
      ...input(),
      files: [{ path: "ok", sha256: "b".repeat(64), content: "SECRET" }],
    }),
  );
  const a = await h.begin(input());
  assert.throws(() => h.advance(a.id, { phase: "failed", error: "raw-token" }));
  await assert.rejects(
    h.advance(a.id, { phase: "failed", errorCode: "raw-token" }),
  );
  await h.advance(a.id, { phase: "uncertain", errorCode: "timeout" });
  assert.equal(h.get(a.id).outcome, "uncertain");
});
test("concurrent operations persist and corrupt file preserved", async (t) => {
  const { root, h } = await fixture(t);
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      h.begin({ ...input(), newBranch: `sebby/${i}` }),
    ),
  );
  assert.equal(h.list().length, 20);
  const file = path.join(root, "sebby-github-history.json");
  await fs.writeFile(file, "{invalid");
  const reopened = new GitHubHistory(root);
  await assert.rejects(reopened.load(), /preserved/);
  await assert.rejects(reopened.begin(input()), /Load/);
  assert.equal(await fs.readFile(file, "utf8"), "{invalid");
});
test("queued inputs are snapshotted and failed reload disables mutations", async (t) => {
  const { root, h } = await fixture(t),
    original = input();
  const promise = h.begin(original);
  original.files[0].path = "changed";
  original.newBranch = "changed";
  const op = await promise;
  assert.equal(op.newBranch, "sebby/change-1");
  assert.equal(op.files[0].path, "src/a.ts");
  const patch = { phase: "creating-objects" };
  const advancing = h.advance(op.id, patch);
  patch.phase = "published";
  assert.equal((await advancing).phase, "creating-objects");
  await fs.writeFile(path.join(root, "sebby-github-history.json"), "{corrupt");
  await assert.rejects(h.load());
  await assert.rejects(h.begin(input()), /Load/);
});
test("history does not evict unresolved evidence at its capacity bound", async (t) => {
  const { root, h } = await fixture(t);
  const op = await h.begin(input());
  const { randomUUID } = await import("node:crypto");
  const document = {
    version: 1,
    operations: Array.from({ length: 200 }, () => ({
      ...op,
      id: randomUUID(),
      phase: "uncertain",
      outcome: "uncertain",
    })),
  };
  await fs.writeFile(
    path.join(root, "sebby-github-history.json"),
    JSON.stringify(document),
  );
  const reopened = new GitHubHistory(root);
  await reopened.load();
  await assert.rejects(reopened.begin(input()), /full/);
  assert.equal(reopened.list().length, 200);
});

test("publisher may cancel a durable intent only before its first outbound mutation attempt", async (t) => {
  const { h } = await fixture(t),
    a = await h.begin(input());
  await h.advance(a.id, { phase: "creating-objects" });
  assert.equal(
    (await h.advance(a.id, { phase: "cancelled", errorCode: "cancelled" }))
      .outcome,
    "cancelled",
  );
  const b = await h.begin({ ...input(), newBranch: "sebby/another" });
  await h.advance(b.id, { phase: "creating-objects" });
  await h.advance(b.id, commit);
  await h.advance(b.id, { phase: "creating-branch" });
  await h.advance(b.id, { phase: "branch-created" });
  await h.advance(b.id, { phase: "creating-pr" });
  const stopped = await h.advance(b.id, {
    phase: "cancelled",
    errorCode: "cancelled",
  });
  assert.equal(stopped.outcome, "cancelled");
  assert.equal(stopped.commitSHA, commit.commitSHA);
});
