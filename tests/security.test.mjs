import test from "./platform-test.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  Workspace,
  Store,
  validateRelative,
  validateNote,
  validatePersonality,
  MAX_TEXT_BYTES,
} from "../electron/services.mjs";
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test("reject traversal, absolute, windows drive/UNC, hidden and sensitive paths", () => {
  for (const input of [
    "../a.md",
    "/tmp/a.md",
    "C:/a.md",
    "\\\\server\\a.md",
    "a/../../b.md",
    "a\\b.md",
    ".env",
    ".git/config",
    "secrets.json",
    "api-key.txt",
    "a//b.md",
    "a/./b.md",
    "a.md\0",
    "file.exe",
    "node_modules/a.js",
  ])
    assert.throws(() => validateRelative(input), input);
  assert.deepEqual(validateRelative("src/App.tsx"), ["src", "App.tsx"]);
});
test("validate notes and bounded settings", () => {
  for (const name of [
    "../x.md",
    "a/b.md",
    "CON.txt",
    "NUL.md",
    "file.js",
    ".env",
    "api-key.txt",
  ])
    assert.throws(() => validateNote({ name, content: "" }));
  assert.throws(() =>
    validateNote({ name: "note.md", content: "a".repeat(MAX_TEXT_BYTES + 1) }),
  );
  assert.throws(() => validatePersonality({ warmth: "evil", humor: true }));
  assert.deepEqual(validateNote({ name: "Build plan.md", content: "Hello" }), {
    name: "Build plan.md",
    content: "Hello",
  });
});
test("workspace requires selection, lists source, reads text and never overwrites", async (t) => {
  const root = await fixture(t);
  const ws = new Workspace();
  await assert.rejects(ws.read("note.md"));
  await assert.rejects(ws.create({ name: "note.md", content: "" }));
  await ws.select(root);
  await ws.create({ name: "note.md", content: "first" });
  await assert.rejects(ws.create({ name: "note.md", content: "replacement" }), {
    code: "EEXIST",
  });
  assert.deepEqual(await ws.read("note.md"), {
    path: "note.md",
    content: "first",
  });
  await fs.writeFile(path.join(root, ".env"), "SECRET");
  await fs.writeFile(path.join(root, "binary.txt"), Buffer.from([0, 255]));
  await fs.writeFile(
    path.join(root, "large.txt"),
    "a".repeat(MAX_TEXT_BYTES + 1),
  );
  assert.deepEqual(
    (await ws.list()).map((f) => f.path),
    ["binary.txt", "note.md"],
  );
  await assert.rejects(ws.read("binary.txt"));
  await assert.rejects(ws.read("large.txt"));
});
test("reject linked files and linked directory escapes", async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  const ws = new Workspace();
  await ws.select(root);
  await fs.writeFile(path.join(outside, "outside.md"), "private");
  await fs.symlink(
    path.join(outside, "outside.md"),
    path.join(root, "link.md"),
  );
  await fs.symlink(outside, path.join(root, "linked"), "dir");
  await assert.rejects(ws.read("link.md"));
  await assert.rejects(ws.read("linked/outside.md"));
  assert.deepEqual(await ws.list(), []);
});
test("store persists isolated project memories and serializes concurrent saves", async (t) => {
  const root = await fixture(t);
  const store = new Store(root);
  await store.load();
  await Promise.all([
    store.saveMemory("/project/a", "A"),
    store.saveMemory("/project/b", "B"),
    store.savePersonality({ warmth: "warm", humor: false }, null),
  ]);
  const loaded = new Store(root);
  await loaded.load();
  assert.equal(loaded.state("/project/a").memory, "A");
  assert.equal(loaded.state("/project/b").memory, "B");
  assert.equal(loaded.state(null).memory, "");
  assert.equal(loaded.state(null).personality.humor, false);
  assert.equal(loaded.state(null).provider.status, "not-configured");
});
test("corrupt persisted state is not silently overwritten", async (t) => {
  const root = await fixture(t);
  const file = path.join(root, "sebby-state.json");
  await fs.writeFile(file, "{broken");
  const store = new Store(root);
  await assert.rejects(store.load(), /not been overwritten/);
  assert.equal(await fs.readFile(file, "utf8"), "{broken");
});

test("renderer resource policy blocks remote and outside local files", async (t) => {
  const { allowedResource } = await import("../electron/resource-policy.mjs");
  const { pathToFileURL } = await import("node:url");
  const root = await fixture(t);
  const outside = await fixture(t);
  await fs.writeFile(path.join(root, "index.html"), "<html/>");
  await fs.writeFile(path.join(outside, "private.txt"), "private");
  assert.equal(
    await allowedResource(
      pathToFileURL(path.join(root, "index.html")).href,
      root,
    ),
    true,
  );
  assert.equal(
    await allowedResource(
      pathToFileURL(path.join(outside, "private.txt")).href,
      root,
    ),
    false,
  );
  await fs.symlink(
    path.join(outside, "private.txt"),
    path.join(root, "linked.txt"),
  );
  assert.equal(
    await allowedResource(
      pathToFileURL(path.join(root, "linked.txt")).href,
      root,
    ),
    false,
  );
  for (const url of [
    "https://example.com",
    "http://127.0.0.1:5173/",
    "http://localhost:5173/",
    "ftp://example.com/",
    "bad-url",
  ])
    assert.equal(await allowedResource(url, root), false);
  assert.equal(
    await allowedResource("http://127.0.0.1:5173/", root, true),
    true,
  );
  assert.equal(
    await allowedResource("http://127.0.0.1:5174/", root, true),
    false,
  );
  assert.equal(
    await allowedResource("http://127.0.0.1:5173.evil.com/", root, true),
    false,
  );
});
test("workspace replacement by a symlink is rejected before enumeration", async (t) => {
  const parent = await fixture(t);
  const outside = await fixture(t);
  const root = path.join(parent, "project");
  await fs.mkdir(root);
  const ws = new Workspace();
  await ws.select(root);
  await fs.rmdir(root);
  await fs.symlink(outside, root, "dir");
  await assert.rejects(ws.list(), /workspace changed/);
  await assert.rejects(
    ws.create({ name: "note.md", content: "test" }),
    /workspace changed/,
  );
});
test("Windows reserved device names with spaces are denied", () => {
  for (const name of ["CON .txt", "NUL  .md", "LPT1 .txt", "COM9.md"])
    assert.throws(() => validateNote({ name, content: "" }));
});

test("settings refuse linked state and never follow predictable temporary symlinks", async (t) => {
  const root = await fixture(t),
    outside = await fixture(t);
  const external = path.join(outside, "private.json");
  await fs.writeFile(
    external,
    JSON.stringify({
      version: 1,
      memories: { global: "private" },
      personality: { warmth: "balanced", humor: true },
    }),
  );
  await fs.symlink(external, path.join(root, "sebby-state.json"));
  await assert.rejects(new Store(root).load(), /not been overwritten/);
  await fs.unlink(path.join(root, "sebby-state.json"));
  await fs.symlink(external, path.join(root, "sebby-state.json.tmp"));
  const store = new Store(root);
  await store.load();
  await store.saveMemory(null, "local");
  assert.match(await fs.readFile(external, "utf8"), /private/);
  assert.equal(store.state(null).memory, "local");
});

test("workspace scan bounds total entries including unsupported files and closes directory handles", async (t) => {
  const root = await fixture(t);
  for (let i = 0; i < 12; i++)
    await fs.writeFile(path.join(root, `unsupported${i}.bin`), "x");
  const ws = new Workspace({ scanLimit: 3 });
  await ws.select(root);
  const original = fs.opendir;
  let reads = 0,
    open = 0;
  fs.opendir = async (...args) => {
    const handle = await original(...args);
    open++;
    return {
      read: async () => {
        reads++;
        return handle.read();
      },
      close: async () => {
        try {
          return await handle.close();
        } finally {
          open--;
        }
      },
    };
  };
  try {
    assert.deepEqual(await ws.list(), []);
    assert.equal(reads, 3);
    assert.equal(open, 0);
  } finally {
    fs.opendir = original;
  }
  assert.equal(new Workspace({ scanLimit: 999999 }).scanLimit, 5000);
});
test("workspace scan bounds empty directory traversal and returns sorted results", async (t) => {
  const root = await fixture(t);
  for (let i = 0; i < 8; i++) await fs.mkdir(path.join(root, `empty${i}`));
  const ws = new Workspace({ scanLimit: 3 });
  await ws.select(root);
  const original = fs.opendir;
  let opened = 0,
    open = 0;
  fs.opendir = async (...args) => {
    const handle = await original(...args);
    opened++;
    open++;
    return {
      read: () => handle.read(),
      close: async () => {
        try {
          return await handle.close();
        } finally {
          open--;
        }
      },
    };
  };
  try {
    assert.deepEqual(await ws.list(), []);
    assert.ok(opened <= 4);
    assert.equal(open, 0);
  } finally {
    fs.opendir = original;
  }
  await fs.writeFile(path.join(root, "z.md"), "z");
  await fs.writeFile(path.join(root, "a.md"), "a");
  const full = new Workspace();
  await full.select(root);
  assert.deepEqual(
    (await full.list()).map((x) => x.path),
    ["a.md", "z.md"],
  );
});
