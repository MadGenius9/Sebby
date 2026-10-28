import fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { validProfileId, PROVIDERS } from "./provider-profiles.mjs";
const MAX_BYTES = 16 * 1024;
const validKey = (key) =>
  typeof key === "string" &&
  key.length >= 20 &&
  key.length <= 1024 &&
  /^[\x21-\x7e]+$/.test(key);
/** Exclude this entire directory from every backup/export. Never expose getKey via IPC. */
export class ProfileVault {
  constructor(directory, { safeStorage } = {}) {
    this.directory = path.join(path.resolve(directory), "sebby-profile-vault");
    this.safeStorage = safeStorage;
    this.queue = Promise.resolve();
  }
  supported() {
    try {
      return (
        this.safeStorage?.isEncryptionAvailable() === true &&
        this.safeStorage?.getSelectedStorageBackend?.() !== "basic_text"
      );
    } catch {
      return false;
    }
  }
  file(id) {
    if (!validProfileId(id)) throw Error("Invalid profile ID.");
    return path.join(this.directory, `${id}.credential`);
  }
  async directoryReady({ create = false } = {}) {
    if (create)
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const stat = await fs.lstat(this.directory);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw Error("Unsafe credential storage directory.");
    } catch (error) {
      if (!create && error.code === "ENOENT") return false;
      throw Error("Credential storage directory is unavailable.");
    }
    return true;
  }
  async status(id) {
    const file = this.file(id),
      secureStorageAvailable = this.supported();
    if (!(await this.directoryReady()))
      return {
        configured: false,
        source: "none",
        secureStorageAvailable,
        hasStoredCredential: false,
      };
    try {
      const stat = await fs.lstat(file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size < 1 ||
        stat.size > MAX_BYTES
      )
        throw Error();
      return {
        configured: secureStorageAvailable,
        source: secureStorageAvailable ? "os-encrypted" : "unavailable-vault",
        secureStorageAvailable,
        hasStoredCredential: true,
      };
    } catch (error) {
      if (error.code === "ENOENT")
        return {
          configured: false,
          source: "none",
          secureStorageAvailable,
          hasStoredCredential: false,
        };
      throw Error(
        "Stored credential metadata is invalid. No fallback credential was selected.",
      );
    }
  }
  serialize(fn) {
    const operation = this.queue.then(fn);
    this.queue = operation.catch(() => {});
    return operation;
  }
  async save(id, key, { confirmed = false, provider } = {}) {
    const file = this.file(id);
    if (confirmed !== true)
      throw Error("Native confirmation is required before storing a key.");
    if (!this.supported())
      throw Error(
        "OS credential encryption is unavailable. Plaintext fallback is forbidden.",
      );
    if (!PROVIDERS.includes(provider))
      throw Error(
        "An explicit supported provider is required for credential storage.",
      );
    if (!validKey(key)) throw Error("Invalid credential format.");
    let encrypted;
    try {
      encrypted = this.safeStorage.encryptString(
        JSON.stringify({ version: 1, profileId: id, provider, key }),
      );
    } catch {
      throw Error("OS credential encryption failed.");
    }
    if (
      !Buffer.isBuffer(encrypted) ||
      !encrypted.length ||
      encrypted.length > MAX_BYTES
    )
      throw Error("OS credential encryption returned invalid data.");
    return this.serialize(async () => {
      if (!this.supported())
        throw Error("OS credential encryption became unavailable.");
      await this.directoryReady({ create: true });
      try {
        const existing = await fs.lstat(file);
        if (!existing.isFile() || existing.isSymbolicLink())
          throw Error("Unsafe credential destination.");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const temporary = path.join(
        this.directory,
        `.credential-${randomUUID()}.tmp`,
      );
      try {
        await fs.writeFile(temporary, encrypted, { flag: "wx", mode: 0o600 });
        await fs.rename(temporary, file);
      } finally {
        await fs.unlink(temporary).catch(() => {});
        encrypted.fill(0);
      }
      return { saved: true, profileId: id };
    });
  }
  async getKey(id, { provider } = {}) {
    const file = this.file(id);
    if (!this.supported())
      throw Error("OS credential encryption is unavailable.");
    if (!PROVIDERS.includes(provider))
      throw Error(
        "An explicit supported provider is required to read a credential.",
      );
    if (!(await this.directoryReady()))
      throw Error("No stored credential exists.");
    let handle, buffer;
    try {
      const stat = await fs.lstat(file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size < 1 ||
        stat.size > MAX_BYTES
      )
        throw Error();
      handle = await fs.open(
        file,
        constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
      );
      const opened = await handle.stat();
      if (!opened.isFile() || opened.size < 1 || opened.size > MAX_BYTES)
        throw Error();
      buffer = Buffer.alloc(MAX_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead < 1 || bytesRead > MAX_BYTES) throw Error();
      const envelope = JSON.parse(
        this.safeStorage.decryptString(buffer.subarray(0, bytesRead)),
      );
      if (
        !envelope ||
        typeof envelope !== "object" ||
        Array.isArray(envelope) ||
        Object.keys(envelope).some(
          (k) => !["version", "profileId", "provider", "key"].includes(k),
        ) ||
        envelope.version !== 1 ||
        envelope.profileId !== id ||
        envelope.provider !== provider ||
        !validKey(envelope.key)
      )
        throw Error();
      return envelope.key;
    } catch {
      throw Error(
        "Stored credential could not be decrypted securely. No fallback credential was selected.",
      );
    } finally {
      buffer?.fill(0);
      await handle?.close();
    }
  }
  async remove(id, { confirmed = false } = {}) {
    const file = this.file(id);
    if (confirmed !== true)
      throw Error("Native confirmation is required before removing a key.");
    return this.serialize(async () => {
      if (!(await this.directoryReady()))
        return { removed: true, profileId: id };
      try {
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink())
          throw Error("Unsafe credential destination.");
        await fs.unlink(file);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      return { removed: true, profileId: id };
    });
  }
}
