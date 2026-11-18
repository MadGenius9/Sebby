import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
const hash = (content) => createHash("sha256").update(content).digest("hex");
const ignored = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
  ".ssh",
  ".aws",
  ".azure",
  ".config",
  ".gnupg",
]);
export function allowedSource(relative) {
  if (
    typeof relative !== "string" ||
    relative.length > 180 ||
    relative.startsWith("/") ||
    relative.includes("\\")
  )
    return false;
  const parts = relative.split("/");
  if (
    parts.some(
      (p) =>
        !/^[A-Za-z0-9_@.-]+$/.test(p) ||
        p === "." ||
        p === ".." ||
        ignored.has(p.toLowerCase()) ||
        /[. ]$/.test(p) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
    )
  )
    return false;
  const name = parts.at(-1).toLowerCase();
  if (
    /^\.env(?:\.|$)/.test(name) ||
    [
      ".npmrc",
      ".pypirc",
      ".netrc",
      "credentials.json",
      "service-account.json",
    ].includes(name)
  )
    return false;
  return (
    /\.(js|jsx|mjs|cjs|ts|tsx|json|html|css|scss|md|txt|yaml|yml|toml|xml|csv|py|rs|go|c|h|cpp|cs|java|sql|svelte|vue|glsl|wgsl)$/.test(
      name,
    ) || ["readme", "license", ".gitignore", ".editorconfig"].includes(name)
  );
}
async function target(root, relative, allowMissing = false) {
  if (!allowedSource(relative))
    throw new Error("Path is outside the allowed source policy");
  const rootReal = await fs.realpath(root);
  let current = rootReal;
  for (const [i, part] of relative.split("/").entries()) {
    current = path.join(current, part);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (e) {
      if (
        e.code === "ENOENT" &&
        allowMissing &&
        i === relative.split("/").length - 1
      )
        return { root: rootReal, file: current, exists: false };
      throw e;
    }
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
      throw new Error("Links and special files are refused");
    if (stat.isFile() && stat.nlink !== 1)
      throw new Error("Hard-linked source files are refused");
    const real = await fs.realpath(current);
    if (!real.startsWith(rootReal + path.sep))
      throw new Error("Path left the selected root");
  }
  return { root: rootReal, file: current, exists: true };
}
export async function localTask(
  root,
  task,
  { writable = false, backupDirectory } = {},
) {
  if (task.operation === "list") {
    const rootReal = await fs.realpath(root),
      files = [];
    let walked = 0,
      truncated = false;
    async function walk(dir, relative = "", depth = 0) {
      if (depth > 8) {
        truncated = true;
        return;
      }
      const iterator = await fs.opendir(dir);
      for await (const item of iterator) {
        if (++walked > 2000 || files.length >= 200) {
          truncated = true;
          break;
        }
        if (item.isSymbolicLink() || ignored.has(item.name.toLowerCase()))
          continue;
        const name = relative ? relative + "/" + item.name : item.name;
        if (item.isDirectory())
          await walk(path.join(dir, item.name), name, depth + 1);
        else if (item.isFile() && allowedSource(name)) files.push(name);
      }
    }
    await walk(rootReal);
    return { ok: true, files: files.sort(), truncated };
  }
  if (!["read", "write"].includes(task.operation))
    throw new Error("This companion does not run commands");
  const resolved = await target(root, task.path, task.operation === "write"),
    flags =
      constants.O_RDONLY |
      (constants.O_NOFOLLOW || 0) |
      (constants.O_NONBLOCK || 0);
  let previous = null;
  if (resolved.exists) {
    const file = await fs.open(resolved.file, flags);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 100000)
        throw new Error("Source must be a regular file under 100 KB");
      const buffer = Buffer.alloc(100001);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 100000) throw new Error("Source exceeds 100 KB");
      const after = await file.stat();
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
        throw new Error("Source changed during read");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        buffer.subarray(0, bytesRead),
      );
      if (text.includes("\0")) throw new Error("Binary files are unsupported");
      previous = { content: text, sha256: hash(text), stat };
    } finally {
      await file.close();
    }
  }
  if (task.operation === "read") {
    if (!previous) throw new Error("Source file does not exist");
    return {
      ok: true,
      path: task.path,
      content: previous.content,
      sha256: previous.sha256,
    };
  }
  if (!writable)
    throw new Error(
      "Companion is read-only; restart with --allow-write to enable writes",
    );
  if (
    typeof task.content !== "string" ||
    Buffer.byteLength(task.content) > 100000 ||
    task.content.includes("\0")
  )
    throw new Error("Write exceeds source limits");
  if (!previous)
    throw new Error(
      "This companion only updates existing reviewed files; new-file creation is not supported",
    );
  if (!backupDirectory)
    throw new Error("A local backup directory is required before writing");
  if (task.expectedHash !== previous.sha256)
    throw new Error(
      "Source changed since review; read it again before writing",
    );
  // Check the entire parent chain again. No directories are created and no files are deleted.
  const realRoot = await fs.realpath(root),
    backupPath = path.resolve(backupDirectory);
  if (backupPath === realRoot || backupPath.startsWith(realRoot + path.sep))
    throw new Error("Backups must be outside the selected source folder");
  await fs.mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  await fs.writeFile(
    path.join(backupDirectory, `${Date.now()}-${randomUUID()}.json`),
    JSON.stringify({
      path: task.path,
      content: previous.content,
      sha256: previous.sha256,
    }),
    { flag: "wx", mode: 0o600 },
  );
  const checked = await target(root, task.path, true);
  if (checked.exists !== resolved.exists)
    throw new Error("Source changed since review");
  if (resolved.exists) {
    const file = await fs.open(
      resolved.file,
      constants.O_RDWR | (constants.O_NOFOLLOW || 0),
    );
    try {
      const stat = await file.stat();
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.ino !== previous.stat.ino ||
        stat.dev !== previous.stat.dev ||
        stat.size !== previous.stat.size ||
        stat.mtimeMs !== previous.stat.mtimeMs
      )
        throw new Error("Source changed since review");
      const current = Buffer.alloc(100001);
      const { bytesRead } = await file.read(current, 0, current.length, 0);
      if (
        bytesRead > 100000 ||
        hash(
          new TextDecoder("utf-8", { fatal: true }).decode(
            current.subarray(0, bytesRead),
          ),
        ) !== task.expectedHash
      )
        throw new Error("Source changed since review");
      await file.write(
        Buffer.from(task.content),
        0,
        Buffer.byteLength(task.content),
        0,
      );
      await file.truncate(Buffer.byteLength(task.content));
      await file.sync();
    } finally {
      await file.close();
    }
  } else {
    await fs.writeFile(resolved.file, task.content, {
      flag: "wx",
      mode: 0o600,
    });
  }
  return { ok: true, path: task.path, sha256: hash(task.content) };
}
