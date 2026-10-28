import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { EventEmitter } from "node:events";
import {
  validatePublicationRequest as validate,
  directGitHubPublishRequest as send,
} from "../electron/github-publish-transport.mjs";
const root = "/repos/owner/demo",
  sha = "a".repeat(40);
test("publication transport only accepts exact bounded create-object/new-ref/draft-PR schemas", () => {
  for (const [suffix, body] of [
    [
      "/git/blobs",
      { encoding: "base64", content: Buffer.from("text").toString("base64") },
    ],
    [
      "/git/trees",
      {
        base_tree: sha,
        tree: [{ path: "index.html", mode: "100644", type: "blob", sha }],
      },
    ],
    ["/git/commits", { message: "Reviewed change", tree: sha, parents: [sha] }],
    ["/git/refs", { ref: "refs/heads/sebby/example", sha }],
    [
      "/pulls",
      {
        title: "Review",
        body: "Details",
        head: "sebby/example",
        base: "main",
        draft: true,
        maintainer_can_modify: false,
      },
    ],
  ])
    assert.doesNotThrow(() =>
      validate({ method: "POST", apiPath: root + suffix, body }),
    );
  for (const suffix of [
    "",
    `/git/ref/heads/feature%2Fdemo`,
    `/git/commits/${sha}`,
    `/git/trees/${sha}?recursive=1`,
    `/git/blobs/${sha}`,
    `/commits/${sha}/check-runs?per_page=50`,
  ])
    assert.doesNotThrow(() =>
      validate({ method: "GET", apiPath: root + suffix }),
    );
});
test("rejects merges, force/update/delete, arbitrary paths, executable modes and privilege-bearing extras", () => {
  const bad = [
    {
      method: "PATCH",
      apiPath: root + "/git/refs/heads/main",
      body: { sha, force: true },
    },
    { method: "DELETE", apiPath: root + "/git/refs/heads/main" },
    { method: "PUT", apiPath: root + "/pulls/1/merge" },
    {
      method: "POST",
      apiPath: root + "/actions/workflows/test/dispatches",
      body: {},
    },
    {
      method: "POST",
      apiPath: root + "/git/refs",
      body: { ref: "refs/heads/main", sha },
    },
    {
      method: "POST",
      apiPath: root + "/git/trees",
      body: {
        base_tree: sha,
        tree: [
          {
            path: ".github/workflows/run.yml",
            mode: "100644",
            type: "blob",
            sha,
          },
        ],
      },
    },
    {
      method: "POST",
      apiPath: root + "/git/trees",
      body: {
        base_tree: sha,
        tree: [{ path: "app.js", mode: "100755", type: "blob", sha }],
      },
    },
    {
      method: "POST",
      apiPath: root + "/git/commits",
      body: { message: "x", tree: sha, parents: [sha, sha] },
    },
    { method: "GET", apiPath: "https://evil.test/repos/x/y" },
    { method: "GET", apiPath: root + "/git/ref/heads/main%3Ftoken=x" },
    {
      method: "POST",
      apiPath: root + "/pulls",
      body: {
        title: "x",
        body: "",
        head: "sebby/new",
        base: "main",
        draft: false,
        maintainer_can_modify: false,
      },
    },
  ];
  for (const request of bad) assert.throws(() => validate(request));
});
test("direct transport pins fixed TLS and never follows redirects; mocked without sockets", async (t) => {
  const old = https.request;
  let captured, payload;
  https.request = (options, callback) => {
    captured = options;
    const request = new EventEmitter();
    request.end = (body) => {
      payload = body;
      queueMicrotask(() => {
        const response = new EventEmitter();
        response.statusCode = 302;
        response.headers = {
          "content-type": "application/json",
          location: "https://evil.test",
          "set-cookie": "never forwarded",
        };
        callback(response);
        response.emit("data", Buffer.from("{}"));
        response.emit("end");
        request.emit("close");
      });
    };
    return request;
  };
  t.after(() => (https.request = old));
  const result = await send({
    method: "POST",
    apiPath: root + "/git/refs",
    body: { ref: "refs/heads/sebby/new", sha },
    address: "140.82.112.6",
    family: 4,
    token: "SYNTHETIC_TEST_TOKEN_ONLY",
    signal: new AbortController().signal,
  });
  assert.equal(result.status, 302);
  assert.equal(captured.hostname, "api.github.com");
  assert.equal(captured.servername, "api.github.com");
  assert.equal(captured.agent, false);
  assert.equal(captured.rejectUnauthorized, true);
  assert.equal(captured.method, "POST");
  assert.equal(result.headers["set-cookie"], undefined);
  assert.ok(payload.every((value) => value === 0));
  captured.lookup("api.github.com", {}, (err, address, family) => {
    assert.equal(err, null);
    assert.equal(address, "140.82.112.6");
    assert.equal(family, 4);
  });
});
