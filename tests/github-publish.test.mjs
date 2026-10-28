import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GitHubHistory } from "../electron/github-history.mjs";
import { validatePublicationRequest } from "../electron/github-publish-transport.mjs";
import { GitHubPublisher } from "../electron/github-publish.mjs";
const BASE = "a".repeat(40),
  TREE = "b".repeat(40),
  NEW_TREE = "c".repeat(40),
  COMMIT = "d".repeat(40);
const blob = (s) =>
  createHash("sha1")
    .update(`blob ${Buffer.byteLength(s)}\0`)
    .update(s)
    .digest("hex");
const input = () => ({
  paths: ["app.html"],
  baseBranch: "main",
  branch: "sebby/reviewed-change",
  message: "Reviewed app update",
});
function fixture(options = {}) {
  const calls = [],
    records = new Map(),
    content = { value: "new text" };
  const cfg = { owner: "owner", repo: "repo", ref: "HEAD", useToken: true };
  const config = { get: () => ({ ...cfg }) },
    workspace = {
      root: "/workspace",
      read: async (path) => ({ path, content: content.value }),
    };
  const history = {
    begin: async (v) => {
      const r = { ...v, id: randomUUID(), phase: "prepared" };
      records.set(r.id, r);
      return structuredClone(r);
    },
    advance: async (id, p) => {
      const r = { ...records.get(id), ...p };
      records.set(id, r);
      return structuredClone(r);
    },
    get: (id) => structuredClone(records.get(id)),
  };
  let head = BASE;
  const transport = async (req) => {
    validatePublicationRequest(req);
    calls.push(req);
    const p = req.apiPath;
    let value;
    if (req.method === "GET") {
      if (p.includes("/git/ref/heads/")) {
        const name = p.split("/git/ref/heads/")[1];
        value = {
          ref: `refs/heads/${name}`,
          object: { type: "commit", sha: name === "main" ? head : COMMIT },
        };
      } else if (p.endsWith(`/git/commits/${BASE}`))
        value = { sha: BASE, tree: { sha: TREE } };
      else if (p.includes("/git/trees/"))
        value = {
          sha: TREE,
          truncated: false,
          tree: [
            {
              path: "app.html",
              type: "blob",
              mode: "100644",
              sha: blob("old text"),
              size: 8,
            },
          ],
        };
      else if (p.includes("/git/blobs/"))
        value = {
          sha: blob("old text"),
          encoding: "base64",
          size: 8,
          content: Buffer.from("old text").toString("base64"),
        };
      else if (p.includes("/check-runs"))
        value = {
          total_count: 1,
          check_runs: [
            {
              head_sha: COMMIT,
              name: "test",
              status: "completed",
              conclusion: "success",
            },
          ],
        };
    } else if (p.endsWith("/git/blobs"))
      value = { sha: blob(Buffer.from(req.body.content, "base64")) };
    else if (p.endsWith("/git/trees")) value = { sha: NEW_TREE };
    else if (p.endsWith("/git/commits"))
      value = {
        sha: COMMIT,
        tree: { sha: NEW_TREE },
        parents: [{ sha: BASE }],
      };
    else if (p.endsWith("/git/refs"))
      value = { ref: req.body.ref, object: { sha: COMMIT, type: "commit" } };
    else if (p.endsWith("/pulls"))
      value = {
        number: 42,
        draft: true,
        head: { sha: COMMIT, ref: input().branch },
        base: { ref: "main" },
      };
    if (!value) throw Error("Unexpected mock path");
    return {
      status: req.method === "POST" ? 201 : 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(value),
    };
  };
  const service = new GitHubPublisher({
    workspace,
    config,
    vault: { getToken: async () => "fake-token-only" },
    permissions: { isAllowed: () => true },
    history,
    approveRead: async () => true,
    approvePublish: async () => true,
    approvePR: async () => true,
    resolve: async () => [{ address: "140.82.112.6", family: 4 }],
    transport,
    ...options,
  });
  return {
    service,
    calls,
    records,
    content,
    cfg,
    workspace,
    history,
    transport,
    setHead: (value) => (head = value),
  };
}
const prepared = async (f) => {
  const result = await f.service.prepare(input());
  assert.equal(result.status, "ready");
  return result.proposal;
};
const publish = (f, p) =>
  f.service.publish({ proposalId: p.id, digest: p.digest });
test("immutable full diff then objects/commit/new ref only; draft PR separately approved and anchored checks", async () => {
  const f = fixture();
  const p = await prepared(f);
  assert.equal(p.truncated, false);
  assert.match(p.digest, /^[a-f0-9]{64}$/);
  assert.equal(p.files[0].before, "old text");
  assert.equal(p.files[0].after, "new text");
  assert.match(p.files[0].diff, /-old text\n\+new text/);
  assert.ok(f.calls.every((c) => c.method === "GET"));
  p.files[0].after = "renderer modified";
  const result = await publish(f, p);
  assert.equal(result.status, "branch-created");
  const writes = f.calls.filter((c) => c.method === "POST");
  assert.deepEqual(
    writes.map((c) => c.apiPath.split("/").at(-1)),
    ["blobs", "trees", "commits", "refs"],
  );
  assert.equal(
    Buffer.from(writes[0].body.content, "base64").toString(),
    "new text",
  );
  assert.equal(writes[1].body.base_tree, TREE);
  assert.deepEqual(writes[2].body.parents, [BASE]);
  assert.deepEqual(writes[3].body, {
    ref: "refs/heads/sebby/reviewed-change",
    sha: COMMIT,
  });
  assert.ok(
    !f.calls.some((c) => ["PATCH", "PUT", "DELETE"].includes(c.method)),
  );
  const pr = await f.service.createDraftPR({
    publicationId: result.publication.id,
    title: "Review change",
    body: "Draft only",
  });
  assert.equal(pr.status, "published");
  assert.equal(f.calls.at(-1).body.draft, true);
  assert.equal(f.calls.at(-1).body.maintainer_can_modify, false);
  const checks = await f.service.checks({
    publicationId: result.publication.id,
  });
  assert.equal(checks.status, "ok");
  assert.equal(checks.commitSHA, COMMIT);
  assert.equal(checks.checks[0].conclusion, "success");
});
test("strict fields/digest/branch/sensitive paths rejected; renderer approval cannot bypass", async () => {
  const f = fixture();
  for (const change of [
    { paths: [".github/workflows/x.yaml"] },
    { paths: ["../x.html"] },
    { paths: ["secret.txt"] },
    { paths: ["x.html", "x.html"] },
    { branch: "main" },
    { branch: "sebby/x.lock" },
    { paths: Array(11).fill("a.html") },
    { approved: true },
  ])
    await assert.rejects(f.service.prepare({ ...input(), ...change }));
  const p = await prepared(f);
  await assert.rejects(f.service.publish({ proposalId: p.id, digest: "fake" }));
  await assert.rejects(
    f.service.publish({ proposalId: p.id, digest: p.digest, approved: true }),
  );
  assert.equal(f.calls.filter((c) => c.method === "POST").length, 0);
});
test("permission/token opt-in and denial fail before network; publication denial preserves preview", async () => {
  for (const setup of [
    { permissions: { isAllowed: () => false } },
    { approveRead: async () => false },
  ]) {
    const f = fixture(setup);
    assert.notEqual((await f.service.prepare(input())).status, "ready");
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  f.cfg.useToken = false;
  assert.equal((await f.service.prepare(input())).status, "error");
  assert.equal(f.calls.length, 0);
  const g = fixture({ approvePublish: async () => false });
  const p = await prepared(g);
  assert.equal((await publish(g, p)).status, "denied");
  assert.ok(g.service.status().proposalIds.includes(p.id));
  assert.equal(g.calls.filter((c) => c.method === "POST").length, 0);
});
test("local/base/config drift aborts before writes; approved proposals cannot be replayed", async () => {
  for (const kind of ["local", "base", "config", "root"]) {
    const f = fixture();
    const p = await prepared(f);
    if (kind === "local") f.content.value = "changed";
    if (kind === "base") f.setHead("e".repeat(40));
    if (kind === "config") f.cfg.repo = "other";
    if (kind === "root") f.workspace.root = "/other";
    assert.equal((await publish(f, p)).status, "error");
    assert.equal(f.calls.filter((c) => c.method === "POST").length, 0);
  }
  const f = fixture();
  const p = await prepared(f);
  await publish(f, p);
  await assert.rejects(publish(f, p));
});
test("complete tree/blob integrity required; oversized and possible credential content refused", async () => {
  for (const kind of ["truncated", "hash", "large", "secret"]) {
    const f = fixture();
    if (kind === "large") f.content.value = "x".repeat(65537);
    if (kind === "secret") f.content.value = "github_pat_" + "x".repeat(40);
    const base = f.transport;
    f.service.transport = async (req) => {
      const response = await base(req);
      const v = JSON.parse(response.body);
      if (kind === "truncated" && req.apiPath.includes("/git/trees/"))
        v.truncated = true;
      if (kind === "hash" && req.apiPath.includes("/git/blobs/"))
        v.content = Buffer.from("bad text").toString("base64");
      return { ...response, body: JSON.stringify(v) };
    };
    assert.equal((await f.service.prepare(input())).status, "error");
    assert.equal(f.calls.filter((c) => c.method === "POST").length, 0);
  }
});
test("network loss/ref race after writes is uncertain, journal retained, never force-update or retry", async () => {
  for (const failure of ["objects", "ref"]) {
    const f = fixture();
    const p = await prepared(f);
    const transport = f.transport;
    f.service.transport = async (req) => {
      if (
        req.method === "POST" &&
        (failure === "objects" || req.apiPath.endsWith("/git/refs"))
      ) {
        f.calls.push(req);
        if (failure === "objects") throw Error("secret raw network error");
        return { status: 422, body: "raw response should not echo" };
      }
      return transport(req);
    };
    const result = await publish(f, p);
    assert.equal(result.status, "uncertain");
    assert.equal(result.publication.phase, "uncertain");
    assert.equal(JSON.stringify(result).includes("raw"), false);
    await assert.rejects(publish(f, p));
    assert.ok(f.calls.every((c) => ["GET", "POST"].includes(c.method)));
  }
});
test("late base drift after object writes blocks ref creation and reports partial writes", async () => {
  const f = fixture();
  const p = await prepared(f);
  const transport = f.transport;
  f.service.transport = async (req) => {
    const r = await transport(req);
    if (req.method === "POST" && req.apiPath.endsWith("/git/commits"))
      f.setHead("e".repeat(40));
    return r;
  };
  const result = await publish(f, p);
  assert.equal(result.status, "uncertain");
  assert.equal(result.publication.commitSHA, COMMIT);
  assert.equal(
    f.calls.some((c) => c.method === "POST" && c.apiPath.endsWith("/git/refs")),
    false,
  );
});
test("cancellation and shutdown stop network after pending consent; reject overlap", async () => {
  let done;
  const f = fixture({ approveRead: () => new Promise((r) => (done = r)) });
  const run = f.service.prepare(input());
  await new Promise((r) => setImmediate(r));
  await assert.rejects(f.service.prepare(input()), /pending/);
  f.service.cancel();
  done(true);
  assert.equal((await run).status, "cancelled");
  assert.equal(f.calls.length, 0);
  f.service.shutdown();
  await assert.rejects(f.service.prepare(input()), /shut down/);
});
test("PR denial never posts, wrong branch hash blocks, check runs anchored not arbitrary refs", async () => {
  const f = fixture();
  const p = await prepared(f);
  const pub = await publish(f, p);
  f.service.approvePR = async () => false;
  const postCount = f.calls.filter((c) => c.method === "POST").length;
  assert.equal(
    (
      await f.service.createDraftPR({
        publicationId: pub.publication.id,
        title: "Draft",
        body: "",
      })
    ).status,
    "denied",
  );
  assert.equal(f.calls.filter((c) => c.method === "POST").length, postCount);
  f.service.approvePR = async () => true;
  const base = f.transport;
  f.service.transport = async (req) => {
    const response = await base(req);
    const v = JSON.parse(response.body);
    if (req.apiPath.includes("/git/ref/heads/sebby/")) v.object.sha = BASE;
    if (req.apiPath.includes("/check-runs")) v.check_runs[0].head_sha = BASE;
    return { ...response, body: JSON.stringify(v) };
  };
  assert.equal(
    (
      await f.service.createDraftPR({
        publicationId: pub.publication.id,
        title: "Draft",
        body: "",
      })
    ).status,
    "error",
  );
  assert.equal(
    (await f.service.checks({ publicationId: pub.publication.id })).status,
    "error",
  );
  await assert.rejects(
    f.service.checks({ publicationId: pub.publication.id, sha: BASE }),
  );
});

test("real durable history accepts complete publication lifecycle and contains no source/token", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-publish-"));
  try {
    const history = new GitHubHistory(directory);
    await history.load();
    const f = fixture({ history });
    const p = await prepared(f);
    const result = await publish(f, p);
    assert.equal(result.status, "branch-created");
    assert.equal(history.get(result.publication.id).commitSHA, COMMIT);
    const pr = await f.service.createDraftPR({
      publicationId: result.publication.id,
      title: "Draft",
      body: "Review",
    });
    assert.equal(pr.status, "published");
    const serialized = JSON.stringify(history.list());
    assert.equal(serialized.includes("new text"), false);
    assert.equal(serialized.includes("fake-token"), false);
    const restored = new GitHubHistory(directory);
    await restored.load();
    assert.equal(restored.get(result.publication.id).phase, "published");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("discard removes only chosen retained proposal and does not invoke transport", async () => {
  const f = fixture();
  const p = await prepared(f);
  const count = f.calls.length;
  assert.deepEqual(f.service.discard({ proposalId: "other" }), {
    discarded: false,
  });
  assert.deepEqual(f.service.discard({ proposalId: p.id }), {
    discarded: true,
  });
  assert.equal(f.calls.length, count);
  await assert.rejects(publish(f, p));
  assert.throws(() => f.service.discard({ proposalId: p.id, approved: true }));
});

test("non JSON content type never accepted even when body parses", async () => {
  const f = fixture();
  const base = f.transport;
  f.service.transport = async (req) => ({
    ...(await base(req)),
    headers: { "content-type": "text/html" },
  });
  assert.equal((await f.service.prepare(input())).status, "error");
  assert.equal(f.calls.length, 1);
});
