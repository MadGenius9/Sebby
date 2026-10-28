import fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
export async function readLocal(file, max) {
  try {
    const dir = await fs.lstat(path.dirname(file));
    if (!dir.isDirectory() || dir.isSymbolicLink()) throw Error();
    const entry = await fs.lstat(file);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > max)
      throw Error();
    const handle = await fs.open(
      file,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
    );
    try {
      const s = await handle.stat();
      if (!s.isFile() || s.size > max) throw Error();
      const buffer = Buffer.alloc(max + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > max) throw Error();
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw Error("MCP local storage unavailable.");
  }
}
export async function writeLocal(file, data, max) {
  if (Buffer.byteLength(data) > max) throw Error("MCP storage limit.");
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const st = await fs.lstat(dir);
  if (!st.isDirectory() || st.isSymbolicLink())
    throw Error("Unsafe MCP storage.");
  try {
    const s = await fs.lstat(file);
    if (!s.isFile() || s.isSymbolicLink()) throw Error("Unsafe MCP storage.");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const temp = path.join(dir, `.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temp, data, { flag: "wx", mode: 0o600, flush: true });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}
