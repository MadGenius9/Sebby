import test from "./platform-test.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { IsolationConfig, hash } from "../electron/isolation-config.mjs";
import { WorkspaceSnapshot } from "../electron/isolation-snapshot.mjs";
import {
  IsolationRunner,
  imageContract,
} from "../electron/isolation-runner.mjs";
async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-isolation-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, "project");
  await fs.mkdir(workspace);
  await fs.writeFile(
    path.join(workspace, "package.json"),
    JSON.stringify({ scripts: { build: "test", test: "test" } }),
  );
  await fs.writeFile(
    path.join(workspace, "package-lock.json"),
    JSON.stringify({ lockfileVersion: 3, packages: {} }),
  );
  await fs.writeFile(path.join(workspace, "index.html"), "<h1>fixture</h1>");
  const cli = path.join(
    root,
    process.platform === "win32" ? "docker.exe" : "docker",
  );
  await fs.writeFile(cli, "not executable: fixture only");
  const config = new IsolationConfig(path.join(root, "data"), {
    approve: async () => true,
  });
  await config.load();
  const input = {
    cliPath: cli,
    cliSha256: hash(await fs.readFile(cli)),
    daemonEndpoint: "unix:///var/run/docker.sock",
    image: "example/sebby@sha256:" + "a".repeat(64),
  };
  await config.save(input);
  const snapshots = new WorkspaceSnapshot({
    stagingRoot: path.join(root, "staging"),
    approve: async () => true,
  });
  const runner = new IsolationRunner({
    config,
    snapshots,
    quarantineRoot: path.join(root, "quarantine"),
    approve: async () => true,
  });
  return { root, workspace, config, input, snapshots, runner };
}
const paths = ["package.json", "package-lock.json", "index.html"];
function mock(snapshot, overrides = {}) {
  const calls = [];
  let name, nonce, image;
  const id = "c".repeat(64);
  return {
    kind: "test-double",
    calls,
    execute: async (request) => {
      calls.push(request);
      const contract = await imageContract();
      const args = request.args.slice(4),
        verb = args[0];
      const ok = (stdout) => ({ exitCode: 0, stdout, stderr: "" });
      if (overrides.execute) {
        const value = await overrides.execute(verb, request);
        if (value) return value;
      }
      if (verb === "image")
        return ok(
          JSON.stringify({
            RepoDigests: [request.args.at(-1)],
            Config: {
              Labels: {
                "dev.sebby.wrapper-sha256": contract.wrapperSha256,
                "dev.sebby.contract-version": "1",
              },
            },
          }),
        );
      if (verb === "create") {
        name = args[args.indexOf("--name") + 1];
        nonce = args[args.indexOf("--label") + 1].split("=")[1];
        image = args.find((x) => x.includes("@sha256:"));
        return ok(id);
      }
      if (verb === "inspect")
        return ok(
          JSON.stringify({
            Id: id,
            State: { Running: false },
            Name: "/" + name,
            Config: {
              Image: image,
              Labels: {
                "dev.sebby.operation": overrides.wrongOwner ? "wrong" : nonce,
                "dev.sebby.wrapper-sha256": contract.wrapperSha256,
                "dev.sebby.contract-version": "1",
              },
            },
          }),
        );
      if (verb === "start") {
        const bytes = Buffer.from("<h1>build</h1>");
        return ok(
          JSON.stringify({
            format: "sebby-isolated-web-v1",
            contractVersion: 1,
            wrapperSha256: contract.wrapperSha256,
            recipe: "web-build",
            snapshotHash: snapshot.snapshotHash,
            lockSha256: snapshot.lockSha256,
            exitCode: 0,
            logs: "fixture output",
            artifacts: overrides.artifacts ?? [
              {
                path: "index.html",
                base64: bytes.toString("base64"),
                sha256: hash(bytes),
              },
            ],
          }),
        );
      }
      if (verb === "wait") return ok("0");
      if (verb === "rm") return ok(id);
      throw Error("Unexpected call");
    },
  };
}
test("configuration defaults unavailable, strict approved identity only, no enable flag", async (t) => {
  const { root, input } = await setup(t);
  const a = new IsolationConfig(path.join(root, "other"));
  assert.equal((await a.load()).configuration, null);
  assert.equal((await a.save(input)).approved, false);
  assert.equal(a.get().available, false);
  assert.throws(() => a.save({ ...input, enabled: true }));
  assert.throws(() =>
    a.save({ ...input, daemonEndpoint: "tcp://remote:2375" }),
  );
  assert.throws(() => a.save({ ...input, image: "example/sebby:latest" }));
  await fs.writeFile(
    path.join(root, "other", "sebby-isolation.json"),
    "{invalid",
  );
  await assert.rejects(a.load(), /preserved/);
});
test("snapshot is real bounded copy, no writable project changes and detects edits", async (t) => {
  const { workspace, snapshots } = await setup(t);
  const snap = await snapshots.prepare(workspace, paths);
  assert.equal(
    await fs.readFile(path.join(snap.directory, "index.html"), "utf8"),
    "<h1>fixture</h1>",
  );
  assert.deepEqual((await fs.readdir(workspace)).sort(), [...paths].sort());
  await snapshots.verify(snap.id);
  await fs.chmod(path.join(snap.directory, "index.html"), 0o600);
  await fs.writeFile(path.join(snap.directory, "index.html"), "changed");
  await assert.rejects(snapshots.verify(snap.id), /changed/);
});
test("snapshot rejects secrets, traversal, case collisions, links and staging inside project", async (t) => {
  const { workspace, snapshots } = await setup(t);
  for (const p of [".env", "../secret", "node_modules/x.js", "secrets.json"])
    await assert.rejects(snapshots.prepare(workspace, [...paths, p]));
  await assert.rejects(
    snapshots.prepare(workspace, [...paths, "INDEX.HTML"]),
    /Duplicate/,
  );
  await fs.symlink(
    path.join(workspace, "index.html"),
    path.join(workspace, "link.html"),
  );
  await assert.rejects(
    snapshots.prepare(workspace, [...paths, "link.html"]),
    /Symlink/,
  );
  const inside = new WorkspaceSnapshot({
    stagingRoot: path.join(workspace, "forbidden"),
    approve: async () => true,
  });
  await assert.rejects(inside.prepare(workspace, paths), /outside/);
  await assert.rejects(fs.stat(path.join(workspace, "forbidden")));
});
test("changed source after native preparation consent is not staged", async (t) => {
  const { root, workspace } = await setup(t);
  const snapshots = new WorkspaceSnapshot({
    stagingRoot: path.join(root, "second"),
    approve: async () => {
      await fs.writeFile(path.join(workspace, "index.html"), "modified");
      return true;
    },
  });
  await assert.rejects(snapshots.prepare(workspace, paths), /changed/);
});
test("production run cannot execute and fake transport has hardened fixed lifecycle", async (t) => {
  const { workspace, snapshots, runner } = await setup(t);
  await assert.rejects(runner.run({}), /unavailable/);
  const snap = await snapshots.prepare(workspace, paths),
    transport = mock(snap);
  const result = await runner.runWithTestTransport(
    { snapshotId: snap.id, recipe: "web-build" },
    transport,
  );
  assert.equal(result.status, "completed-test-double");
  assert.equal(result.nativeExecutionVerified, false);
  assert.equal(result.cleanupVerified, true);
  assert.equal(result.artifacts.reviewRequired, true);
  const create = transport.calls.find((x) => x.args[4] === "create");
  for (const flag of [
    "--pull=never",
    "--network=none",
    "--read-only",
    "--user=65532:65532",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true",
    "--pids-limit=64",
    "--memory=512m",
  ])
    assert.ok(create.args.includes(flag));
  assert.ok(
    !create.args.some(
      (x) => x === "--mount" || x === "--volume" || x.includes(snap.directory),
    ),
  );
  const attached = transport.calls.find((x) => x.args[4] === "start");
  assert.ok(attached.args.includes("--interactive"));
  assert.equal(JSON.parse(attached.stdin).snapshotHash, snap.snapshotHash);
  assert.ok(!create.args.some((x) => x.includes("src=" + workspace)));
  assert.deepEqual(create.environment, {});
  assert.equal(transport.calls.at(-1).args[4], "rm");
  assert.equal(
    await fs.readFile(path.join(workspace, "index.html"), "utf8"),
    "<h1>fixture</h1>",
  );
});
test("ownership mismatch never starts or removes an unrelated container", async (t) => {
  const { workspace, snapshots, runner } = await setup(t);
  const snap = await snapshots.prepare(workspace, paths),
    transport = mock(snap, { wrongOwner: true });
  const result = await runner.runWithTestTransport(
    { snapshotId: snap.id, recipe: "web-build" },
    transport,
  );
  assert.equal(result.status, "uncertain-test-double");
  assert.equal(result.cleanupRequired, true);
  assert.ok(!transport.calls.some((x) => ["start", "rm"].includes(x.args[4])));
});
test("malformed and case-colliding artifacts never reach quarantine", async (t) => {
  for (const artifacts of [
    [{ path: "../escape.js", base64: "eA==", sha256: hash("x") }],
    [{ path: "x.js", base64: "eA==", sha256: hash("x"), type: "symlink" }],
    [
      { path: "a.js", base64: "eA==", sha256: hash("x") },
      { path: "A.js", base64: "eA==", sha256: hash("x") },
    ],
  ]) {
    const { root, workspace, snapshots, runner } = await setup(t);
    const snap = await snapshots.prepare(workspace, paths);
    const result = await runner.runWithTestTransport(
      { snapshotId: snap.id, recipe: "web-build" },
      mock(snap, { artifacts }),
    );
    assert.equal(result.status, "uncertain-test-double");
    assert.ok(
      !(await fs.readdir(path.join(root, "quarantine"))).some((x) =>
        x.startsWith("artifacts-"),
      ),
    );
  }
});
test("cancellation while transport pending cleans only verified owned container", async (t) => {
  const { workspace, snapshots, runner } = await setup(t),
    controller = new AbortController();
  const snap = await snapshots.prepare(workspace, paths),
    transport = mock(snap, {
      execute: async (verb) => {
        if (verb === "start") {
          controller.abort();
          return new Promise(() => {});
        }
      },
    });
  const result = await runner.runWithTestTransport(
    { snapshotId: snap.id, recipe: "web-build", signal: controller.signal },
    transport,
  );
  assert.equal(result.error, "cancelled");
  assert.equal(result.cleanupVerified, true);
  assert.equal(runner.status().active, false);
});
test("shutdown during pending consent prevents any transport calls", async (t) => {
  const { workspace, snapshots, runner } = await setup(t);
  const snap = await snapshots.prepare(workspace, paths),
    transport = mock(snap);
  runner.approve = async () => {
    await runner.shutdown();
    return true;
  };
  const result = await runner.runWithTestTransport(
    { snapshotId: snap.id, recipe: "web-build" },
    transport,
  );
  assert.equal(result.status, "cancelled-test-double");
  assert.equal(transport.calls.length, 0);
});
test("hardlinks and excess snapshot file count are rejected; isolation authority is not restorable", async (t) => {
  const { workspace, snapshots } = await setup(t);
  await fs.link(
    path.join(workspace, "index.html"),
    path.join(workspace, "hard.html"),
  );
  await assert.rejects(snapshots.prepare(workspace, paths), /path type/);
  await assert.rejects(
    snapshots.prepare(
      workspace,
      Array.from({ length: 101 }, (_, i) => `${i}.js`),
    ),
    /1–100/,
  );
  const { BACKUP_FILES } = await import("../electron/backup.mjs");
  assert.ok(!BACKUP_FILES.includes("sebby-isolation.json"));
});
test("changed executable and denied consent prevent transport invocation", async (t) => {
  const { workspace, snapshots, runner, input } = await setup(t);
  const snap = await snapshots.prepare(workspace, paths),
    transport = mock(snap);
  await fs.writeFile(input.cliPath, "replaced");
  let result = await runner.runWithTestTransport(
    { snapshotId: snap.id, recipe: "web-build" },
    transport,
  );
  assert.equal(result.status, "blocked-test-double");
  assert.equal(transport.calls.length, 0);
  await fs.writeFile(input.cliPath, "not executable: fixture only");
  runner.approve = async () => false;
  result = await runner.runWithTestTransport(
    { snapshotId: snap.id, recipe: "web-build" },
    transport,
  );
  assert.equal(result.status, "blocked-test-double");
  assert.equal(transport.calls.length, 0);
});
test("unverified partial create is uncertain and does not delete by guessed identity", async (t) => {
  const { workspace, snapshots, runner } = await setup(t),
    snap = await snapshots.prepare(workspace, paths),
    transport = mock(snap, {
      execute: async (verb) =>
        verb === "create"
          ? { exitCode: 0, stdout: "bad-id", stderr: "" }
          : null,
    });
  const result = await runner.runWithTestTransport(
    { snapshotId: snap.id, recipe: "web-build" },
    transport,
  );
  assert.equal(result.status, "uncertain-test-double");
  assert.equal(result.cleanupRequired, true);
  assert.equal(transport.calls.length, 2);
});
test("configuration change during native consent cannot invoke an older approved CLI or image", async (t) => {
  const { workspace, snapshots, runner, config, input } = await setup(t),
    snap = await snapshots.prepare(workspace, paths),
    transport = mock(snap);
  runner.approve = async () => {
    await config.save({
      ...input,
      image: "example/other@sha256:" + "b".repeat(64),
    });
    return true;
  };
  const result = await runner.runWithTestTransport(
    { snapshotId: snap.id, recipe: "web-build" },
    transport,
  );
  assert.equal(result.status, "blocked-test-double");
  assert.equal(transport.calls.length, 0);
});
test("bidi and zero-width file paths cannot mislead snapshot review", async (t) => {
  const { workspace, snapshots } = await setup(t);
  for (const name of ["src/\u202eevil.js", "src/a\u200bb.js", "src/\ufeffx.js"])
    await assert.rejects(
      snapshots.prepare(workspace, [...paths, name]),
      /Unsupported/,
    );
});
test("three-snapshot retention cap includes stale directories without restoring authority", async (t) => {
  const { workspace, snapshots } = await setup(t);
  for (let i = 0; i < 3; i++) await snapshots.prepare(workspace, paths);
  await assert.rejects(snapshots.prepare(workspace, paths), /retention/);
  const restarted = new WorkspaceSnapshot({
    stagingRoot: snapshots.root,
    approve: async () => true,
  });
  await assert.rejects(restarted.prepare(workspace, paths), /retention/);
  assert.equal(restarted.items.size, 0);
  await snapshots.shutdown();
  assert.equal((await fs.readdir(snapshots.root)).length, 0);
});
test("shutdown during preparation consent prevents late staging then drains known snapshots", async (t) => {
  const { workspace, snapshots } = await setup(t);
  let resolveConsent, entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  snapshots.approve = () => {
    entered();
    return new Promise((resolve) => {
      resolveConsent = resolve;
    });
  };
  const preparing = snapshots.prepare(workspace, paths);
  await ready;
  const shutdown = snapshots.shutdown();
  resolveConsent(true);
  await assert.rejects(preparing, /closed/);
  await shutdown;
  assert.equal((await fs.readdir(snapshots.root)).length, 0);
  await assert.rejects(snapshots.prepare(workspace, paths), /closed/);
});
