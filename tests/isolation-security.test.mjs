import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { IsolationRunner } from "../electron/isolation-runner.mjs";
import { safeFile } from "../electron/isolation-snapshot.mjs";
test("production execution gate never becomes available through configuration or supplied transport", async () => {
  let touched = false;
  const runner = new IsolationRunner({
    config: {
      verifyExecutable: async () => {
        touched = true;
      },
    },
    snapshots: {},
    quarantineRoot: "/unused-fixture",
  });
  assert.equal(runner.status().available, false);
  await assert.rejects(
    runner.run({ recipe: "web-test", transport: { kind: "test-double" } }),
    /unavailable/,
  );
  assert.equal(touched, false);
});
test("changed CLI/image/daemon configuration during consent stops before any test transport call", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "sebby-isolation-review-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let changed = false,
    calls = 0;
  const a = {
    cliPath: "/fixture/docker",
    cliSha256: "a".repeat(64),
    daemonEndpoint: "unix:///var/run/docker.sock",
    image: "fixture/image@sha256:" + "b".repeat(64),
  };
  const runner = new IsolationRunner({
    config: {
      verifyExecutable: async () => ({
        ...a,
        ...(changed ? { image: "other/image@sha256:" + "c".repeat(64) } : {}),
      }),
    },
    snapshots: {
      verify: async () => ({
        id: "fixture",
        directory: "/owned-staged-fixture",
        workspaceRoot: "/project-fixture",
        files: [],
        snapshotHash: "d".repeat(64),
        lockSha256: "e".repeat(64),
      }),
    },
    quarantineRoot: root,
    approve: async () => {
      changed = true;
      return true;
    },
  });
  const result = await runner.runWithTestTransport(
    { snapshotId: "fixture", recipe: "web-test" },
    {
      kind: "test-double",
      execute: async () => {
        calls++;
        throw Error("No transport expected");
      },
    },
  );
  assert.equal(result.status, "blocked-test-double");
  assert.equal(calls, 0);
});
test("artifact/snapshot names cannot spoof review with bidi or zero-width controls", () => {
  for (const value of [
    "src/normal\u202Etxt.js",
    "src/secret\u200B.txt",
    "src/name\u2066.js",
  ])
    assert.throws(() => safeFile(value));
});
