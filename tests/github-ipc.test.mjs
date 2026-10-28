import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installGitHub } from "../electron/github-ipc.mjs";
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
async function fixture(t, { gate, consent = true } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-gh-ipc-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const handlers = new Map(),
    approvals = [],
    requests = [];
  const service = await installGitHub({
    directory,
    safeStorage: {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => "fixture_secure",
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString(),
    },
    register: (n, f) => handlers.set(n, f),
    confirm: async (...args) => {
      approvals.push(args);
      return gate ? gate.promise : consent;
    },
    readerOptions: {
      resolve: async () => [{ address: "140.82.112.6", family: 4 }],
      transport: async (input) => {
        requests.push(input);
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "demo",
            full_name: "owner/demo",
            private: false,
            default_branch: "main",
            description: "fixture",
          }),
        };
      },
    },
  });
  await handlers.get("save-github-config")({
    owner: "owner",
    repo: "demo",
    ref: "HEAD",
    useToken: false,
  });
  return { service, handlers, approvals, requests };
}
test("GitHub native token denial clears input and makes no persistence or request", async (t) => {
  const f = await fixture(t, { consent: false });
  const input = { token: "SYNTHETIC_TOKEN_FOR_TEST_ONLY" };
  assert.deepEqual(await f.handlers.get("save-github-token")(input), {
    saved: false,
  });
  assert.equal(input.token, "");
  assert.equal((await f.service.vault.status()).configured, false);
  assert.equal(f.requests.length, 0);
});
test("pending token consent reserves configuration/read lock and shutdown prevents save", async (t) => {
  const gate = deferred(),
    f = await fixture(t, { gate });
  const pending = f.handlers.get("save-github-token")({
    token: "SYNTHETIC_TOKEN_FOR_TEST_ONLY",
  });
  assert.equal(f.service.isBusy(), true);
  assert.throws(() => f.handlers.get("read-github-tree")(), /active/);
  assert.throws(() => f.handlers.get("save-github-config")({}), /active/);
  const drain = f.service.shutdown();
  gate.resolve(true);
  await assert.rejects(pending, /closing/);
  await drain;
  assert.equal((await f.service.vault.status()).configured, false);
  assert.throws(() => f.handlers.get("read-github-metadata")(), /closing/);
});
test("read cancellation while approval pending never dispatches and releases lock", async (t) => {
  const gate = deferred(),
    f = await fixture(t, { gate });
  const pending = f.handlers.get("read-github-metadata")();
  assert.equal(f.service.isBusy(), true);
  f.handlers.get("cancel-github-read")();
  gate.resolve(true);
  assert.equal((await pending).status, "cancelled");
  assert.equal(f.requests.length, 0);
  assert.equal(f.service.isBusy(), false);
});
test("configuration and token storage do not autoconnect; each actual read has native disclosure", async (t) => {
  const f = await fixture(t);
  const input = { token: "SYNTHETIC_TOKEN_FOR_TEST_ONLY" };
  await f.handlers.get("save-github-token")(input);
  assert.equal(input.token, "");
  assert.equal(f.requests.length, 0);
  const value = await f.handlers.get("read-github-metadata")();
  assert.equal(value.status, "ok");
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].token, undefined);
  assert.equal(f.approvals.length, 2);
  assert.equal(f.handlers.has("get-github-token"), false);
});
