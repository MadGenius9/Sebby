import https from "node:https";
import { isIP } from "node:net";
import { isPublicAddress } from "./mcp-discovery.mjs";
import { validateRelative } from "./services.mjs";
const SHA = /^[a-f0-9]{40}$/;
const exact = (value, keys) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k)) ||
    keys.some((k) => !Object.hasOwn(value, k))
  )
    throw Error("Invalid GitHub publication payload.");
};
const text = (value, max) =>
  typeof value === "string" &&
  Buffer.byteLength(value) <= max &&
  !/[\0\r\u202a-\u202e\u2066-\u2069]/.test(value);
function branch(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(value) &&
    !value.includes("..") &&
    !value.includes("//") &&
    !value.endsWith("/") &&
    !value.endsWith(".") &&
    !value.endsWith(".lock") &&
    value
      .split("/")
      .every(
        (part) =>
          !part.startsWith(".") &&
          !part.endsWith(".") &&
          !part.endsWith(".lock"),
      )
  );
}
function encodedBranch(value) {
  try {
    const decoded = decodeURIComponent(value);
    return (
      branch(decoded) &&
      (encodeURIComponent(decoded) === value ||
        decoded.split("/").map(encodeURIComponent).join("/") === value)
    );
  } catch {
    return false;
  }
}
/** Defense-in-depth fixed endpoint/method/schema policy; no arbitrary REST escape hatch. */
export function validatePublicationRequest({ method, apiPath, body }) {
  const match =
    typeof apiPath === "string" &&
    apiPath.match(
      /^\/repos\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9][A-Za-z0-9_.-]{0,99})(.*)$/,
    );
  if (!match) throw Error("Invalid fixed GitHub publication path.");
  const suffix = match[3];
  if (method === "GET") {
    if (body !== undefined)
      throw Error("GET publication requests cannot contain a body.");
    const ref = suffix.match(/^\/git\/ref\/heads\/(.+)$/);
    if (
      suffix === "" ||
      (ref && encodedBranch(ref[1])) ||
      /^\/git\/(?:commits|blobs)\/[a-f0-9]{40}$/.test(suffix) ||
      /^\/git\/trees\/[a-f0-9]{40}\?recursive=1$/.test(suffix) ||
      /^\/commits\/[a-f0-9]{40}\/check-runs\?per_page=50$/.test(suffix)
    )
      return;
    throw Error("Unsupported read path in publication workflow.");
  }
  if (method !== "POST")
    throw Error(
      "Only bounded GET and POST publication operations are available.",
    );
  if (suffix === "/git/blobs") {
    exact(body, ["content", "encoding"]);
    if (
      body.encoding !== "base64" ||
      typeof body.content !== "string" ||
      body.content.length > 90_000 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        body.content,
      ) ||
      Buffer.from(body.content, "base64").length > 65536
    )
      throw Error("Invalid bounded Git blob.");
  } else if (suffix === "/git/trees") {
    exact(body, ["base_tree", "tree"]);
    if (
      !SHA.test(body.base_tree) ||
      !Array.isArray(body.tree) ||
      body.tree.length < 1 ||
      body.tree.length > 10
    )
      throw Error("Invalid bounded Git tree.");
    const seen = new Set();
    for (const item of body.tree) {
      exact(item, ["path", "mode", "type", "sha"]);
      validateRelative(item.path);
      if (
        seen.has(item.path) ||
        item.mode !== "100644" ||
        item.type !== "blob" ||
        !SHA.test(item.sha)
      )
        throw Error(
          "Only reviewed regular text blobs may enter a publication.",
        );
      seen.add(item.path);
    }
  } else if (suffix === "/git/commits") {
    exact(body, ["message", "tree", "parents"]);
    if (
      !text(body.message, 4000) ||
      !body.message.trim() ||
      !SHA.test(body.tree) ||
      !Array.isArray(body.parents) ||
      body.parents.length !== 1 ||
      !SHA.test(body.parents[0])
    )
      throw Error("Invalid single-parent Git commit.");
  } else if (suffix === "/git/refs") {
    exact(body, ["ref", "sha"]);
    if (
      typeof body.ref !== "string" ||
      !body.ref.startsWith("refs/heads/sebby/") ||
      !branch(body.ref.slice(11)) ||
      !SHA.test(body.sha)
    )
      throw Error("Only a new sebby/* branch may be created.");
  } else if (suffix === "/pulls") {
    exact(body, [
      "title",
      "body",
      "head",
      "base",
      "draft",
      "maintainer_can_modify",
    ]);
    if (
      !text(body.title, 240) ||
      !body.title.trim() ||
      !text(body.body, 16000) ||
      !branch(body.head) ||
      !body.head.startsWith("sebby/") ||
      !branch(body.base) ||
      body.head === body.base ||
      body.draft !== true ||
      body.maintainer_can_modify !== false
    )
      throw Error("Only a reviewed draft pull request is available.");
  } else throw Error("Unsupported publication write path.");
  if (Buffer.byteLength(JSON.stringify(body)) > 512 * 1024)
    throw Error("Publication request is too large.");
}
export function directGitHubPublishRequest({
  method,
  apiPath,
  body,
  address,
  family,
  token,
  signal,
}) {
  validatePublicationRequest({ method, apiPath, body });
  if (
    !isPublicAddress(address) ||
    family !== isIP(address) ||
    typeof token !== "string" ||
    token.length < 20 ||
    token.length > 1024 ||
    !/^[\x21-\x7e]+$/.test(token)
  )
    throw Error("GitHub publication transport configuration is unavailable.");
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "Sebby-approved-publication/0.7",
      Authorization: `Bearer ${token}`,
    };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = payload.length;
    }
    const request = https.request(
      {
        protocol: "https:",
        hostname: "api.github.com",
        port: 443,
        path: apiPath,
        method,
        agent: false,
        servername: "api.github.com",
        rejectUnauthorized: true,
        headers,
        signal,
        lookup: (_host, opts, callback) =>
          opts?.all
            ? callback(null, [{ address, family }])
            : callback(null, address, family),
      },
      (response) => {
        const chunks = [];
        let length = 0;
        response.on("data", (chunk) => {
          length += chunk.length;
          if (length > 1024 * 1024) {
            request.destroy(Error("GitHub response exceeded limit."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", () =>
          reject(Error("GitHub response could not be read.")),
        );
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: {
              "content-type": response.headers["content-type"],
              "x-github-request-id": response.headers["x-github-request-id"],
              "x-ratelimit-remaining":
                response.headers["x-ratelimit-remaining"],
            },
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    const timeout = setTimeout(
      () => request.destroy(Error("GitHub request timed out.")),
      10000,
    );
    request.on("close", () => {
      clearTimeout(timeout);
      payload?.fill(0);
    });
    request.on("error", () =>
      reject(Error("GitHub publication transport failed or was cancelled.")),
    );
    request.end(payload || undefined);
  });
}
