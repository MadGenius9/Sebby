import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../electron/services.mjs";
import { DevelopmentTools, contentHash } from "../electron/development.mjs";
async function fixture(t, approve = async () => true, options = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-dev-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, "project");
  await fs.mkdir(root);
  const workspace = new Workspace();
  await workspace.select(root);
  return {
    root,
    base,
    workspace,
    dev: new DevelopmentTools(workspace, {
      backupRoot: path.join(base, "backups"),
      approve,
      ...options,
    }),
  };
}
test("preview writes nothing; approval applies with backup and independently approved undo", async (t) => {
  const approvals = [];
  const { root, base, dev } = await fixture(t, async (p) => {
    approvals.push(p.kind);
    return true;
  });
  await fs.writeFile(path.join(root, "app.js"), "old");
  const p = await dev.previewEdit({
    path: "app.js",
    content: "new",
    expectedHash: contentHash("old"),
  });
  assert.equal(await fs.readFile(path.join(root, "app.js"), "utf8"), "old");
  assert.match(p.diff.text, /-old\n\+new/);
  assert.equal((await dev.applyProposal(p.id)).applied, true);
  assert.equal(
    await fs.readFile(path.join(base, "backups", `${p.id}.original`), "utf8"),
    "old",
  );
  assert.equal(await fs.readFile(path.join(root, "app.js"), "utf8"), "new");
  await dev.undo(p.id);
  assert.equal(await fs.readFile(path.join(root, "app.js"), "utf8"), "old");
  assert.deepEqual(approvals, ["apply-edit", "undo-edit"]);
});
test("denied proposal does not write and returned proposal mutation cannot alter apply", async (t) => {
  const { root, dev } = await fixture(t, async () => false);
  const p = await dev.previewEdit({ path: "new.md", content: "hello" });
  p.path = "../escape.md";
  assert.deepEqual(await dev.applyProposal(p.id), { applied: false });
  assert.deepEqual(await fs.readdir(root), []);
});
test("stale preview and changes during approval refuse overwrite", async (t) => {
  let root;
  const f = await fixture(t, async () => {
    await fs.writeFile(path.join(root, "app.js"), "intervening");
    return true;
  });
  root = f.root;
  await fs.writeFile(path.join(root, "app.js"), "old");
  await assert.rejects(
    f.dev.previewEdit({
      path: "app.js",
      content: "new",
      expectedHash: contentHash("stale"),
    }),
  );
  const p = await f.dev.previewEdit({ path: "app.js", content: "new" });
  await assert.rejects(f.dev.applyProposal(p.id), /target changed/);
  assert.equal(
    await fs.readFile(path.join(root, "app.js"), "utf8"),
    "intervening",
  );
});
test("undo refuses post-edit changes; create undo deletes only unchanged created file", async (t) => {
  const { root, dev } = await fixture(t);
  const p = await dev.previewEdit({
    path: "new.md",
    content: "hello",
    expectedHash: null,
  });
  await dev.applyProposal(p.id);
  await fs.writeFile(path.join(root, "new.md"), "changed");
  await assert.rejects(dev.undo(p.id), /target changed/);
  assert.equal(await fs.readFile(path.join(root, "new.md"), "utf8"), "changed");
  const p2 = await dev.previewEdit({ path: "second.md", content: "hello" });
  await dev.applyProposal(p2.id);
  await dev.undo(p2.id);
  await assert.rejects(fs.stat(path.join(root, "second.md")), {
    code: "ENOENT",
  });
});
test("edit rejects traversal, symlinks and nested creates; proposal count bounded", async (t) => {
  const { root, base, dev } = await fixture(t);
  await fs.writeFile(path.join(base, "outside.md"), "outside");
  await fs.symlink(path.join(base, "outside.md"), path.join(root, "link.md"));
  for (const file of [
    "../outside.md",
    "link.md",
    "src/new.js",
    ".env",
    "credentials.json",
  ])
    await assert.rejects(dev.previewEdit({ path: file, content: "x" }));
  for (let i = 0; i < 10; i++)
    await dev.previewEdit({ path: `p${i}.md`, content: "x" });
  await assert.rejects(
    dev.previewEdit({ path: "overflow.md", content: "x" }),
    /Discard/,
  );
});
test("command plans expose lifecycle scripts, no executables configured by default", async (t) => {
  const { root, dev } = await fixture(t);
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: {
        test: "node test.js",
        pretest: "echo before",
        posttest: "echo after",
      },
    }),
  );
  const p = await dev.planCommand("npm-test");
  assert.equal(p.scripts.pretest, "echo before");
  assert.match(p.warning, /arbitrary/);
  assert.equal(p.approvalDigest.length, 64);
  await assert.rejects(
    dev.runCommand(p.id),
    /not configured|Windows is disabled/,
  );
  await assert.rejects(dev.planCommand("rm -rf /"), /not allowlisted/);
});
test("commands require fresh script digest after native approval", async (t) => {
  let root;
  const node = await fs.realpath(process.execPath);
  const f = await fixture(
    t,
    async () => {
      await fs.writeFile(
        path.join(root, "package.json"),
        JSON.stringify({ scripts: { test: "changed" } }),
      );
      return true;
    },
    { executables: { node, npmCli: node } },
  );
  root = f.root;
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { test: "original" } }),
  );
  const p = await f.dev.planCommand("npm-test");
  await assert.rejects(
    f.dev.runCommand(p.id),
    /scripts changed|Windows is disabled/,
  );
});
test("fixed command runner captures bounded output and times out only temp fixture child", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX fixture process groups");
    return;
  }
  const node = await fs.realpath(process.execPath);
  const { root, base, dev } = await fixture(t, async () => true, {
    timeoutMs: 150,
    executables: { node },
  });
  const cli = path.join(base, "fixture-cli.js");
  await fs.writeFile(
    cli,
    "process.stdout.write('x'.repeat(200000));setInterval(()=>{},1000)",
  );
  dev.executables.npmCli = cli;
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { test: "fixture only" } }),
  );
  const p = await dev.planCommand("npm-test");
  const run = dev.startCommand(p.id);
  assert.equal(run.id, p.id);
  const result = await run.completion;
  assert.equal(result.timedOut, true);
  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(result.output) <= 128 * 1024);
  assert.equal(dev.getRuns()[0].status, "finished");
});
test("command cancellation kills only spawned fixture group", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX fixture process groups");
    return;
  }
  const node = await fs.realpath(process.execPath);
  const { root, base, dev } = await fixture(t, async () => true, {
    executables: { node },
  });
  const cli = path.join(base, "fixture-cli.js");
  await fs.writeFile(cli, "setInterval(()=>{},1000)");
  dev.executables.npmCli = cli;
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { test: "fixture only" } }),
  );
  const p = await dev.planCommand("npm-test");
  const run = dev.startCommand(p.id);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(dev.cancelCommand(run.id), true);
  assert.equal((await run.completion).cancelled, true);
});
