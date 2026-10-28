import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
const MAX_ITEMS = 50,
  MAX_FILE = 128 * 1024;
const scopes = { github: ["repository:read"], mcp: ["tools:list"] };
const blockedLabels = new Set([
  "localhost",
  "local",
  "internal",
  "intranet",
  "home",
  "lan",
  "test",
  "invalid",
  "example",
]);
function object(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    throw Error(
      "Unsupported connector fields. Credentials and executable settings are not accepted.",
    );
}
function cleanName(name) {
  if (
    typeof name !== "string" ||
    !name.trim() ||
    Buffer.byteLength(name) > 120 ||
    /[\x00-\x1f]/.test(name) ||
    /\b(sk-[a-zA-Z0-9_-]{12,}|github_pat_[a-zA-Z0-9_]+|gh[pousr]_[a-zA-Z0-9]+)\b/.test(
      name,
    )
  )
    throw Error("Choose a short non-secret connector name.");
  return name.trim();
}
export function validateConnector(input) {
  object(input, ["name", "type", "url"]);
  const name = cleanName(input.name);
  if (
    !["github", "mcp"].includes(input.type) ||
    typeof input.url !== "string" ||
    input.url.length > 2048 ||
    /[\s\\]/.test(input.url)
  )
    throw Error("Invalid connector type or URL.");
  let url;
  try {
    url = new URL(input.url);
  } catch {
    throw Error("Use a valid HTTPS URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port ||
    input.url.includes("?") ||
    input.url.includes("#")
  )
    throw Error(
      "Use HTTPS without credentials, query, fragment, or custom port.",
    );
  if (input.type === "github") {
    if (
      url.hostname !== "github.com" ||
      !/^\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}\/?$/.test(
        url.pathname,
      )
    )
      throw Error(
        "Use a GitHub repository URL: https://github.com/owner/repository.",
      );
    const parts = url.pathname.replace(/\/$/, "").split("/");
    if ([".", ".."].includes(parts[2])) throw Error("Invalid repository name.");
    parts[2] = parts[2].replace(/\.git$/, "");
    if (!parts[2]) throw Error("Invalid repository name.");
    url.pathname = parts.join("/");
  } else {
    const host = url.hostname.toLowerCase();
    const labels = host.split(".");
    if (
      isIP(host) ||
      host.includes(":") ||
      labels.length < 2 ||
      !labels.every((label) =>
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
      ) ||
      labels.some((label) => blockedLabels.has(label)) ||
      labels.some((label) => label.startsWith("xn--")) ||
      !/[a-z]/.test(labels.at(-1))
    )
      throw Error(
        "Use a public DNS hostname, not an IP address or local/private hostname.",
      );
    if (
      /%|(?:^|\/)(?:token|key|secret|password|credentials)(?:\/|$)|(?:sk-|github_pat_|ghp_)/i.test(
        url.pathname,
      )
    )
      throw Error(
        "Endpoint paths must not contain credentials or encoded components.",
      );
  }
  return { name, type: input.type, url: url.href.replace(/\/$/, "") };
}
function record(input) {
  const value = validateConnector({
    name: input.name,
    type: input.type,
    url: input.url,
  });
  if (typeof input.id !== "string" || !/^[a-f0-9-]{36}$/.test(input.id))
    throw Error("Invalid connector id.");
  return {
    ...value,
    id: input.id,
    requestedScopes: [...scopes[value.type]],
    status: "configured-not-connected",
    enabled: false,
  };
}
/** Configuration bookmarks only. No network, authentication, permission grants, or tool execution. */
export class ConnectorStore {
  constructor(directory) {
    this.file = path.join(directory, "sebby-connectors.json");
    this.items = [];
    this.ready = false;
    this.queue = Promise.resolve();
  }
  async load() {
    try {
      const stat = await fs.lstat(this.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE)
        throw Error();
      const data = JSON.parse(await fs.readFile(this.file, "utf8"));
      object(data, ["version", "connectors"]);
      if (
        data.version !== 1 ||
        !Array.isArray(data.connectors) ||
        data.connectors.length > MAX_ITEMS
      )
        throw Error();
      this.items = data.connectors.map((item) => {
        object(item, ["id", "name", "type", "url"]);
        return record(item);
      });
      if (new Set(this.items.map((x) => x.id)).size !== this.items.length)
        throw Error();
      this.ready = true;
    } catch (e) {
      if (e.code === "ENOENT") {
        this.items = [];
        this.ready = true;
      } else
        throw Error(
          "Connector configuration could not be loaded. Existing data was not overwritten.",
        );
    }
  }
  assertReady() {
    if (!this.ready) throw Error("Load connector configuration first.");
  }
  list() {
    this.assertReady();
    return structuredClone(this.items);
  }
  get(id) {
    this.assertReady();
    const item = this.items.find((x) => x.id === id);
    if (!item) throw Error("Connector not found.");
    return structuredClone(item);
  }
  async persist(fn) {
    this.assertReady();
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.items);
      const result = fn(next);
      const data = {
        version: 1,
        connectors: next.map(({ id, name, type, url }) => ({
          id,
          name,
          type,
          url,
        })),
      };
      const payload = JSON.stringify(data);
      if (Buffer.byteLength(payload) > MAX_FILE)
        throw Error("Connector storage limit reached.");
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temp, payload, { flag: "wx", mode: 0o600 });
        await fs.rename(temp, this.file);
      } finally {
        await fs.unlink(temp).catch(() => {});
      }
      this.items = next;
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async add(input) {
    const value = validateConnector(input);
    return this.persist((items) => {
      if (items.length >= MAX_ITEMS) throw Error("Connector limit reached.");
      if (items.some((x) => x.type === value.type && x.url === value.url))
        throw Error("This endpoint is already configured.");
      const item = record({ ...value, id: randomUUID() });
      items.push(item);
      return structuredClone(item);
    });
  }
  async update(id, patch) {
    object(patch, ["name", "url"]);
    return this.persist((items) => {
      const i = items.findIndex((x) => x.id === id);
      if (i < 0) throw Error("Connector not found.");
      const item = record({ ...items[i], ...patch });
      if (
        items.some(
          (x, index) =>
            index !== i && x.type === item.type && x.url === item.url,
        )
      )
        throw Error("This endpoint is already configured.");
      items[i] = item;
      return structuredClone(item);
    });
  }
  async remove(id, { confirmed = false } = {}) {
    if (confirmed !== true) throw Error("Confirm connector removal first.");
    return this.persist((items) => {
      const i = items.findIndex((x) => x.id === id);
      if (i < 0) throw Error("Connector not found.");
      items.splice(i, 1);
      return { removed: true };
    });
  }
  export() {
    return {
      version: 1,
      connectors: this.list().map(({ name, type, url }) => ({
        name,
        type,
        url,
      })),
    };
  }
  async import(input, { confirmed = false } = {}) {
    if (confirmed !== true)
      throw Error("Confirm importing connector bookmarks first.");
    object(input, ["version", "connectors"]);
    if (
      input.version !== 1 ||
      !Array.isArray(input.connectors) ||
      input.connectors.length > MAX_ITEMS
    )
      throw Error("Invalid connector import.");
    const values = input.connectors.map(validateConnector);
    return this.persist((items) => {
      if (items.length + values.length > MAX_ITEMS)
        throw Error("Connector limit reached.");
      const seen = new Set(items.map((x) => `${x.type}:${x.url}`));
      for (const value of values) {
        const key = `${value.type}:${value.url}`;
        if (seen.has(key)) throw Error("Duplicate connector bookmark.");
        seen.add(key);
        items.push(record({ ...value, id: randomUUID() }));
      }
      return { imported: values.length };
    });
  }
}
