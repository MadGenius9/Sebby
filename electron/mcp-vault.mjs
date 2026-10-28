import path from "node:path";
import { randomUUID } from "node:crypto";
import { readLocal, writeLocal } from "./mcp-reviewed-storage.mjs";
import { validateConnector } from "./connectors.mjs";
export class McpVault {
  constructor({
    directory,
    safeStorage,
    connectors,
    approve = async () => false,
  }) {
    Object.assign(this, { safeStorage, connectors, approve });
    this.file = path.join(
      path.resolve(directory),
      "sebby-mcp-vault",
      "credentials.bin",
    );
    this.tail = Promise.resolve();
    this.closed = false;
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
  endpoint(id) {
    const c = this.connectors.get(id);
    if (!c || c.type !== "mcp") throw Error("Saved MCP endpoint required.");
    return validateConnector({ name: c.name, type: c.type, url: c.url }).url;
  }
  async load() {
    return this;
  }
  async read() {
    const blob = await readLocal(this.file, 256 * 1024);
    if (!blob) return [];
    try {
      if (!this.supported()) throw Error();
      const data = JSON.parse(this.safeStorage.decryptString(blob));
      if (
        data.version !== 1 ||
        !Array.isArray(data.items) ||
        data.items.length > 50 ||
        data.items.some(
          (x) =>
            !x ||
            typeof x.connectorId !== "string" ||
            typeof x.url !== "string" ||
            typeof x.generation !== "string" ||
            typeof x.token !== "string" ||
            !this.validToken(x.token),
        )
      )
        throw Error();
      return data.items;
    } catch {
      throw Error("MCP credential store unavailable.");
    } finally {
      blob.fill(0);
    }
  }
  validToken(token) {
    return (
      typeof token === "string" &&
      token.length >= 8 &&
      token.length <= 8192 &&
      /^[A-Za-z0-9\-._~+/]+=*$/.test(token)
    );
  }
  async status(id) {
    const url = this.endpoint(id);
    if (!this.supported())
      return {
        configured: false,
        generation: null,
        secureStorageAvailable: false,
      };
    const record = (await this.read()).find(
      (x) => x.connectorId === id && x.url === url,
    );
    return {
      configured: !!record,
      generation: record?.generation ?? null,
      secureStorageAvailable: true,
    };
  }
  serial(fn) {
    const p = this.tail.then(() => {
      if (this.closed) throw Error("MCP credential store closing.");
      return fn();
    });
    this.tail = p.catch(() => {});
    return p;
  }
  async store(items) {
    if (!this.supported()) throw Error("OS-protected storage unavailable.");
    let blob;
    try {
      blob = this.safeStorage.encryptString(
        JSON.stringify({ version: 1, items }),
      );
      if (!Buffer.isBuffer(blob)) throw Error();
      await writeLocal(this.file, blob, 256 * 1024);
    } catch {
      throw Error("MCP credential could not be securely stored.");
    } finally {
      blob?.fill(0);
    }
  }
  save(input) {
    let token = input?.token;
    const id = input?.connectorId;
    const valid =
      input &&
      !Object.keys(input).some((k) => !["connectorId", "token"].includes(k)) &&
      this.validToken(token);
    if (input && typeof input === "object") input.token = "";
    return this.serial(async () => {
      if (!valid) throw Error("Invalid MCP credential input.");
      const url = this.endpoint(id);
      if (!this.supported())
        throw Error("OS-protected storage unavailable; no plaintext fallback.");
      if (
        (await this.approve({
          action: "mcp-save-token",
          connectorId: id,
          url,
          description:
            "Store a manually provisioned token ONLY for this exact MCP endpoint. Do not reuse provider or unrelated account keys. No connection is made.",
        })) !== true
      )
        return { saved: false };
      if (this.closed || this.endpoint(id) !== url)
        throw Error("MCP endpoint changed.");
      const items = (await this.read()).filter((x) => x.connectorId !== id);
      if (this.closed || this.endpoint(id) !== url)
        throw Error("MCP endpoint changed.");
      if (items.length >= 50) throw Error("Credential limit.");
      items.push({ connectorId: id, url, generation: randomUUID(), token });
      try {
        await this.store(items);
        return { saved: true };
      } finally {
        for (const item of items) item.token = "";
      }
    }).finally(() => {
      token = "";
    });
  }
  remove(id) {
    return this.serial(async () => {
      const url = this.endpoint(id);
      if (
        (await this.approve({
          action: "mcp-remove-token",
          connectorId: id,
          url,
          description:
            "Remove the local MCP token. This does not revoke the token at its issuer.",
        })) !== true
      )
        return { removed: false };
      if (this.closed || this.endpoint(id) !== url)
        throw Error("MCP endpoint changed.");
      const items = (await this.read()).filter((x) => x.connectorId !== id);
      if (this.closed || this.endpoint(id) !== url)
        throw Error("MCP endpoint changed.");
      try {
        await this.store(items);
      } finally {
        for (const item of items) item.token = "";
      }
      return { removed: true };
    });
  }
  async getBound(id, url, generation) {
    if (this.closed || this.endpoint(id) !== url)
      throw Error("MCP credential binding changed.");
    const record = (await this.read()).find(
      (x) =>
        x.connectorId === id && x.url === url && x.generation === generation,
    );
    if (this.closed || this.endpoint(id) !== url || !record)
      throw Error("MCP credential unavailable or changed.");
    return record.token;
  }
  shutdown() {
    this.closed = true;
    return this.tail;
  }
}
