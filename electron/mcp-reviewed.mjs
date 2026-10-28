import dns from "node:dns/promises";
import path from "node:path";
import { isIP } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { pinnedPost, isPublicAddress } from "./mcp-discovery.mjs";
import { validateConnector } from "./connectors.mjs";
import {
  parseStrictJSON,
  validateSchema,
  validateArguments,
} from "./mcp-reviewed-schema.mjs";
import { readLocal, writeLocal } from "./mcp-reviewed-storage.mjs";
const hash = (v) =>
  createHash("sha256")
    .update(typeof v === "string" ? v : JSON.stringify(v))
    .digest("hex");
const VERSION = "2026-07-28";
const exact = (v, keys) => {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    throw Error("Invalid MCP request.");
};
const text = (v, max = 2000) =>
  typeof v === "string"
    ? v
        .replace(
          /[\x00-\x1f\x7f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
          " ",
        )
        .slice(0, max)
    : "";
function abortable(p, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(Error("cancelled"));
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(p)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
export class McpReviewed {
  constructor({
    directory,
    connectors,
    vault,
    approve = async () => false,
    resolve = (host) => dns.lookup(host, { all: true, verbatim: true }),
    transport = pinnedPost,
    now = Date.now,
  }) {
    Object.assign(this, {
      connectors,
      vault,
      approve,
      resolve,
      transport,
      now,
    });
    this.file = path.join(
      path.resolve(directory),
      "sebby-mcp-history",
      "history.json",
    );
    this.catalogs = new Map();
    this.grants = new Map();
    this.proposals = new Map();
    this.history = [];
    this.active = null;
    this.closed = false;
  }
  async load() {
    const blob = await readLocal(this.file, 256 * 1024);
    if (blob) {
      const data = JSON.parse(blob.toString());
      if (
        !Array.isArray(data) ||
        data.length > 200 ||
        data.some(
          (r) =>
            !r ||
            typeof r.id !== "string" ||
            !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
              r.id,
            ) ||
            typeof r.schemaDigest !== "string" ||
            !/^[a-f0-9]{64}$/.test(r.schemaDigest) ||
            typeof r.inputDigest !== "string" ||
            !/^[a-f0-9]{64}$/.test(r.inputDigest) ||
            !Number.isSafeInteger(r.createdAt) ||
            r.createdAt < 0 ||
            !Number.isSafeInteger(r.updatedAt) ||
            r.updatedAt < r.createdAt ||
            typeof r.connectorId !== "string" ||
            !/^[A-Za-z0-9-]{1,100}$/.test(r.connectorId) ||
            typeof r.url !== "string" ||
            typeof r.toolName !== "string" ||
            !/^[A-Za-z0-9_.-]{1,128}$/.test(r.toolName) ||
            !["dispatching", "completed", "tool-error", "uncertain"].includes(
              r.status,
            ) ||
            Object.keys(r).some(
              (k) =>
                ![
                  "id",
                  "connectorId",
                  "url",
                  "toolName",
                  "schemaDigest",
                  "inputDigest",
                  "createdAt",
                  "updatedAt",
                  "status",
                ].includes(k),
            ),
        )
      )
        throw Error("MCP history invalid.");
      if (new Set(data.map((r) => r.id)).size !== data.length)
        throw Error("MCP history invalid.");
      for (const r of data)
        if (
          validateConnector({ name: "History", type: "mcp", url: r.url })
            .url !== r.url
        )
          throw Error("MCP history endpoint invalid.");
      this.history = data.map((r) =>
        r.status === "dispatching"
          ? { ...r, status: "uncertain", updatedAt: this.now() }
          : r,
      );
      await this.persist();
    }
    return this;
  }
  persist() {
    return writeLocal(this.file, JSON.stringify(this.history), 256 * 1024);
  }
  isBusy() {
    return !!this.active;
  }
  endpoint(id) {
    const c = this.connectors.get(id);
    if (!c || c.type !== "mcp") throw Error("Saved MCP endpoint required.");
    return validateConnector({ name: c.name, type: c.type, url: c.url }).url;
  }
  async binding(id) {
    const url = this.endpoint(id),
      credential = await this.vault.status(id);
    return {
      connectorId: id,
      url,
      generation: credential.generation,
      configured: credential.configured,
    };
  }
  async same(bound) {
    const current = await this.binding(bound.connectorId);
    if (
      current.url !== bound.url ||
      current.generation !== bound.generation ||
      !current.configured
    )
      throw Error("MCP endpoint or credential changed.");
  }
  async status(id) {
    const bound = await this.binding(id);
    let catalog = [...this.catalogs.values()].find(
      (c) =>
        c.connectorId === id &&
        c.url === bound.url &&
        c.generation === bound.generation,
    );
    return {
      credential: {
        configured: bound.configured,
        generation: bound.generation,
      },
      catalog: catalog ? this.publicCatalog(catalog) : null,
      grants: [...this.grants.values()]
        .filter(
          (g) =>
            g.connectorId === id &&
            g.url === bound.url &&
            g.generation === bound.generation,
        )
        .map(({ toolName, schemaDigest }) => ({ toolName, schemaDigest })),
      busy: this.isBusy(),
      history: structuredClone(
        this.history.filter((r) => r.connectorId === id),
      ),
    };
  }
  publicCatalog(c) {
    const { generation, ...publicValue } = c;
    return structuredClone(publicValue);
  }
  check(run) {
    if (this.closed || run.signal.aborted) throw Error("cancelled");
  }
  async exclusive(fn) {
    if (this.closed || this.active) throw Error("MCP operation unavailable.");
    const run = new AbortController();
    this.active = run;
    let timer;
    try {
      return await fn(run, () => {
        timer = setTimeout(() => run.abort(), 30000);
        timer.unref?.();
      });
    } finally {
      clearTimeout(timer);
      if (this.active === run) this.active = null;
    }
  }
  async request(bound, method, params, run, onDispatch = async () => {}) {
    this.check(run);
    await this.same(bound);
    this.check(run);
    const addresses = await abortable(
      this.resolve(new URL(bound.url).hostname),
      run.signal,
    );
    if (
      !Array.isArray(addresses) ||
      !addresses.length ||
      addresses.length > 32 ||
      addresses.some(
        (a) => !isPublicAddress(a.address) || a.family !== isIP(a.address),
      )
    )
      throw Error("Unsafe MCP address.");
    this.check(run);
    const token = await this.vault.getBound(
      bound.connectorId,
      bound.url,
      bound.generation,
    );
    this.check(run);
    await this.same(bound);
    this.check(run);
    const id = randomUUID();
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": VERSION,
          "io.modelcontextprotocol/clientInfo": {
            name: "Sebby",
            version: "0.9.0",
          },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    });
    await onDispatch();
    this.check(run);
    const response = await abortable(
      this.transport({
        url: bound.url,
        ...addresses[0],
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "MCP-Protocol-Version": VERSION,
          "Mcp-Method": method,
          Authorization: `Bearer ${token}`,
        },
        body,
        signal: run.signal,
        timeoutMs: 8000,
      }),
      run.signal,
    );
    this.check(run);
    if (
      response?.status !== 200 ||
      !/^application\/json(?:\s*;|$)/i.test(
        response.headers?.["content-type"] || "",
      ) ||
      typeof response.body !== "string" ||
      Buffer.byteLength(response.body) > 262144 ||
      response.body.includes(token)
    )
      throw Error("Invalid MCP response.");
    const message = parseStrictJSON(response.body, 262144);
    if (
      message.jsonrpc !== "2.0" ||
      message.id !== id ||
      message.error ||
      message.result?.resultType !== "complete"
    )
      throw Error("Unsupported MCP response.");
    return message.result;
  }
  async discover(id) {
    return this.exclusive(async (run, startTimer) => {
      try {
        const bound = await this.binding(id);
        this.check(run);
        if (!bound.configured) throw Error();
        if (
          (await this.approve({
            action: "mcp-reviewed-discovery",
            connectorId: id,
            url: bound.url,
            description:
              "Send this endpoint its dedicated bearer token and request tool schemas. Server receives IP/DNS metadata; no tools called. Descriptions and effects are unverified.",
          })) !== true
        )
          return { status: "denied" };
        this.check(run);
        startTimer();
        const result = await this.request(bound, "tools/list", {}, run);
        if (
          !Array.isArray(result.tools) ||
          result.tools.length > 50 ||
          result.nextCursor !== undefined
        )
          throw Error();
        const names = new Set();
        const tools = result.tools.map((t) => {
          if (
            !t ||
            typeof t.name !== "string" ||
            !/^[A-Za-z0-9_.-]{1,128}$/.test(t.name) ||
            names.has(t.name)
          )
            throw Error();
          names.add(t.name);
          const inputSchema = validateSchema(t.inputSchema);
          return {
            name: t.name,
            description: text(t.description),
            inputSchema,
            schemaDigest: hash(inputSchema),
          };
        });
        this.check(run);
        await this.same(bound);
        this.check(run);
        this.clearConnector(id);
        if (this.catalogs.size >= 50) throw Error();
        const catalog = {
          ...bound,
          id: randomUUID(),
          tools,
          createdAt: this.now(),
        };
        delete catalog.configured;
        this.catalogs.set(catalog.id, catalog);
        return { status: "ready", catalog: this.publicCatalog(catalog) };
      } catch {
        return {
          status: run.signal.aborted ? "cancelled" : "error",
          message:
            "MCP catalog unavailable or unsupported. No automatic retry.",
        };
      }
    });
  }
  catalog(id) {
    const c = this.catalogs.get(id);
    if (!c || this.now() - c.createdAt > 5 * 60_000)
      throw Error("Catalog expired; discover again.");
    return c;
  }
  key(c, name) {
    return JSON.stringify([c.connectorId, c.url, c.generation, name]);
  }
  grant(input) {
    return this.exclusive(async (run) => {
      exact(input, ["catalogId", "toolName"]);
      const c = this.catalog(input.catalogId),
        tool = c.tools.find((t) => t.name === input.toolName);
      if (!tool) throw Error("Unknown tool.");
      await this.same(c);
      this.check(run);
      if (
        (await this.approve({
          action: "mcp-grant-tool",
          connectorId: c.connectorId,
          url: c.url,
          toolName: tool.name,
          schemaDigest: tool.schemaDigest,
          description:
            "Allow this exact tool/schema for this app session? Effects are unknown and unverified. Each invocation still requires separate full-input review and native approval. No AI auto-execution.",
        })) !== true
      )
        return { approved: false };
      this.check(run);
      await this.same(c);
      this.check(run);
      this.grants.set(this.key(c, tool.name), {
        connectorId: c.connectorId,
        url: c.url,
        generation: c.generation,
        toolName: tool.name,
        schemaDigest: tool.schemaDigest,
      });
      return { approved: true };
    });
  }
  revoke(input) {
    exact(input, ["connectorId", "toolName"]);
    if (this.isBusy()) throw Error("MCP operation active.");
    for (const [k, g] of this.grants)
      if (g.connectorId === input.connectorId && g.toolName === input.toolName)
        this.grants.delete(k);
    for (const [k, p] of this.proposals)
      if (p.connectorId === input.connectorId && p.toolName === input.toolName)
        this.proposals.delete(k);
    return { revoked: true };
  }
  prepare(input) {
    return this.exclusive(async (run) => {
      exact(input, ["catalogId", "toolName", "argumentsJson"]);
      const c = this.catalog(input.catalogId),
        tool = c.tools.find((t) => t.name === input.toolName);
      if (
        !tool ||
        this.grants.get(this.key(c, tool.name))?.schemaDigest !==
          tool.schemaDigest
      )
        throw Error("Exact tool grant required.");
      await this.same(c);
      this.check(run);
      const args = validateArguments(
        tool.inputSchema,
        parseStrictJSON(input.argumentsJson),
      );
      const argumentsJson = JSON.stringify(args, null, 2).replace(
        /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
        (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
      );
      if (Buffer.byteLength(argumentsJson) > 8192)
        throw Error("Input review limit exceeded.");
      if (this.proposals.size >= 20) throw Error("Discard old proposals.");
      const proposal = {
        id: randomUUID(),
        connectorId: c.connectorId,
        url: c.url,
        toolName: tool.name,
        schemaDigest: tool.schemaDigest,
        argumentsJson,
        createdAt: this.now(),
      };
      proposal.digest = hash(proposal);
      this.proposals.set(proposal.id, {
        ...proposal,
        generation: c.generation,
        catalogId: c.id,
      });
      return { status: "ready", proposal: structuredClone(proposal) };
    });
  }
  invoke(input) {
    return this.exclusive(async (run, startTimer) => {
      let record,
        dispatched = false;
      try {
        exact(input, ["proposalId", "digest"]);
        const p = this.proposals.get(input.proposalId);
        if (!p || p.digest !== input.digest) throw Error();
        this.proposals.delete(p.id);
        const c = this.catalog(p.catalogId);
        if (
          this.now() - p.createdAt > 5 * 60_000 ||
          this.grants.get(this.key(c, p.toolName))?.schemaDigest !==
            p.schemaDigest
        )
          throw Error();
        await this.same(p);
        this.check(run);
        if (this.history.length >= 200)
          throw Error("MCP journal full; no call attempted.");
        if (
          (await this.approve({
            action: "mcp-invoke-tool",
            connectorId: p.connectorId,
            url: p.url,
            toolName: p.toolName,
            schemaDigest: p.schemaDigest,
            argumentsJson: p.argumentsJson,
            digest: p.digest,
            description:
              "Execute this exact JSON input at this remote endpoint? Effects are UNKNOWN and UNVERIFIED. It may incur costs, expose information or perform irreversible actions. Approval is for one attempt; cancellation cannot undo remote work.",
          })) !== true
        )
          return { status: "denied" };
        this.check(run);
        startTimer();
        const result = await this.request(
          p,
          "tools/call",
          { name: p.toolName, arguments: parseStrictJSON(p.argumentsJson) },
          run,
          async () => {
            record = {
              id: randomUUID(),
              connectorId: p.connectorId,
              url: p.url,
              toolName: p.toolName,
              schemaDigest: p.schemaDigest,
              inputDigest: hash(p.argumentsJson),
              createdAt: this.now(),
              updatedAt: this.now(),
              status: "dispatching",
            };
            this.history.push(record);

            await this.persist();
            dispatched = true;
          },
        );
        if (
          !Array.isArray(result.content) ||
          result.content.length > 50 ||
          result.content.some(
            (x) => !x || x.type !== "text" || typeof x.text !== "string",
          ) ||
          (result.isError !== undefined && typeof result.isError !== "boolean")
        )
          throw Error();
        const output = {
          text: result.content.map((x) => x.text),
          untrusted: true,
        };
        if (result.structuredContent !== undefined) {
          if (
            !result.structuredContent ||
            typeof result.structuredContent !== "object" ||
            Array.isArray(result.structuredContent)
          )
            throw Error("Unsupported structured output.");
          output.structured = result.structuredContent;
        }
        record.status = result.isError ? "tool-error" : "completed";
        record.updatedAt = this.now();
        await this.persist();
        return {
          status: record.status,
          output,
          record: structuredClone(record),
        };
      } catch {
        if (record) {
          record.status = "uncertain";
          record.updatedAt = this.now();
          try {
            await this.persist();
          } catch {}
        }
        return {
          status: dispatched
            ? "uncertain"
            : run.signal.aborted
              ? "cancelled-before-dispatch"
              : "error",
          message: dispatched
            ? "Remote effects are unknown. Do not automatically retry."
            : "MCP invocation did not complete; no automatic retry.",
          ...(record ? { record: structuredClone(record) } : {}),
        };
      }
    });
  }
  discard(input) {
    exact(input, ["proposalId"]);
    if (this.isBusy()) throw Error("MCP operation active.");
    return { discarded: this.proposals.delete(input.proposalId) };
  }
  clearConnector(id) {
    for (const [k, c] of this.catalogs)
      if (c.connectorId === id) this.catalogs.delete(k);
    for (const [k, g] of this.grants)
      if (g.connectorId === id) this.grants.delete(k);
    for (const [k, p] of this.proposals)
      if (p.connectorId === id) this.proposals.delete(k);
  }
  cancel() {
    this.active?.abort();
    return { cancelled: !!this.active };
  }
  shutdown() {
    this.closed = true;
    this.cancel();
    this.catalogs.clear();
    this.grants.clear();
    this.proposals.clear();
  }
}
