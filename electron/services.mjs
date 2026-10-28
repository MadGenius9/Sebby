import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export const MAX_TEXT_BYTES = 256 * 1024;
const EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".css",
  ".html",
  ".json",
  ".cs",
  ".py",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".svg",
  ".shader",
  ".swift",
  ".gitignore",
]);
const EXCLUDED = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
]);
const SENSITIVE =
  /(^|[._-])(secret|secrets|credential|credentials|password|passwords|token|tokens|private|key|keys)([._-]|$)/i;
export function validateRelative(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 1024 ||
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("\0") ||
    path.posix.isAbsolute(value)
  )
    throw new Error("Use a relative workspace path.");
  const parts = value.split("/");
  if (
    parts.some(
      (p) =>
        !p ||
        p === "." ||
        p === ".." ||
        p.startsWith(".") ||
        EXCLUDED.has(p) ||
        SENSITIVE.test(p),
    )
  )
    throw new Error("This path is outside the readable project surface.");
  if (!EXTENSIONS.has(path.extname(value).toLowerCase()))
    throw new Error("Only supported text source files can be read.");
  return parts;
}
export function validateNote({ name, content } = {}) {
  if (
    typeof name !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,79}\.(md|txt)$/.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9]) *\./i.test(name)
  )
    throw new Error("Choose a simple .md or .txt filename.");
  validateRelative(name);
  validateText(content);
  return { name, content };
}
export function validateText(text) {
  if (
    typeof text !== "string" ||
    Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES ||
    text.includes("\0")
  )
    throw new Error("Text must be at most 256 KiB and contain no null bytes.");
  return text;
}
export function validatePersonality(value) {
  if (
    !value ||
    !["balanced", "warm", "direct"].includes(value.warmth) ||
    typeof value.humor !== "boolean"
  )
    throw new Error("Invalid personality settings.");
  return { warmth: value.warmth, humor: value.humor };
}
const inside = (root, target) => {
  const rel = path.relative(root, target);
  return (
    rel !== "" &&
    !rel.startsWith(`..${path.sep}`) &&
    rel !== ".." &&
    !path.isAbsolute(rel)
  );
};
export class Workspace {
  root = null;
  constructor({ scanLimit = 5000 } = {}) {
    if (!Number.isInteger(scanLimit) || scanLimit < 1)
      throw new Error("Invalid scan limit.");
    this.scanLimit = Math.min(scanLimit, 5000);
  }
  async select(directory) {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Choose a real project directory, not a link.");
    this.root = await fs.realpath(directory);
    return { name: path.basename(this.root), path: this.root };
  }
  async checked(relative) {
    if (!this.root) throw new Error("Choose a project folder first.");
    const parts = validateRelative(relative);
    let current = this.root;
    if ((await fs.realpath(this.root)) !== this.root)
      throw new Error("The workspace changed. Choose it again.");
    for (const part of parts) {
      current = path.join(current, part);
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink())
        throw new Error("Symbolic links are not readable.");
      const resolved = await fs.realpath(current);
      if (!inside(this.root, resolved))
        throw new Error("Path leaves the selected workspace.");
    }
    return current;
  }
  async read(relative) {
    const target = await this.checked(relative);
    const handle = await fs.open(
      target,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_TEXT_BYTES)
        throw new Error("Only text files up to 256 KiB can be opened.");
      // Recheck the complete path after opening; no directory links are accepted.
      await this.checked(relative);
      const buffer = Buffer.alloc(MAX_TEXT_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_TEXT_BYTES)
        throw new Error("File exceeds the text size limit.");
      const content = new TextDecoder("utf-8", { fatal: true }).decode(
        buffer.subarray(0, bytesRead),
      );
      validateText(content);
      return { path: relative, content };
    } finally {
      await handle.close();
    }
  }
  async list({ signal } = {}) {
    signal?.throwIfAborted();
    if (!this.root) return [];
    if (
      (await fs.realpath(this.root)) !== this.root ||
      (await fs.lstat(this.root)).isSymbolicLink()
    )
      throw new Error("The workspace changed. Choose it again.");
    const results = [];
    const root = this.root;
    let scanned = 0;
    const walk = async (directory, prefix = "", depth = 0) => {
      signal?.throwIfAborted();
      if (depth > 5 || results.length >= 300 || scanned >= this.scanLimit)
        return;
      if (this.root !== root)
        throw new Error("The workspace changed. Choose it again.");
      const stat = await fs.lstat(directory);
      if (stat.isSymbolicLink() || !stat.isDirectory()) return;
      const handle = await fs.opendir(directory);
      try {
        while (scanned < this.scanLimit && results.length < 300) {
          signal?.throwIfAborted();
          const entry = await handle.read();
          if (!entry) break;
          scanned++;
          if (this.root !== root)
            throw new Error("The workspace changed. Choose it again.");
          if (
            entry.name.startsWith(".") ||
            EXCLUDED.has(entry.name) ||
            SENSITIVE.test(entry.name) ||
            entry.isSymbolicLink()
          )
            continue;
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            const full = path.join(directory, entry.name);
            if (inside(root, await fs.realpath(full)))
              await walk(full, rel, depth + 1);
          } else if (entry.isFile()) {
            try {
              const checked = await this.checked(rel);
              const info = await fs.stat(checked);
              if (info.size <= MAX_TEXT_BYTES)
                results.push({ path: rel, size: info.size });
            } catch {
              /* Not in safe readable surface. */
            }
          }
        }
      } finally {
        await handle.close();
      }
    };
    await walk(root);
    signal?.throwIfAborted();
    return results.sort((a, b) => a.path.localeCompare(b.path));
  }

  async create(input) {
    const { name, content } = validateNote(input);
    if (!this.root) throw new Error("Choose a project folder first.");
    if ((await fs.realpath(this.root)) !== this.root)
      throw new Error("The workspace changed. Choose it again.");
    const handle = await fs.open(path.join(this.root, name), "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
    } finally {
      await handle.close();
    }
    return { created: true, path: name };
  }
}
export class Store {
  constructor(directory) {
    this.file = path.join(directory, "sebby-state.json");
    this.data = {
      version: 1,
      memories: {},
      personality: { warmth: "balanced", humor: true },
    };
    this.queue = Promise.resolve();
  }
  async load() {
    try {
      const stat = await fs.lstat(this.file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > 4 * 1024 * 1024
      )
        throw new Error("State file too large.");
      const data = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (
        data.version !== 1 ||
        !data.memories ||
        typeof data.memories !== "object" ||
        Array.isArray(data.memories)
      )
        throw new Error("Invalid state.");
      const memories = Object.create(null);
      for (const [key, text] of Object.entries(data.memories))
        if (/^(global|[a-f0-9]{64})$/.test(key))
          memories[key] = validateText(text);
      this.data = {
        version: 1,
        memories,
        personality: validatePersonality(data.personality),
      };
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error(
          "Saved settings could not be loaded. Your existing file has not been overwritten.",
        );
    }
  }
  key(root) {
    return root ? createHash("sha256").update(root).digest("hex") : "global";
  }
  state(root) {
    return {
      memory: this.data.memories[this.key(root)] || "",
      personality: { ...this.data.personality },
      workspace: root ? { name: path.basename(root), path: root } : null,
      provider: { status: "not-configured" },
      platform: "desktop",
    };
  }
  update(mutator) {
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.data);
      mutator(next);
      const encoded = JSON.stringify(next, null, 2);
      if (Buffer.byteLength(encoded) > 4 * 1024 * 1024)
        throw new Error("Local memory storage limit reached.");
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, encoded, { flag: "wx", mode: 0o600 });
        await fs.rename(temporary, this.file);
      } finally {
        await fs.unlink(temporary).catch(() => {});
      }
      this.data = next;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async saveMemory(root, text) {
    validateText(text);
    await this.update((data) => {
      data.memories[this.key(root)] = text;
    });
    return this.state(root);
  }
  async savePersonality(value, root) {
    const personality = validatePersonality(value);
    await this.update((data) => {
      data.personality = personality;
    });
    return this.state(root);
  }
}
