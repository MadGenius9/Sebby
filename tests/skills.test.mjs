import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SkillRegistry, validateSkill } from "../electron/skills.mjs";
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-skills-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const registry = new SkillRegistry(directory);
  await registry.load();
  return { registry, directory };
}
const input = {
  id: "user-accessibility-review",
  name: "Accessibility review",
  description: "Inspect keyboard and semantic structure.",
  instructions:
    "Review keyboard access and semantic HTML. Report findings; do not modify files.",
};
test("three bundled skills are immutable real instruction files", async (t) => {
  const { registry } = await fixture(t);
  assert.equal(registry.list().length, 3);
  for (const skill of registry.list()) {
    assert.equal(skill.origin, "bundled");
    assert.equal(skill.readOnly, true);
    assert.ok(skill.instructions.length > 100);
  }
  await assert.rejects(registry.remove("app-plan"), /read-only/);
  const skill = registry.get("app-plan");
  skill.instructions = "changed";
  assert.notEqual(registry.get("app-plan").instructions, "changed");
});
test("imported skill persists as untrusted instruction-only document", async (t) => {
  const { registry, directory } = await fixture(t);
  const imported = await registry.importSkill(input);
  assert.equal(imported.trust, "untrusted");
  assert.equal(imported.origin, "user");
  assert.equal(imported.readOnly, false);
  await assert.rejects(registry.importSkill(input), /already exists/);
  const restored = new SkillRegistry(directory);
  await restored.load();
  assert.equal(restored.get(input.id).instructions, input.instructions);
  await restored.remove(input.id);
  assert.equal(restored.list().length, 3);
});
test("executable fields, spoofed trust, traversal and oversized instructions rejected", () => {
  for (const change of [
    { id: "../escape" },
    { id: "app-plan" },
    { instructions: "x".repeat(32001) },
    { instructions: "" },
    { command: "rm -rf x" },
    { trust: "trusted" },
    { origin: "bundled" },
  ])
    assert.throws(() => validateSkill({ ...input, ...change }));
});
test("concurrent imports persist and corrupt registry stays untouched", async (t) => {
  const { registry, directory } = await fixture(t);
  await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      registry.importSkill({ ...input, id: `user-test-${i}` }),
    ),
  );
  assert.equal(registry.list().length, 8);
  const file = path.join(directory, "sebby-skills.json");
  await fs.writeFile(file, '{"version":1,"skills":[{"id":"app-plan"}]}');
  const corrupted = new SkillRegistry(directory);
  await assert.rejects(corrupted.load(), /not overwritten/);
  assert.match(await fs.readFile(file, "utf8"), /app-plan/);
});
