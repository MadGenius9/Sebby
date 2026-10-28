import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { hash, noLinks } from "./isolation-config.mjs";
const MAX_FILES = 100,
  MAX_FILE = 512 * 1024,
  MAX_BYTES = 5 * 1024 * 1024;
export function safeFile(value) {
  if (
    typeof value !== "string" ||
    value.length > 240 ||
    /[\\\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff:,]/.test(
      value,
    ) ||
    value
      .split("/")
      .some(
        (p) =>
          !p ||
          p.startsWith(".") ||
          p.endsWith(".") ||
          p.endsWith(" ") ||
          /^(?:node_modules|vendor|coverage|dist|build|con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(
            p,
          ),
      ) ||
    /(?:^|\/)(?:secrets?|credentials?|tokens?|sebby-.*|id_rsa)(?:\.|$)|\.(?:pem|pfx|p12|key|credential|env)$/i.test(
      value,
    )
  )
    throw Error("Unsupported or sensitive isolation file path.");
  return value;
}
async function readSource(root, relative) {
  safeFile(relative);
  const target = path.join(root, relative);
  const before = await noLinks(target);
  if (before.size > MAX_FILE) throw Error("Snapshot file limit exceeded.");
  const handle = await fs.open(
    target,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.ino !== before.ino ||
      opened.dev !== before.dev
    )
      throw Error("Workspace identity changed.");
    const buffer = Buffer.alloc(MAX_FILE + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await handle.read(
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length > MAX_FILE) throw Error("Snapshot file grew beyond its limit.");
    const bytes = Buffer.from(buffer.subarray(0, length));
    const after = await fs.lstat(target);
    if (
      after.isSymbolicLink() ||
      before.ino !== after.ino ||
      before.dev !== after.dev ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.length > MAX_FILE
    )
      throw Error("Workspace changed during snapshot.");
    return bytes;
  } finally {
    await handle.close();
  }
}
export class WorkspaceSnapshot {
  constructor({ stagingRoot, approve = async () => false }) {
    this.root = path.resolve(stagingRoot);
    this.approve = approve;
    this.items = new Map();
    this.busy = false;
    this.closed = false;
    this.pending = null;
  }
  assertOpen() {
    if (this.closed) throw Error("Snapshot service closed.");
  }
  async shutdown() {
    this.closed = true;
    if (this.pending) await this.pending.catch(() => {});
    for (const id of [...this.items.keys()]) await this.dispose(id);
  }
  prepare(workspaceRoot, relativePaths) {
    if (this.busy)
      return Promise.reject(Error("Snapshot preparation already active."));
    if (
      !Array.isArray(relativePaths) ||
      !relativePaths.length ||
      relativePaths.length > MAX_FILES
    )
      return Promise.reject(Error("Choose 1–100 reviewed source files."));
    let selected;
    try {
      selected = relativePaths.map(safeFile);
    } catch (error) {
      return Promise.reject(error);
    }
    const pending = this.prepareInternal(workspaceRoot, selected);
    this.pending = pending;
    pending
      .finally(() => {
        if (this.pending === pending) this.pending = null;
      })
      .catch(() => {});
    return pending;
  }
  async prepareInternal(workspaceRoot, relativePaths) {
    this.assertOpen();
    if (this.busy) throw Error("Snapshot preparation already active.");
    this.busy = true;
    let directory;
    try {
      const workspace = path.resolve(workspaceRoot);
      await noLinks(workspace, true);
      const relationship = path.relative(workspace, this.root);
      if (
        !relationship ||
        (!relationship.startsWith(".." + path.sep) &&
          relationship !== ".." &&
          !path.isAbsolute(relationship))
      )
        throw Error("Staging must be outside the selected project.");
      await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
      await noLinks(this.root, true);
      this.assertOpen();
      if ((await fs.readdir(this.root)).length >= 3)
        throw Error(
          "Snapshot retention limit reached (3 including stale directories). Dispose known snapshots or review stale staging manually.",
        );
      if (
        !Array.isArray(relativePaths) ||
        !relativePaths.length ||
        relativePaths.length > MAX_FILES
      )
        throw Error("Choose 1–100 reviewed source files.");
      const paths = [...relativePaths].map(safeFile).sort();
      if (new Set(paths.map((x) => x.toLowerCase())).size !== paths.length)
        throw Error("Duplicate snapshot paths.");
      if (
        !paths.includes("package.json") ||
        !paths.includes("package-lock.json")
      )
        throw Error("Web recipes require package.json and package-lock.json.");
      const content = [];
      let total = 0;
      for (const name of paths) {
        const bytes = await readSource(workspace, name);
        total += bytes.length;
        if (total > MAX_BYTES) throw Error("Snapshot total limit exceeded.");
        content.push({ path: name, bytes, sha256: hash(bytes) });
      }
      let pkg, lock;
      try {
        pkg = JSON.parse(content.find((x) => x.path === "package.json").bytes);
        lock = JSON.parse(
          content.find((x) => x.path === "package-lock.json").bytes,
        );
      } catch {
        throw Error("Invalid package metadata.");
      }
      if (
        ![2, 3].includes(lock.lockfileVersion) ||
        !lock.packages ||
        !pkg.scripts ||
        typeof pkg.scripts !== "object"
      )
        throw Error(
          "A supported dependency lock and named scripts are required.",
        );
      const metadata = content.map((x) => ({
          path: x.path,
          sha256: x.sha256,
          bytes: x.bytes.length,
        })),
        snapshotHash = hash(JSON.stringify(metadata));
      if (
        (await this.approve({
          action: "prepare-isolation-snapshot",
          workspaceRoot: workspace,
          files: metadata,
          totalBytes: total,
          warning:
            "Selected file contents will be staged for a future local container. Path filters are not a secret-content detector; review each file.",
        })) !== true
      )
        throw Error("Snapshot preparation declined.");
      this.assertOpen();
      for (const item of content)
        if (hash(await readSource(workspace, item.path)) !== item.sha256)
          throw Error("Source changed after snapshot consent.");
      this.assertOpen();
      const id = randomUUID();
      directory = path.join(this.root, id);
      await fs.mkdir(directory, { mode: 0o700 });
      for (const item of content) {
        this.assertOpen();
        const target = path.join(directory, item.path);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, item.bytes, { flag: "wx", mode: 0o400 });
      }
      this.assertOpen();
      const record = {
        id,
        workspaceRoot: workspace,
        directory,
        files: metadata,
        totalBytes: total,
        snapshotHash,
        lockSha256: content.find((x) => x.path === "package-lock.json").sha256,
      };
      this.items.set(id, record);
      return structuredClone(record);
    } catch (error) {
      if (directory) await fs.rm(directory, { recursive: true, force: true });
      throw error;
    } finally {
      this.busy = false;
    }
  }
  get(id) {
    const item = this.items.get(id);
    if (!item)
      throw Error(
        "Unknown snapshot; snapshots are not automatically restored.",
      );
    return structuredClone(item);
  }
  async verify(id) {
    const item = this.get(id);
    await noLinks(item.directory, true);
    const allowed = new Set(item.files.map((x) => x.path));
    const visit = async (relative = "") => {
      for (const entry of await fs.readdir(
        path.join(item.directory, relative),
        { withFileTypes: true },
      )) {
        const name = relative ? relative + "/" + entry.name : entry.name;
        if (entry.isSymbolicLink()) throw Error("Snapshot link detected.");
        if (entry.isDirectory()) {
          if (!item.files.some((file) => file.path.startsWith(name + "/")))
            throw Error("Unexpected snapshot directory.");
          await visit(name);
        } else if (!entry.isFile() || !allowed.has(name))
          throw Error("Unexpected snapshot file.");
      }
    };
    await visit();
    for (const file of item.files) {
      if (hash(await readSource(item.directory, file.path)) !== file.sha256)
        throw Error("Snapshot has changed.");
    }
    return item;
  }
  async dispose(id) {
    const item = this.get(id);
    await noLinks(this.root, true);
    await noLinks(item.directory, true);
    await fs.rm(item.directory, { recursive: true, force: true });
    this.items.delete(id);
  }
}
