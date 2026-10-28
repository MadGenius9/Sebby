import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
function validKey(value) {
  return (
    typeof value === "string" &&
    value.length >= 20 &&
    value.length <= 1024 &&
    /^[\x21-\x7e]+$/.test(value)
  );
}
/** Main-process only. Never expose getKey through IPC, logs or renderer state. */
export class RuntimeCredentials {
  constructor({ env = process.env } = {}) {
    this.env = env;
  }
  status() {
    const configured = validKey(this.env.OPENAI_API_KEY);
    return { configured, source: configured ? "environment" : "none" };
  }
  getKey() {
    if (!this.status().configured)
      throw Error(
        "Existing OpenAI API key is not available to the Sebby main process.",
      );
    return this.env.OPENAI_API_KEY;
  }
}
/** Optional future host integration; no key-entry UI or automatic persistence. */
export class SecureCredentialStore {
  constructor(directory, { safeStorage } = {}) {
    this.file = path.join(directory, "sebby-openai.credential");
    this.safeStorage = safeStorage;
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
  async status() {
    if (!this.supported())
      return {
        configured: false,
        source: "none",
        secureStorageAvailable: false,
      };
    try {
      const stat = await fs.lstat(this.file);
      return {
        configured:
          stat.isFile() &&
          !stat.isSymbolicLink() &&
          stat.size > 0 &&
          stat.size < 16384,
        source: "os-encrypted",
        secureStorageAvailable: true,
      };
    } catch {
      return {
        configured: false,
        source: "none",
        secureStorageAvailable: true,
      };
    }
  }
  async save(key, { confirmed = false } = {}) {
    if (confirmed !== true)
      throw Error(
        "Explicit local credential persistence approval is required.",
      );
    if (!this.supported())
      throw Error(
        "OS credential encryption is unavailable. Plaintext fallback is forbidden.",
      );
    if (!validKey(key)) throw Error("Invalid credential.");
    let encrypted;
    try {
      encrypted = this.safeStorage.encryptString(key);
    } catch {
      throw Error("OS credential encryption failed.");
    }
    if (
      !Buffer.isBuffer(encrypted) ||
      !encrypted.length ||
      encrypted.length > 16384
    )
      throw Error("Invalid encrypted credential result.");
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      const stat = await fs.lstat(this.file);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw Error("Unsafe credential destination.");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, encrypted, { flag: "wx", mode: 0o600 });
      await fs.rename(temp, this.file);
    } finally {
      await fs.unlink(temp).catch(() => {});
    }
    return { saved: true };
  }
  async getKey() {
    if (!this.supported())
      throw Error("OS credential encryption is unavailable.");
    try {
      const stat = await fs.lstat(this.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384)
        throw Error();
      const key = this.safeStorage.decryptString(await fs.readFile(this.file));
      if (!validKey(key)) throw Error();
      return key;
    } catch {
      throw Error("Stored credential could not be read securely.");
    }
  }
  async remove({ confirmed = false } = {}) {
    if (confirmed !== true) throw Error("Confirm credential removal first.");
    await fs.unlink(this.file).catch((e) => {
      if (e.code !== "ENOENT") throw Error("Credential removal failed.");
    });
    return { removed: true };
  }
}
