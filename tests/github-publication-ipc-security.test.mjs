import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { installGitHub } from "../electron/github-ipc.mjs";
import { installGitHubPublishing } from "../electron/github-publish-ipc.mjs";
test("pending publication authority consent locks read config/token mutations and shutdown denies late grant", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "sebby-publish-ipc-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const handlers = new Map();
  let publishing, approve;
  const register = (name, fn) => handlers.set(name, fn);
  const confirm = () => new Promise((resolve) => (approve = resolve));
  const github = await installGitHub({
    directory,
    safeStorage: { isEncryptionAvailable: () => false },
    register,
    confirm,
    isExternalBusy: () => publishing?.isBusy() || false,
    onConfigurationChanged: () => publishing?.clearCache(),
  });
  publishing = await installGitHubPublishing({
    directory,
    workspace: { root: "/fixture" },
    github,
    register,
    confirm,
    publisherOptions: {
      transport: () => {
        throw Error("No network authorized by this test");
      },
    },
  });
  await handlers.get("save-github-config")({
    owner: "fixture-owner",
    repo: "fixture-repo",
    ref: "main",
    useToken: false,
  });
  const grant = handlers.get("grant-github-writes")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(publishing.isBusy(), true);
  assert.equal(github.isBusy(), true);
  assert.throws(
    () =>
      handlers.get("save-github-config")({
        owner: "other",
        repo: "other",
        ref: "main",
        useToken: false,
      }),
    /active GitHub/,
  );
  assert.throws(
    () =>
      handlers.get("save-github-token")({ token: "SYNTHETIC_TOKEN_NOT_REAL" }),
    /active GitHub/,
  );
  assert.throws(
    () => handlers.get("prepare-github-publication")({}),
    /active GitHub/,
  );
  const stopping = publishing.shutdown();
  approve(true);
  await stopping;
  assert.equal((await grant).approved, false);
  assert.equal(
    publishing.permissions.isAllowed({
      owner: "fixture-owner",
      repo: "fixture-repo",
    }),
    false,
  );
  assert.throws(() => handlers.get("grant-github-writes")(), /closing/);
});
