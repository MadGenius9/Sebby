import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installStudioExport } from "../electron/studio-export.mjs";
const json = new TextEncoder().encode(
  JSON.stringify({ version: 1, name: "Test", parts: [] }),
);
test("Studio export writes only chosen new file, never overwrites", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "studio-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let run;
  const dest = path.join(dir, "scene.json");
  installStudioExport({
    register: (_, f) => (run = f),
    choosePath: async () => dest,
  });
  assert.deepEqual(await run({ format: "json", bytes: json }), { saved: true });
  assert.equal(JSON.parse(await fs.readFile(dest, "utf8")).name, "Test");
  await assert.rejects(run({ format: "json", bytes: json }), {
    code: "EEXIST",
  });
});
test("rejects invalid bytes, extension mismatch and closes before write", async () => {
  let run;
  let selected = 0;
  installStudioExport({
    register: (_, f) => (run = f),
    choosePath: async () => {
      selected++;
      return "scene.exe";
    },
  });
  await assert.rejects(run({ format: "glb", bytes: json }));
  assert.equal(selected, 0);
  await assert.rejects(run({ format: "json", bytes: json }), /filename/);
  installStudioExport({
    register: (_, f) => (run = f),
    choosePath: async () => "/should-not-write.json",
    isClosing: () => true,
  });
  assert.deepEqual(await run({ format: "json", bytes: json }), {
    saved: false,
  });
});
