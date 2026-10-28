import https from "node:https";
import dns from "node:dns/promises";
import { isIP } from "node:net";
import { randomUUID, createHash } from "node:crypto";
import { isPublicAddress } from "./mcp-discovery.mjs";
import { validateRelative, MAX_TEXT_BYTES } from "./services.mjs";
const MAX_RESPONSE = 1024 * 1024,
  VERSION = "2026-03-10";
class GitHubError extends Error {}
const fail = (message) => {
  throw new GitHubError(message);
};
const label = (text, max) =>
  typeof text === "string"
    ? text
        .replace(
          /[\x00-\x1f\x7f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
          " ",
        )
        .slice(0, max)
    : "";
const sha = (value) =>
  typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const aborted = (promise, signal) =>
  new Promise((resolve, reject) => {
    const stop = () =>
      reject(new GitHubError("GitHub read cancelled or timed out."));
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", stop));
  });
/** Fixed-origin GET, direct TLS, fresh socket and pinned public DNS; never follow redirects. */
export function directGitHubGet({ apiPath, address, family, token, signal }) {
  if (
    !/^\/repos\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+(?:\/git\/(?:trees\/[A-Za-z0-9%._-]+\?recursive=1|blobs\/[a-f0-9]{40}))?$/.test(
      apiPath,
    ) ||
    !isPublicAddress(address) ||
    family !== isIP(address)
  )
    throw Error("Invalid fixed GitHub request.");
  return new Promise((resolve, reject) => {
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": VERSION,
      "User-Agent": "Sebby-read-only/0.5",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const request = https.request(
      {
        protocol: "https:",
        hostname: "api.github.com",
        port: 443,
        path: apiPath,
        method: "GET",
        agent: false,
        servername: "api.github.com",
        rejectUnauthorized: true,
        signal,
        headers,
        lookup: (_host, opts, callback) =>
          opts?.all
            ? callback(null, [{ address, family }])
            : callback(null, address, family),
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE) {
            request.destroy(
              new GitHubError("GitHub response exceeds the 1 MiB read limit."),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        response.on("error", reject);
      },
    );
    const timer = setTimeout(
      () => request.destroy(new GitHubError("GitHub request timed out.")),
      10000,
    );
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
    request.end();
  });
}
export class GitHubReader {
  constructor({
    config,
    vault,
    approve = async () => false,
    resolve = () => dns.lookup("api.github.com", { all: true, verbatim: true }),
    transport = directGitHubGet,
  }) {
    Object.assign(this, { config, vault, approve, resolve, transport });
    this.active = null;
    this.closed = false;
    this.trees = new Map();
    this.last = null;
  }
  get isBusy() {
    return !!this.active;
  }
  clearCache() {
    if (this.isBusy)
      throw Error("Finish or cancel the active GitHub read first.");
    this.trees.clear();
    this.last = null;
  }
  async status() {
    return {
      configuration: this.config.get(),
      credential: await this.vault.status(),
      busy: this.isBusy,
      lastRead: this.last ? structuredClone(this.last) : null,
    };
  }
  async request(operation, makePath, transform) {
    if (this.closed) throw Error("GitHub connector is shutting down.");
    if (this.active) throw Error("Finish or cancel the active GitHub read.");
    const configuration = this.config.get();
    if (!configuration.owner || !configuration.repo)
      throw Error("Save an explicit owner and repository first.");
    const controller = new AbortController();
    this.active = controller;
    let timer;
    try {
      const apiPath = makePath(configuration);
      const credential = await this.vault.status();
      if (controller.signal.aborted) fail("GitHub read cancelled.");
      if (configuration.useToken && !credential.configured)
        fail(
          "This repository is configured to use a token, but none is available.",
        );
      if (
        (await this.approve({
          operation,
          owner: configuration.owner,
          repo: configuration.repo,
          ref: configuration.ref,
          apiPath,
          useToken: configuration.useToken,
          notice:
            "Make one read-only GET request to api.github.com. GitHub and DNS infrastructure see network metadata. Only your selected GitHub token is sent when enabled. No local project data, model request, writes, clone, or publish action is performed.",
        })) !== true
      )
        return { status: "denied" };
      if (controller.signal.aborted) fail("GitHub read cancelled.");
      if (JSON.stringify(this.config.get()) !== JSON.stringify(configuration))
        fail("Repository configuration changed during approval.");
      timer = setTimeout(() => controller.abort(), 30000);
      const token = configuration.useToken
        ? await this.vault.getToken()
        : undefined;
      if (controller.signal.aborted) fail("GitHub read cancelled.");
      const records = await aborted(this.resolve(), controller.signal);
      if (
        !Array.isArray(records) ||
        !records.length ||
        records.length > 32 ||
        records.some(
          (r) => !isPublicAddress(r.address) || r.family !== isIP(r.address),
        )
      )
        fail(
          "GitHub DNS did not resolve exclusively to permitted public addresses.",
        );
      const response = await aborted(
        this.transport({
          apiPath,
          ...records[0],
          token,
          signal: controller.signal,
        }),
        controller.signal,
      );
      if (controller.signal.aborted) fail("GitHub read cancelled.");
      if (
        !response ||
        typeof response.body !== "string" ||
        Buffer.byteLength(response.body) > MAX_RESPONSE
      )
        fail("GitHub response exceeds the bounded read limit.");
      if (response.status >= 300 && response.status < 400)
        fail(
          "GitHub redirects are not followed. Check the saved repository identity.",
        );
      if (
        response.status === 429 ||
        (response.status === 403 &&
          response.headers?.["x-ratelimit-remaining"] === "0")
      )
        fail("GitHub rate limit reached. No automatic retry was attempted.");
      if (response.status === 401 || response.status === 403)
        fail(
          "GitHub denied access. Check token permissions and organization access.",
        );
      if (response.status === 404)
        fail(
          "Repository or object was not found, or the token cannot access it.",
        );
      if (response.status !== 200)
        fail("GitHub read failed. No automatic retry was attempted.");
      if (
        !/^application\/(?:json|vnd\.github\+json)(?:\s*;|$)/i.test(
          response.headers?.["content-type"] || "",
        )
      )
        fail("GitHub returned an unsupported response format.");
      let data;
      try {
        data = JSON.parse(response.body);
      } catch {
        fail("GitHub returned invalid JSON.");
      }
      const observedAt = new Date().toISOString(),
        requestId =
          label(response.headers?.["x-github-request-id"], 160) || null;
      const result = transform(data, configuration);
      this.last = {
        status: "ok",
        operation,
        repository: `${configuration.owner}/${configuration.repo}`,
        observedAt,
        requestId,
      };
      return {
        status: "ok",
        ...result,
        provenance: {
          host: "api.github.com",
          apiVersion: VERSION,
          repository: `${configuration.owner}/${configuration.repo}`,
          observedAt,
          requestId,
        },
      };
    } catch (error) {
      const message = controller.signal.aborted
        ? "GitHub read cancelled or timed out."
        : error instanceof GitHubError
          ? error.message
          : "GitHub read could not complete. No automatic retry was attempted.";
      this.last = {
        status: controller.signal.aborted ? "cancelled" : "error",
        operation,
        error: message,
      };
      return structuredClone(this.last);
    } finally {
      clearTimeout(timer);
      this.active = null;
    }
  }
  metadata() {
    return this.request(
      "repository metadata",
      (c) => `/repos/${c.owner}/${c.repo}`,
      (data, c) => {
        if (
          !data ||
          typeof data.full_name !== "string" ||
          data.full_name.toLowerCase() !==
            `${c.owner}/${c.repo}`.toLowerCase() ||
          typeof data.private !== "boolean"
        )
          fail("Repository identity did not match the approved request.");
        return {
          repository: {
            fullName: data.full_name,
            description: label(data.description, 1000),
            private: data.private,
            defaultBranch: label(data.default_branch, 200),
            archived: data.archived === true,
          },
        };
      },
    );
  }
  tree() {
    return this.request(
      "bounded repository tree",
      (c) =>
        `/repos/${c.owner}/${c.repo}/git/trees/${encodeURIComponent(c.ref)}?recursive=1`,
      (data, c) => {
        if (
          !data ||
          !sha(data.sha) ||
          !Array.isArray(data.tree) ||
          data.tree.length > 10000 ||
          typeof data.truncated !== "boolean"
        )
          fail("GitHub returned an invalid tree.");
        const entries = [];
        for (const item of data.tree) {
          if (
            item?.type !== "blob" ||
            !["100644", "100755"].includes(item.mode) ||
            !sha(item.sha) ||
            !Number.isSafeInteger(item.size) ||
            item.size < 0 ||
            item.size > MAX_TEXT_BYTES
          )
            continue;
          try {
            validateRelative(item.path);
          } catch {
            continue;
          }
          if (entries.some((entry) => entry.path === item.path))
            fail("GitHub returned duplicate paths.");
          entries.push({ path: item.path, sha: item.sha, size: item.size });
          if (entries.length === 300) break;
        }
        entries.sort((a, b) => a.path.localeCompare(b.path));
        const treeId = randomUUID(),
          snapshot = {
            treeId,
            treeSha: data.sha,
            configuration: structuredClone(c),
            entries,
            truncated: data.truncated || data.tree.length > entries.length,
          };
        this.trees.set(treeId, snapshot);
        while (this.trees.size > 3)
          this.trees.delete(this.trees.keys().next().value);
        return {
          treeId,
          treeSha: data.sha,
          entries,
          truncated: snapshot.truncated,
          notice:
            "Supported text files only; hidden, sensitive-named, linked, oversized and unsupported files are excluded. Nothing is attached to AI.",
        };
      },
    );
  }
  file(input) {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some((k) => !["treeId", "path"].includes(k))
    )
      throw Error("Choose a path from a retained GitHub tree.");
    const snapshot = this.trees.get(input.treeId),
      entry = snapshot?.entries.find((e) => e.path === input.path);
    if (!snapshot || !entry)
      throw Error(
        "Load the tree and choose one of its supported text files first.",
      );
    return this.request(
      `read file ${JSON.stringify(entry.path)}`,
      (c) => {
        if (JSON.stringify(c) !== JSON.stringify(snapshot.configuration))
          fail("Reload the repository tree after changing configuration.");
        return `/repos/${c.owner}/${c.repo}/git/blobs/${entry.sha}`;
      },
      (data) => {
        if (
          !data ||
          data.encoding !== "base64" ||
          data.sha !== entry.sha ||
          data.size !== entry.size ||
          typeof data.content !== "string" ||
          data.content.length > 400000
        )
          fail("GitHub blob metadata did not match the selected file.");
        const encoded = data.content.replace(/[\r\n]/g, "");
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4)
          fail("GitHub returned invalid file encoding.");
        const buffer = Buffer.from(encoded, "base64");
        if (
          buffer.length !== entry.size ||
          buffer.length > MAX_TEXT_BYTES ||
          buffer.toString("base64") !== encoded
        )
          fail("GitHub file exceeds limits or has invalid encoding.");
        const actual = createHash("sha1")
          .update(`blob ${buffer.length}\0`)
          .update(buffer)
          .digest("hex");
        if (actual !== entry.sha)
          fail("GitHub blob content hash did not match the approved tree.");
        let content;
        try {
          content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        } catch {
          fail("Only UTF-8 text files are supported.");
        }
        if (content.includes("\0")) fail("Binary files are not supported.");
        return {
          file: {
            path: entry.path,
            sha: entry.sha,
            treeSha: snapshot.treeSha,
            content,
            untrusted: true,
          },
          notice:
            "Untrusted repository content. Display only; not executed or sent to AI.",
        };
      },
    );
  }
  cancel() {
    this.active?.abort();
    return { cancelled: !!this.active };
  }
  shutdown() {
    this.closed = true;
    this.cancel();
  }
}
