import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
const DEFAULT_BUNDLED = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../skills",
);
const manifest = [
  {
    id: "app-plan",
    name: "Plan an app",
    description: "Turn an idea into a small, buildable first version.",
    category: "Development",
    file: "app-plan.md",
  },
  {
    id: "code-review",
    name: "Review some code",
    description: "Prioritize correctness, safety, and evidence.",
    category: "Quality",
    file: "code-review.md",
  },
  {
    id: "project-brief",
    name: "Start a project brief",
    description: "Record the outcome, boundaries, and definition of done.",
    category: "Planning",
    file: "project-brief.md",
  },
];
const MAX_SKILLS = 50,
  MAX_BYTES = 2 * 1024 * 1024;
const clone = (value) => structuredClone(value);
function text(value, max, label) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.includes("\0") ||
    Buffer.byteLength(value) > max
  )
    throw new Error(`Invalid skill ${label}.`);
  return value;
}
export function validateSkill(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) => !["id", "name", "description", "instructions"].includes(key),
    )
  )
    throw new Error(
      "Skills accept only id, name, description, and instructions. Executable fields are not supported.",
    );
  if (
    typeof input.id !== "string" ||
    !/^user-[a-z0-9][a-z0-9-]{0,58}$/.test(input.id)
  )
    throw new Error(
      "Imported skill IDs must start with user- and contain only lowercase letters, numbers, or hyphens.",
    );
  return {
    id: input.id,
    name: text(input.name, 100, "name"),
    description: text(input.description, 400, "description"),
    instructions: text(input.instructions, 32000, "instructions"),
  };
}
/** Instruction documents, never executable code or authority to use a tool. */
export class SkillRegistry {
  constructor(directory, { bundledDirectory = DEFAULT_BUNDLED } = {}) {
    this.file = path.join(directory, "sebby-skills.json");
    this.bundledDirectory = bundledDirectory;
    this.bundled = [];
    this.imported = [];
    this.loaded = false;
    this.queue = Promise.resolve();
  }
  async load() {
    if (this.loaded) return this.list();
    const bundled = [];
    for (const entry of manifest) {
      const target = path.join(this.bundledDirectory, entry.file),
        stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32000)
        throw new Error("Bundled skill is missing or invalid.");
      const instructions = text(
        await fs.readFile(target, "utf8"),
        32000,
        "instructions",
      );
      const { file, ...metadata } = entry;
      bundled.push({
        ...metadata,
        instructions,
        origin: "bundled",
        trust: "bundled-instructions",
        readOnly: true,
      });
    }
    let imported = [];
    try {
      const stat = await fs.lstat(this.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES)
        throw new Error("Invalid skill store.");
      const data = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (
        data.version !== 1 ||
        !Array.isArray(data.skills) ||
        data.skills.length > MAX_SKILLS
      )
        throw new Error("Invalid skill store.");
      imported = data.skills.map(validateSkill);
      if (new Set(imported.map((skill) => skill.id)).size !== imported.length)
        throw new Error("Duplicate skill IDs.");
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error(
          "Saved skills could not be loaded. Existing storage was not overwritten.",
        );
    }
    this.bundled = bundled;
    this.imported = imported;
    this.loaded = true;
    return this.list();
  }
  assertLoaded() {
    if (!this.loaded) throw new Error("Load skill storage first.");
  }
  list() {
    this.assertLoaded();
    return clone([
      ...this.bundled,
      ...this.imported.map((skill) => ({
        ...skill,
        category: "Imported",
        origin: "user",
        trust: "untrusted",
        readOnly: false,
      })),
    ]);
  }
  get(id) {
    const skill = this.list().find((skill) => skill.id === id);
    if (!skill) throw new Error("Skill not found.");
    return skill;
  }
  update(mutator) {
    this.assertLoaded();
    const operation = this.queue.then(async () => {
      const next = clone(this.imported),
        result = mutator(next);
      const encoded = JSON.stringify({ version: 1, skills: next }, null, 2);
      if (Buffer.byteLength(encoded) > MAX_BYTES)
        throw new Error("Skill storage limit reached.");
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, encoded, { flag: "wx", mode: 0o600 });
        await fs.rename(temporary, this.file);
      } finally {
        await fs.unlink(temporary).catch(() => {});
      }
      this.imported = next;
      return clone(result);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async importSkill(input) {
    const skill = validateSkill(input);
    await this.update((skills) => {
      if (skills.length >= MAX_SKILLS)
        throw new Error("Imported skill limit reached.");
      if (skills.some((existing) => existing.id === skill.id))
        throw new Error("That skill ID already exists.");
      skills.push(skill);
    });
    return this.get(skill.id);
  }
  async remove(id) {
    if (this.bundled.some((skill) => skill.id === id))
      throw new Error("Bundled skills are read-only.");
    return this.update((skills) => {
      const index = skills.findIndex((skill) => skill.id === id);
      if (index < 0) throw new Error("Skill not found.");
      skills.splice(index, 1);
      return { removed: true };
    });
  }
}
