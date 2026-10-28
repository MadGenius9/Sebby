import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { GitHubPublisher } from "../electron/github-publish.mjs";
const base = "a".repeat(40),
  tree = "b".repeat(40),
  newTree = "c".repeat(40),
  commit = "d".repeat(40);
function fixture() {
  let allowed = true,
    approved = true;
  const requests = [],
    consents = [],
    records = new Map();
  const cfg = {
    owner: "fixture-owner",
    repo: "fixture-repo",
    ref: "main",
    useToken: true,
  };
  const publisher = new GitHubPublisher({
    workspace: {
      root: "/fixture",
      read: async (path) => ({ path, content: "reviewed fixture text" }),
    },
    config: { get: () => structuredClone(cfg) },
    vault: { getToken: async () => "SYNTHETIC_TOKEN_NOT_REAL" },
    permissions: { isAllowed: async () => allowed },
    history: {
      begin: async (input) => {
        const record = { ...input, id: randomUUID(), phase: "prepared" };
        records.set(record.id, record);
        return structuredClone(record);
      },
      advance: async (id, patch) => {
        const value = { ...records.get(id), ...patch };
        records.set(id, value);
        return structuredClone(value);
      },
      get: async (id) => structuredClone(records.get(id)),
    },
    approveRead: async () => true,
    approvePublish: async (p) => {
      consents.push(p);
      return approved;
    },
    approvePR: async () => true,
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    transport: async (request) => {
      requests.push(
        structuredClone({
          method: request.method,
          path: request.apiPath,
          body: request.body,
        }),
      );
      let data;
      if (request.method === "GET") {
        if (request.apiPath.includes("/git/ref/heads/"))
          data = {
            ref: "refs/heads/main",
            object: { type: "commit", sha: base },
          };
        else if (request.apiPath.endsWith("/git/commits/" + base))
          data = { sha: base, tree: { sha: tree } };
        else if (request.apiPath.includes("/git/trees/"))
          data = { sha: tree, tree: [], truncated: false };
        else throw Error("Unexpected GET");
      } else if (request.apiPath.endsWith("/git/blobs")) {
        const b = Buffer.from(request.body.content, "base64");
        data = {
          sha: createHash("sha1")
            .update(`blob ${b.length}\0`)
            .update(b)
            .digest("hex"),
        };
      } else if (request.apiPath.endsWith("/git/trees"))
        data = { sha: newTree };
      else if (request.apiPath.endsWith("/git/commits"))
        data = {
          sha: commit,
          tree: { sha: newTree },
          parents: [{ sha: base }],
        };
      else if (request.apiPath.endsWith("/git/refs"))
        data = {
          ref: request.body.ref,
          object: { type: "commit", sha: commit },
        };
      else throw Error("Unexpected POST");
      return {
        status: request.method === "POST" ? 201 : 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      };
    },
  });
  return {
    publisher,
    requests,
    consents,
    revoke: () => (allowed = false),
    deny: () => (approved = false),
  };
}
const selection = {
  paths: ["fixture.txt"],
  baseBranch: "main",
  branch: "sebby/security-fixture",
  message: "Reviewed fixture",
};
test("renderer mutation of returned publication preview cannot alter native consent or outbound blobs", async () => {
  const f = fixture();
  const prepared = await f.publisher.prepare(selection);
  assert.equal(prepared.status, "ready");
  prepared.proposal.files[0].after = "renderer-injected";
  prepared.proposal.branch = "main";
  const result = await f.publisher.publish({
    proposalId: prepared.proposal.id,
    digest: prepared.proposal.digest,
  });
  assert.equal(result.status, "branch-created");
  assert.equal(f.consents[0].branch, "sebby/security-fixture");
  assert.equal(f.consents[0].files[0].after, "reviewed fixture text");
  const blobs = f.requests.filter((r) => r.path.endsWith("/git/blobs"));
  assert.equal(
    Buffer.from(blobs[0].body.content, "base64").toString(),
    "reviewed fixture text",
  );
  const writes = f.requests.filter((r) => r.method === "POST");
  assert.equal(writes.at(-1).path.endsWith("/git/refs"), true);
  assert.equal(writes.at(-1).body.ref, "refs/heads/sebby/security-fixture");
  assert.ok(
    !f.requests.some((r) => ["PATCH", "PUT", "DELETE"].includes(r.method)),
  );
  await assert.rejects(
    f.publisher.publish({
      proposalId: prepared.proposal.id,
      digest: prepared.proposal.digest,
    }),
    /new publication preview/,
  );
});
test("revoked exact-repository permission blocks a previously prepared proposal before consent and any write", async () => {
  const f = fixture();
  const prepared = await f.publisher.prepare(selection);
  f.revoke();
  const result = await f.publisher.publish({
    proposalId: prepared.proposal.id,
    digest: prepared.proposal.digest,
  });
  assert.equal(result.status, "error");
  assert.equal(f.consents.length, 0);
  assert.equal(f.requests.filter((r) => r.method === "POST").length, 0);
});
test("native denial never produces remote objects even with a valid digest and permission", async () => {
  const f = fixture();
  const prepared = await f.publisher.prepare(selection);
  f.deny();
  const result = await f.publisher.publish({
    proposalId: prepared.proposal.id,
    digest: prepared.proposal.digest,
  });
  assert.equal(result.status, "denied");
  assert.equal(f.requests.filter((r) => r.method === "POST").length, 0);
});
