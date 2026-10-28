import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import https from "node:https";
import { GitHubReader, directGitHubGet } from "../electron/github-reader.mjs";
const configuration = {
  owner: "owner",
  repo: "repository",
  ref: "feature/read-only",
  useToken: false,
};
const text = "Untrusted repo text <script>never execute</script>\n",
  blobSha = createHash("sha1")
    .update(`blob ${Buffer.byteLength(text)}\0`)
    .update(text)
    .digest("hex"),
  treeSha = "a".repeat(40);
const response = (value) => ({
  status: 200,
  headers: {
    "content-type": "application/json",
    "x-github-request-id": "REQ123",
  },
  body: JSON.stringify(value),
});
const tree = () => ({
  sha: treeSha,
  truncated: false,
  tree: [
    {
      path: "README.md",
      mode: "100644",
      type: "blob",
      size: Buffer.byteLength(text),
      sha: blobSha,
    },
    {
      path: ".env",
      mode: "100644",
      type: "blob",
      size: 5,
      sha: "b".repeat(40),
    },
    {
      path: "link.md",
      mode: "120000",
      type: "blob",
      size: 2,
      sha: "c".repeat(40),
    },
  ],
});
function fixture(extra = {}) {
  let value = { ...configuration };
  const sent = [],
    approvals = [];
  const config = { get: () => structuredClone(value) };
  const vault = {
    status: async () => ({ configured: true, secureStorageAvailable: true }),
    getToken: async () => "TEST_ONLY_TOKEN_SENTINEL",
  };
  const reader = new GitHubReader({
    config,
    vault,
    approve: async (payload) => {
      approvals.push(payload);
      return true;
    },
    resolve: async () => [{ address: "140.82.112.6", family: 4 }],
    transport: async (input) => {
      sent.push(input);
      if (input.apiPath.includes("/git/trees/")) return response(tree());
      if (input.apiPath.includes("/git/blobs/"))
        return response({
          sha: blobSha,
          size: Buffer.byteLength(text),
          encoding: "base64",
          content: Buffer.from(text).toString("base64"),
        });
      return response({
        full_name: "owner/repository",
        private: false,
        default_branch: "main",
        description: "Repository metadata",
      });
    },
    ...extra,
  });
  return {
    reader,
    sent,
    approvals,
    setConfig: (next) => {
      value = next;
    },
  };
}
test("metadata/tree/blob reads require independent approval, remain public by default, and verify immutable content", async () => {
  const { reader, sent, approvals } = fixture();
  const metadata = await reader.metadata();
  assert.equal(metadata.status, "ok");
  assert.equal(metadata.repository.fullName, "owner/repository");
  const listed = await reader.tree();
  assert.equal(listed.entries.length, 1);
  assert.equal(listed.entries[0].path, "README.md");
  const file = await reader.file({ treeId: listed.treeId, path: "README.md" });
  assert.equal(file.file.content, text);
  assert.equal(file.file.untrusted, true);
  assert.equal(file.file.treeSha, treeSha);
  assert.equal(file.provenance.apiVersion, "2026-03-10");
  assert.equal(approvals.length, 3);
  assert.equal(sent.length, 3);
  assert.equal(sent[0].token, undefined);
  assert.match(sent[1].apiPath, /feature%2Fread-only\?recursive=1/);
  assert.equal(sent[2].apiPath, `/repos/owner/repository/git/blobs/${blobSha}`);
  assert.throws(() =>
    reader.file({ treeId: listed.treeId, path: "../secret.md" }),
  );
  assert.throws(() =>
    reader.file({
      treeId: listed.treeId,
      path: "README.md",
      url: "https://evil.com",
    }),
  );
});
test("denial performs no DNS, token decryption or HTTP; token sends only after explicit opt-in/approval", async () => {
  let touched = false;
  const denied = fixture({
    approve: async () => false,
    resolve: async () => {
      touched = true;
    },
    transport: async () => {
      touched = true;
    },
    vault: {
      status: async () => ({ configured: true }),
      getToken: async () => {
        touched = true;
      },
    },
  });
  assert.equal((await denied.reader.metadata()).status, "denied");
  assert.equal(touched, false);
  const f = fixture();
  f.setConfig({ ...configuration, useToken: true });
  await f.reader.metadata();
  assert.equal(f.sent[0].token, "TEST_ONLY_TOKEN_SENTINEL");
  assert.equal(f.approvals[0].useToken, true);
});
test("unsafe DNS, redirect, rate/auth errors and raw remote bodies fail closed without retries", async () => {
  for (const overrides of [
    { resolve: async () => [{ address: "127.0.0.1", family: 4 }] },
    {
      transport: async () => ({
        ...response({ message: "SECRET_SERVER_DETAIL" }),
        status: 302,
      }),
    },
    {
      transport: async () => ({
        ...response({ message: "SECRET_SERVER_DETAIL" }),
        status: 401,
      }),
    },
    {
      transport: async () => ({
        ...response({ message: "SECRET_SERVER_DETAIL" }),
        status: 429,
      }),
    },
    {
      transport: async () => ({
        ...response({}),
        body: "x".repeat(1024 * 1024 + 1),
      }),
    },
  ]) {
    const { reader } = fixture(overrides);
    const result = await reader.metadata();
    assert.equal(result.status, "error");
    assert.equal(
      JSON.stringify(result).includes("SECRET_SERVER_DETAIL"),
      false,
    );
  }
});
test("blob integrity mismatch, binary data and configuration changes never silently substitute content", async () => {
  const f = fixture();
  const listed = await f.reader.tree();
  f.reader.transport = async () =>
    response({
      sha: blobSha,
      size: Buffer.byteLength(text),
      encoding: "base64",
      content: Buffer.from("tampered".padEnd(Buffer.byteLength(text))).toString(
        "base64",
      ),
    });
  assert.equal(
    (await f.reader.file({ treeId: listed.treeId, path: "README.md" })).status,
    "error",
  );
  f.setConfig({ ...configuration, repo: "different" });
  assert.equal(
    (await f.reader.file({ treeId: listed.treeId, path: "README.md" })).status,
    "error",
  );
  f.reader.clearCache();
  assert.throws(() =>
    f.reader.file({ treeId: listed.treeId, path: "README.md" }),
  );
});
test("cancellation aborts hung injected transport and blocks overlapping reads", async () => {
  let ready;
  const started = new Promise((resolve) => (ready = resolve));
  const f = fixture({
    transport: async () => {
      ready();
      return new Promise(() => {});
    },
  });
  const pending = f.reader.metadata();
  await started;
  assert.equal(f.reader.isBusy, true);
  await assert.rejects(f.reader.tree(), /active GitHub read/);
  assert.throws(() => f.reader.clearCache(), /active/);
  f.reader.cancel();
  assert.equal((await pending).status, "cancelled");
  assert.equal(f.reader.isBusy, false);
  f.reader.shutdown();
  await assert.rejects(f.reader.metadata(), /shutting down/);
});
test("direct transport is fixed GET origin with pinned TLS and no redirect/proxy machinery, mocked without sockets", async (t) => {
  const original = https.request;
  let captured;
  https.request = (options, receive) => {
    captured = options;
    const req = new EventEmitter();
    req.end = () =>
      queueMicrotask(() => {
        const res = new EventEmitter();
        res.statusCode = 302;
        res.headers = { location: "https://evil.com/" };
        receive(res);
        res.emit("data", Buffer.from("{}"));
        res.emit("end");
        req.emit("close");
      });
    return req;
  };
  t.after(() => {
    https.request = original;
  });
  const result = await directGitHubGet({
    apiPath: "/repos/owner/repository",
    address: "140.82.112.6",
    family: 4,
    signal: new AbortController().signal,
  });
  assert.equal(result.status, 302);
  assert.equal(captured.method, "GET");
  assert.equal(captured.hostname, "api.github.com");
  assert.equal(captured.servername, "api.github.com");
  assert.equal(captured.agent, false);
  assert.equal(captured.rejectUnauthorized, true);
  assert.equal(captured.headers.Authorization, undefined);
  assert.equal(captured.headers["X-GitHub-Api-Version"], "2026-03-10");
  captured.lookup("api.github.com", {}, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, "140.82.112.6");
    assert.equal(family, 4);
  });
  assert.throws(() =>
    directGitHubGet({
      apiPath: "https://evil.com/",
      address: "140.82.112.6",
      family: 4,
    }),
  );
});
test("cancellation during credential status prevents a later native consent prompt", async () => {
  let finish, started;
  const ready = new Promise((resolve) => (started = resolve));
  const approvals = [];
  const f = fixture({
    vault: {
      status: () => {
        started();
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    },
    approve: async (request) => {
      approvals.push(request);
      return true;
    },
  });
  const pending = f.reader.metadata();
  await ready;
  f.reader.shutdown();
  finish({ configured: true });
  assert.equal((await pending).status, "cancelled");
  assert.equal(approvals.length, 0);
  assert.equal(f.sent.length, 0);
});
test("validly hashed binary blobs are rejected and oversized tree entries are not offered", async () => {
  for (const buffer of [Buffer.from([0, 65]), Buffer.from([255, 254])]) {
    const digest = createHash("sha1")
      .update(`blob ${buffer.length}\0`)
      .update(buffer)
      .digest("hex");
    const f = fixture({
      transport: async (input) =>
        input.apiPath.includes("/trees/")
          ? response({
              sha: treeSha,
              truncated: false,
              tree: [
                {
                  path: "binary.txt",
                  type: "blob",
                  mode: "100644",
                  sha: digest,
                  size: buffer.length,
                },
                {
                  path: "large.txt",
                  type: "blob",
                  mode: "100644",
                  sha: "d".repeat(40),
                  size: 256 * 1024 + 1,
                },
              ],
            })
          : response({
              sha: digest,
              size: buffer.length,
              encoding: "base64",
              content: buffer.toString("base64"),
            }),
    });
    const listed = await f.reader.tree();
    assert.deepEqual(
      listed.entries.map((entry) => entry.path),
      ["binary.txt"],
    );
    const result = await f.reader.file({
      treeId: listed.treeId,
      path: "binary.txt",
    });
    assert.equal(result.status, "error");
    assert.match(result.error, /UTF-8|Binary/);
  }
});
