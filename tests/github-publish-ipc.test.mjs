import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installGitHub } from "../electron/github-ipc.mjs";
import { installGitHubPublishing } from "../electron/github-publish-ipc.mjs";
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
async function fixture(t, { gate, consent = true } = {}) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "sebby-publish-ipc-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const handlers = new Map(),
    prompts = [];
  let publishing;
  const register = (name, fn) => handlers.set(name, fn);
  const confirm = async (...args) => {
    prompts.push(args);
    return gate ? gate.promise : consent;
  };
  const github = await installGitHub({
    directory,
    register,
    confirm,
    safeStorage: { isEncryptionAvailable: () => false },
    isExternalBusy: () => publishing?.isBusy() || false,
    onConfigurationChanged: () => publishing?.clearCache(),
  });
  await handlers.get("save-github-config")({
    owner: "Owner",
    repo: "Demo",
    ref: "HEAD",
    useToken: false,
  });
  publishing = await installGitHubPublishing({
    directory,
    workspace: { root: null },
    github,
    register,
    confirm,
  });
  return { directory, handlers, prompts, github, publishing };
}
test("publication authority defaults denied, native grant/revoke only, no renderer journal or token readback", async (t) => {
  const f = await fixture(t);
  assert.equal(f.handlers.get("publisher-status")().authority.allowed, false);
  await f.handlers.get("grant-github-writes")();
  assert.equal(f.handlers.get("publisher-status")().authority.allowed, true);
  assert.deepEqual(
    f.publishing.permissions.list().map(({ owner, repo }) => ({ owner, repo })),
    [{ owner: "owner", repo: "demo" }],
  );
  await f.handlers.get("revoke-github-writes")();
  assert.equal(f.handlers.get("publisher-status")().authority.allowed, false);
  for (const name of [
    "update-github-history",
    "get-github-token",
    "set-github-authority",
  ])
    assert.equal(f.handlers.has(name), false);
  assert.equal(f.publishing.history.list().length, 0);
});
test("pending authority consent locks read/config/token changes and shutdown prevents later grant", async (t) => {
  const gate = deferred(),
    f = await fixture(t, { gate });
  const pending = f.handlers.get("grant-github-writes")();
  assert.equal(f.publishing.isBusy(), true);
  assert.throws(
    () => f.handlers.get("save-github-config")({}),
    /active GitHub/,
  );
  assert.throws(
    () => f.handlers.get("read-github-metadata")(),
    /active GitHub/,
  );
  assert.throws(
    () =>
      f.handlers.get("save-github-token")({
        token: "SYNTHETIC_TEST_TOKEN_ONLY",
      }),
    /active GitHub/,
  );
  const drain = f.publishing.shutdown();
  gate.resolve(true);
  await pending;
  await drain;
  assert.equal(f.publishing.permissions.list().length, 0);
  assert.throws(() => f.handlers.get("grant-github-writes")(), /closing/);
});
test("denied authority remains denied and old repository grant does not authorize a new selected repository", async (t) => {
  const f = await fixture(t, { consent: false });
  await f.handlers.get("grant-github-writes")();
  assert.equal(f.handlers.get("publisher-status")().authority.allowed, false);
  const g = await fixture(t);
  await g.handlers.get("grant-github-writes")();
  await g.handlers.get("save-github-config")({
    owner: "owner",
    repo: "other",
    ref: "HEAD",
    useToken: false,
  });
  assert.equal(g.handlers.get("publisher-status")().authority.allowed, false);
  assert.equal(
    g.publishing.permissions.isAllowed({ owner: "owner", repo: "demo" }),
    true,
  );
});
test("pending read-only request prevents authority changes and cancels without publication work", async (t) => {
  const gate = deferred(),
    f = await fixture(t, { gate });
  const read = f.handlers.get("read-github-metadata")();
  assert.throws(() => f.handlers.get("grant-github-writes")(), /active GitHub/);
  f.handlers.get("cancel-github-read")();
  gate.resolve(true);
  assert.equal((await read).status, "cancelled");
  assert.equal(f.publishing.history.list().length, 0);
});
