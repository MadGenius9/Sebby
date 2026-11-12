import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import {
  validateEnvelope,
  parseStrictJson,
  runRecipe,
} from "../native/isolation-image/runner.mjs";
const hash = (x) => createHash("sha256").update(x).digest("hex");
function envelope(extra = []) {
  const contents = [
    {
      path: "package.json",
      bytes: Buffer.from(
        JSON.stringify({
          scripts: {
            build: "UNTRUSTED NEVER EXECUTED IN TEST",
            test: "UNTRUSTED",
          },
        }),
      ),
    },
    {
      path: "package-lock.json",
      bytes: Buffer.from(JSON.stringify({ lockfileVersion: 3, packages: {} })),
    },
    ...extra,
  ].sort((a, b) => (a.path < b.path ? -1 : 1));
  const manifest = contents.map((x) => ({
    path: x.path,
    sha256: hash(x.bytes),
    bytes: x.bytes.length,
  }));
  const expected = {
    recipe: "web-build",
    snapshotHash: hash(JSON.stringify(manifest)),
    lockSha256: manifest.find((x) => x.path === "package-lock.json").sha256,
    wrapperSha256: "f".repeat(64),
  };
  const doc = {
    format: "sebby-snapshot-v1",
    recipe: expected.recipe,
    snapshotHash: expected.snapshotHash,
    lockSha256: expected.lockSha256,
    files: contents.map((x) => ({
      path: x.path,
      base64: x.bytes.toString("base64"),
      sha256: hash(x.bytes),
    })),
  };
  return { text: JSON.stringify(doc), expected, doc, contents };
}
async function setup(t, input = envelope()) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-image-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workRoot = path.join(root, "work"),
    dependencyRoot = path.join(root, "dependencies"),
    cache = path.join(dependencyRoot, input.expected.lockSha256);
  await fs.mkdir(workRoot);
  await fs.mkdir(path.join(cache, "node_modules"), { recursive: true });
  await fs.writeFile(
    path.join(cache, "package-lock.json"),
    input.contents.find((x) => x.path === "package-lock.json").bytes,
  );
  await fs.writeFile(
    path.join(cache, "sebby-cache.json"),
    JSON.stringify({
      format: "sebby-dependency-cache-v1",
      lockSha256: input.expected.lockSha256,
      contractVersion: 1,
    }),
  );
  return { ...input, workRoot, dependencyRoot, cache };
}
test("wrapper import is inert and explicit production entry has pinned paths/no install", async () => {
  const source = (
    await fs.readFile(
      new URL("../native/isolation-image/runner.mjs", import.meta.url),
      "utf8",
    )
  ).replace(/\s+/g, "");
  assert.match(
    source,
    /pathToFileURL\(path.resolve\(process.argv\[1\]\)\).href===import.meta.url/,
  );
  assert.match(source, /--reviewed-container-wrapper/);
  assert.match(source, /process.getuid\?\.\(\)!==65532/);
  assert.doesNotMatch(source, /['"](?:install|ci)['"]/);
  assert.match(source, /shell:false/);
});
test("validated JSON rejects duplicate/prototype keys, canonical mismatch, traversal and unicode collisions", () => {
  for (const text of [
    '{"a":1,"a":2}',
    '{"__proto__":{}}',
    '{"x":{"constructor":1}}',
  ])
    assert.throws(() => parseStrictJson(text));
  const input = envelope();
  assert.equal(validateEnvelope(input.text, input.expected).script, "build");
  assert.throws(() =>
    validateEnvelope(input.text, {
      ...input.expected,
      lockSha256: "a".repeat(64),
    }),
  );
  for (const name of ["../x.js", "a/\u202ex.js", "node_modules/x.js"]) {
    const x = envelope([{ path: name, bytes: Buffer.from("x") }]);
    assert.throws(() => validateEnvelope(x.text, x.expected));
  }
  const collision = envelope([
    { path: "\u00e9.js", bytes: Buffer.from("x") },
    { path: "e\u0301.js", bytes: Buffer.from("y") },
  ]);
  assert.throws(() => validateEnvelope(collision.text, collision.expected));
  input.doc.files[0].base64 += "\n";
  assert.throws(() =>
    validateEnvelope(JSON.stringify(input.doc), input.expected),
  );
});
test("no files materialized or executor called for invalid payload/cache", async (t) => {
  const data = await setup(t);
  let called = false;
  await fs.writeFile(path.join(data.cache, "package-lock.json"), "changed");
  await assert.rejects(
    runRecipe({
      ...data,
      executor: async () => {
        called = true;
      },
    }),
    /lock mismatch/,
  );
  assert.equal(called, false);
  assert.deepEqual(await fs.readdir(data.workRoot), []);
});
test("benign injected executor receives fixed scrubbed command and returns bounded regular artifacts", async (t) => {
  if (process.platform === "win32") {
    t.skip("Linux image recipe uses POSIX symlinks; requires Linux validation");
    return;
  }
  const data = await setup(t);
  const result = await runRecipe({
    ...data,
    executor: async (request) => {
      assert.equal(request.executable, "/usr/local/bin/node");
      assert.deepEqual(request.args, [
        "/usr/local/lib/node_modules/npm/bin/npm-cli.js",
        "run",
        "build",
        "--offline",
        "--ignore-scripts",
      ]);
      assert.equal(request.environment.NODE_OPTIONS, undefined);
      assert.equal(request.environment.OPENAI_API_KEY, undefined);
      assert.equal(
        request.environment.NPM_CONFIG_USERCONFIG,
        "/opt/sebby/empty-npmrc",
      );
      assert.equal(
        await fs.readFile(path.join(request.cwd, "package.json"), "utf8"),
        data.contents.find((x) => x.path === "package.json").bytes.toString(),
      );
      await fs.mkdir(path.join(request.cwd, "dist"));
      await fs.writeFile(
        path.join(request.cwd, "dist", "index.html"),
        "<h1>fixture only</h1>",
      );
      return { exitCode: 0, logs: "fake executor, not npm" };
    },
  });
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.wrapperSha256, data.expected.wrapperSha256);
  assert.equal(result.contractVersion, 1);
  assert.deepEqual(await fs.readdir(data.workRoot), []);
});
test("artifact links and extra protocol fields rejected; project cleanup still occurs", async (t) => {
  if (process.platform === "win32") {
    t.skip("Linux image recipe uses POSIX symlinks; requires Linux validation");
    return;
  }
  const data = await setup(t);
  await assert.rejects(
    runRecipe({
      ...data,
      executor: async (request) => {
        await fs.mkdir(path.join(request.cwd, "dist"));
        await fs.symlink(
          path.join(data.cache, "package-lock.json"),
          path.join(request.cwd, "dist", "leak.json"),
        );
        return { exitCode: 0, logs: "" };
      },
    }),
    /links/,
  );
  assert.deepEqual(await fs.readdir(data.workRoot), []);
  await assert.rejects(
    runRecipe({
      ...data,
      executor: async () => ({ exitCode: 0, logs: "", command: "unexpected" }),
    }),
    /fields/,
  );
});
test("cancelled/nonzero fake execution exports no artifacts and cache remains unchanged", async (t) => {
  if (process.platform === "win32") {
    t.skip("Linux image recipe uses POSIX symlinks; requires Linux validation");
    return;
  }
  const data = await setup(t),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runRecipe({
      ...data,
      signal: controller.signal,
      executor: () => {
        throw Error("must not run");
      },
    }),
    /Cancelled/,
  );
  const result = await runRecipe({
    ...data,
    executor: async () => ({ exitCode: 2, logs: "fake failure" }),
  });
  assert.equal(result.exitCode, 2);
  assert.deepEqual(result.artifacts, []);
  assert.equal(
    hash(await fs.readFile(path.join(data.cache, "package-lock.json"))),
    data.expected.lockSha256,
  );
});
