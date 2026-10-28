import fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
const exact = (v, keys) => {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    throw Error("Unsupported GitHub configuration fields.");
};
export function validateGitHubConfig(v) {
  exact(v, ["owner", "repo", "ref", "useToken"]);
  if (typeof v.owner !== "string" || typeof v.repo !== "string")
    throw Error("Enter explicit owner and repository strings.");
  if (
    typeof v.useToken !== "boolean" ||
    typeof v.ref !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(v.ref) ||
    /^(github_pat_|gh[pousr]_)/.test(v.ref) ||
    v.ref.includes("..") ||
    v.ref.includes("//") ||
    v.ref.endsWith("/")
  )
    throw Error("Use a bounded Git ref name or SHA.");
  if (
    !(v.owner === "" && v.repo === "") &&
    (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(v.owner) ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(v.repo) ||
      v.repo.endsWith(".git") ||
      /^(github_pat_|gh[pousr]_)/.test(v.repo))
  )
    throw Error(
      "Enter an explicit owner and repository name, not a URL, .git suffix, or credential.",
    );
  return { owner: v.owner, repo: v.repo, ref: v.ref, useToken: v.useToken };
}
async function safeDirectory(directory, create = false) {
  if (create) await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error();
    return true;
  } catch (e) {
    if (!create && e.code === "ENOENT") return false;
    throw Error("GitHub local storage directory is unavailable.");
  }
}
async function readBounded(file, max) {
  const stat = await fs.lstat(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 1 ||
    stat.size > max
  )
    throw Error("Invalid bounded storage file.");
  const handle = await fs.open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > max) throw Error();
    const buffer = Buffer.alloc(max + 1),
      { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > max) throw Error();
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
async function atomic(file, contents) {
  await safeDirectory(path.dirname(file), true);
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw Error("Unsafe GitHub storage destination.");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const tmp = path.join(path.dirname(file), `.github-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, contents, { flag: "wx", mode: 0o600 });
    await fs.rename(tmp, file);
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}
export class GitHubConfig {
  constructor(directory) {
    this.directory = path.resolve(directory);
    this.file = path.join(this.directory, "sebby-github.json");
    this.value = null;
    this.queue = Promise.resolve();
  }
  async load() {
    try {
      if (!(await safeDirectory(this.directory)))
        throw Object.assign(Error(), { code: "ENOENT" });
      const data = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await readBounded(this.file, 8192),
        ),
      );
      exact(data, ["version", "configuration"]);
      if (data.version !== 1) throw Error();
      this.value = validateGitHubConfig(data.configuration);
    } catch (e) {
      if (e.code !== "ENOENT")
        throw Error(
          "GitHub configuration could not be loaded. Existing data was not overwritten.",
        );
      this.value = { owner: "", repo: "", ref: "HEAD", useToken: false };
    }
    return this.get();
  }
  get() {
    if (!this.value) throw Error("Load GitHub configuration first.");
    return structuredClone(this.value);
  }
  async save(input) {
    this.get();
    const value = validateGitHubConfig(input);
    const op = this.queue.then(async () => {
      await atomic(
        this.file,
        JSON.stringify({ version: 1, configuration: value }, null, 2),
      );
      this.value = value;
      return this.get();
    });
    this.queue = op.catch(() => {});
    return op;
  }
}
const validToken = (value) =>
  typeof value === "string" &&
  value.length >= 20 &&
  value.length <= 1024 &&
  /^[\x21-\x7e]+$/.test(value);
/** Dedicated GitHub-only encrypted vault. Exclude sebby-github-vault from backups. */
export class GitHubVault {
  constructor(directory, { safeStorage } = {}) {
    this.directory = path.join(path.resolve(directory), "sebby-github-vault");
    this.file = path.join(this.directory, "credential.bin");
    this.safeStorage = safeStorage;
    this.queue = Promise.resolve();
  }
  supported() {
    try {
      return (
        this.safeStorage?.isEncryptionAvailable() === true &&
        this.safeStorage.getSelectedStorageBackend?.() !== "basic_text"
      );
    } catch {
      return false;
    }
  }
  async status() {
    const secureStorageAvailable = this.supported();
    if (!(await safeDirectory(this.directory)))
      return { configured: false, secureStorageAvailable };
    try {
      const stat = await fs.lstat(this.file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size < 1 ||
        stat.size > 16384
      )
        throw Error();
      return { configured: secureStorageAvailable, secureStorageAvailable };
    } catch (e) {
      if (e.code === "ENOENT")
        return { configured: false, secureStorageAvailable };
      throw Error("Stored GitHub credential metadata is invalid.");
    }
  }
  serial(fn) {
    const op = this.queue.then(fn);
    this.queue = op.catch(() => {});
    return op;
  }
  async save(token, { confirmed = false } = {}) {
    if (confirmed !== true)
      throw Error(
        "Native confirmation is required before saving a GitHub token.",
      );
    if (!validToken(token)) throw Error("Invalid GitHub token format.");
    if (!this.supported())
      throw Error("OS-protected storage unavailable; no plaintext fallback.");
    return this.serial(async () => {
      if (!this.supported()) throw Error("OS-protected storage unavailable.");
      let blob;
      try {
        blob = this.safeStorage.encryptString(
          JSON.stringify({
            version: 1,
            service: "github-api",
            host: "api.github.com",
            token,
          }),
        );
        if (!Buffer.isBuffer(blob) || blob.length < 1 || blob.length > 16384)
          throw Error();
        await atomic(this.file, blob);
        return { saved: true };
      } catch {
        throw Error("GitHub token could not be encrypted and saved securely.");
      } finally {
        blob?.fill(0);
      }
    });
  }
  async getToken() {
    if (!this.supported())
      throw Error("OS-protected GitHub token storage unavailable.");
    let blob;
    try {
      if (!(await safeDirectory(this.directory))) throw Error();
      blob = await readBounded(this.file, 16384);
      const value = JSON.parse(this.safeStorage.decryptString(blob));
      exact(value, ["version", "service", "host", "token"]);
      if (
        value.version !== 1 ||
        value.service !== "github-api" ||
        value.host !== "api.github.com" ||
        !validToken(value.token)
      )
        throw Error();
      return value.token;
    } catch {
      throw Error("Stored GitHub token could not be decrypted safely.");
    } finally {
      blob?.fill(0);
    }
  }
  async remove({ confirmed = false } = {}) {
    if (confirmed !== true)
      throw Error(
        "Native confirmation is required before removing a GitHub token.",
      );
    return this.serial(async () => {
      if (!(await safeDirectory(this.directory))) return { removed: true };
      try {
        const stat = await fs.lstat(this.file);
        if (!stat.isFile() || stat.isSymbolicLink())
          throw Error("Unsafe GitHub credential destination.");
        await fs.unlink(this.file);
      } catch (e) {
        if (e.code !== "ENOENT")
          throw Error("Stored GitHub token could not be removed.");
      }
      return { removed: true };
    });
  }
}
