import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installIsolation } from "../electron/isolation-ipc.mjs";
async function fixture(t, { consent = true } = {}) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "sebby-isolation-ipc-"),
  );
  const root = path.join(directory, "project");
  await fs.mkdir(root);
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { build: "unexecuted", test: "unexecuted" } }),
  );
  await fs.writeFile(
    path.join(root, "package-lock.json"),
    JSON.stringify({ lockfileVersion: 3, packages: {} }),
  );
  const handlers = new Map(),
    prompts = [];
  const service = await installIsolation({
    directory,
    workspace: { root },
    register: (name, fn) => handlers.set(name, fn),
    confirm: async (...args) => {
      prompts.push(args);
      return consent;
    },
  });
  t.after(async () => {
    await service.shutdown();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { directory, root, handlers, prompts, service };
}
test("production isolation IPC offers only local preparation, never any runner transport", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(
    [...f.handlers.keys()].sort(),
    [
      "discard-isolation-snapshot",
      "isolation-status",
      "prepare-isolation-snapshot",
      "save-isolation-config",
      "verify-isolation-snapshot",
    ].sort(),
  );
  const status = f.handlers.get("isolation-status")();
  assert.equal(status.available, false);
  assert.equal(status.reason, "native-engine-validation-required");
  assert.equal(status.configuration, null);
});
test("native-approved snapshot uses real copied files, hides staging root, verifies and discards", async (t) => {
  const f = await fixture(t);
  const snapshot = await f.handlers.get("prepare-isolation-snapshot")({
    paths: ["package.json", "package-lock.json"],
  });
  assert.equal(snapshot.files.length, 2);
  assert.equal("directory" in snapshot, false);
  assert.equal("workspaceRoot" in snapshot, false);
  assert.equal(
    (await f.handlers.get("verify-isolation-snapshot")(snapshot.id)).verified,
    true,
  );
  assert.equal(f.handlers.get("isolation-status")().snapshots.length, 1);
  await f.handlers.get("discard-isolation-snapshot")(snapshot.id);
  assert.equal(f.handlers.get("isolation-status")().snapshots.length, 0);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(f.root, "package.json"), "utf8"))
      .scripts.build,
    "unexecuted",
  );
});
test("snapshot denial copies nothing and native shutdown removes session-owned copies", async (t) => {
  const denied = await fixture(t, { consent: false });
  await assert.rejects(
    () =>
      denied.handlers.get("prepare-isolation-snapshot")({
        paths: ["package.json", "package-lock.json"],
      }),
    /declined/,
  );
  assert.equal(denied.handlers.get("isolation-status")().snapshots.length, 0);
  const f = await fixture(t);
  const snapshot = await f.handlers.get("prepare-isolation-snapshot")({
    paths: ["package.json", "package-lock.json"],
  });
  await f.service.shutdown();
  await assert.rejects(
    () =>
      fs.stat(path.join(f.directory, "sebby-isolation-staging", snapshot.id)),
    { code: "ENOENT" },
  );
});
