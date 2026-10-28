import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AppearanceStore,
  PAL_IDS,
  APPEARANCE_PRESETS,
  DEFAULT_APPEARANCE,
  validateAppearance,
} from "../electron/appearance.mjs";
async function fixture(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "sebby-appearance-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new AppearanceStore(directory);
  await store.load();
  return { store, directory };
}
test("default preserves Orbit ice identity and returned settings cannot mutate storage", async (t) => {
  const { store } = await fixture(t);
  assert.deepEqual(store.get(), DEFAULT_APPEARANCE);
  const copy = store.get();
  copy.colors.body = "#000000";
  assert.equal(store.get().colors.body, APPEARANCE_PRESETS.ice.body);
});
test("all companions and presets persist with canonical palette colors", async (t) => {
  const { store, directory } = await fixture(t);
  for (const pal of PAL_IDS)
    for (const palettePreset of Object.keys(APPEARANCE_PRESETS)) {
      const saved = await store.save({ pal, palettePreset, motion: false });
      assert.deepEqual(saved.colors, APPEARANCE_PRESETS[palettePreset]);
      const restored = new AppearanceStore(directory);
      await restored.load();
      assert.deepEqual(restored.get(), saved);
    }
});
test("custom colors are strict hex, normalized and survive concurrent saves", async (t) => {
  const { store, directory } = await fixture(t);
  const custom = {
    pal: "wisp",
    palettePreset: "custom",
    motion: true,
    colors: { body: "#aabbcc", accent: "#123456", glow: "#ddeeff" },
  };
  await Promise.all([
    store.save({ pal: "scout", palettePreset: "mint", motion: true }),
    store.save(custom),
  ]);
  assert.equal(store.get().colors.body, "#AABBCC");
  const restored = new AppearanceStore(directory);
  await restored.load();
  assert.deepEqual(restored.get(), store.get());
});
test("unknown keys, URLs, CSS injection, partial hex and malformed options rejected", () => {
  for (const patch of [
    { pal: "remote" },
    { url: "https://host/model.glb" },
    { motion: "yes" },
    {
      palettePreset: "custom",
      colors: { body: "red", accent: "#123456", glow: "#123456" },
    },
    { colors: { body: "url(x)", accent: "#123456", glow: "#123456" } },
    { colors: { body: "#fff", accent: "#123456", glow: "#123456" } },
    {
      colors: {
        body: "#123456;display:none",
        accent: "#123456",
        glow: "#123456",
      },
    },
    { palettePreset: "custom", colors: undefined },
  ])
    assert.throws(() =>
      validateAppearance({ ...DEFAULT_APPEARANCE, ...patch }),
    );
});
test("corruption, symlinks and inconsistent preset state fail closed", async (t) => {
  const { store, directory } = await fixture(t);
  await store.save(DEFAULT_APPEARANCE);
  const file = path.join(directory, "sebby-appearance.json");
  await fs.writeFile(file, "broken");
  await assert.rejects(
    new AppearanceStore(directory).load(),
    /not overwritten/,
  );
  assert.equal(await fs.readFile(file, "utf8"), "broken");
  await fs.writeFile(
    file,
    JSON.stringify({
      version: 1,
      appearance: {
        ...DEFAULT_APPEARANCE,
        colors: { body: "#000000", accent: "#000000", glow: "#000000" },
      },
    }),
  );
  await assert.rejects(
    new AppearanceStore(directory).load(),
    /not overwritten/,
  );
  await fs.unlink(file);
  const other = path.join(directory, "other.json");
  await fs.writeFile(other, "{}");
  await fs.symlink(other, file);
  await assert.rejects(
    new AppearanceStore(directory).load(),
    /not overwritten/,
  );
});

test("nine bundled pals have fixed embedded assets and optional manifest hashes match", async () => {
  const { createHash } = await import("node:crypto");
  const expected = [
    "orbit",
    "scout",
    "wisp",
    "luma",
    "nook",
    "finch",
    "tidal",
    "moss",
    "piper",
  ];
  assert.deepEqual(PAL_IDS, expected);
  const root = new URL("../public/pals/", import.meta.url);
  const manifest = JSON.parse(
    await fs.readFile(new URL("catalog-manifest.json", root), "utf8"),
  );
  assert.deepEqual(manifest.catalogIds, expected);
  assert.equal(manifest.defaultPal, "orbit");
  for (const pal of PAL_IDS) {
    const glb = await fs.readFile(new URL(`${pal}.glb`, root));
    assert.equal(glb.readUInt32LE(0), 0x46546c67);
    assert.equal(glb.readUInt32LE(4), 2);
    assert.equal(glb.readUInt32LE(8), glb.length);
    assert.equal(glb.readUInt32LE(16), 0x4e4f534a);
    const json = JSON.parse(
      glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"),
    );
    for (const resource of [...(json.buffers || []), ...(json.images || [])])
      assert.equal(resource.uri, undefined, `${pal} must embed assets`);
    const names = new Set(
      json.materials.map((material) => material.name.toLowerCase()),
    );
    for (const slot of ["body", "accent", "glow"])
      assert.ok(names.has(slot), `${pal} has ${slot}`);
    const png = await fs.readFile(new URL(`${pal}.png`, root));
    assert.deepEqual(
      [...png.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
    const optional = manifest.optionalModels.find((model) => model.id === pal);
    if (optional)
      for (const [ext, data] of [
        ["glb", glb],
        ["png", png],
      ]) {
        assert.equal(optional.assets[ext].bytes, data.length);
        assert.equal(
          optional.assets[ext].sha256,
          createHash("sha256").update(data).digest("hex"),
        );
      }
  }
  assert.equal(
    (await fs.readdir(root)).some(
      (name) => name.endsWith(".blend") || name.endsWith(".blend1"),
    ),
    false,
  );
});
