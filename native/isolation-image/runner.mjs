import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
export const CONTRACT_VERSION = 1;
const MAX_INPUT = 8 * 1024 * 1024,
  MAX_FILE = 512 * 1024,
  MAX_TOTAL = 5 * 1024 * 1024;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const validHash = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function exact(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    throw Error("Invalid protocol fields.");
}
function safePath(value) {
  if (
    typeof value !== "string" ||
    value.length > 240 ||
    /[\\\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff:,]/.test(
      value,
    ) ||
    value
      .split("/")
      .some(
        (p) =>
          !p ||
          p.startsWith(".") ||
          p.endsWith(".") ||
          p.endsWith(" ") ||
          /^(?:node_modules|con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(
            p,
          ),
      ) ||
    /(?:^|\/)(?:secrets?|credentials?|tokens?|id_rsa)(?:\.|$)|\.(?:pem|pfx|p12|key|credential|env)$/i.test(
      value,
    )
  )
    throw Error("Invalid reviewed path.");
  return value;
}
export function parseStrictJson(text) {
  const parsed = JSON.parse(text);
  let cursor = 0;
  const whitespace = () => {
    while (/\s/.test(text[cursor] ?? "") && cursor < text.length) cursor++;
  };
  const string = () => {
    const start = cursor++;
    while (cursor < text.length) {
      if (text[cursor] === "\\") {
        cursor += 2;
        continue;
      }
      if (text[cursor++] === '"') break;
    }
    return JSON.parse(text.slice(start, cursor));
  };
  const visit = (depth = 0) => {
    if (depth > 32) throw Error("JSON nesting limit exceeded.");
    whitespace();
    if (text[cursor] === "{") {
      cursor++;
      whitespace();
      const keys = new Set();
      while (text[cursor] !== "}") {
        const key = string();
        if (
          keys.has(key) ||
          ["__proto__", "prototype", "constructor"].includes(key)
        )
          throw Error("Duplicate/prototype JSON key.");
        keys.add(key);
        whitespace();
        cursor++;
        visit(depth + 1);
        whitespace();
        if (text[cursor] !== ",") break;
        cursor++;
        whitespace();
      }
      cursor++;
    } else if (text[cursor] === "[") {
      cursor++;
      whitespace();
      while (text[cursor] !== "]") {
        visit(depth + 1);
        whitespace();
        if (text[cursor] !== ",") break;
        cursor++;
      }
      cursor++;
    } else if (text[cursor] === '"') string();
    else {
      while (cursor < text.length && !/[\s,}\]]/.test(text[cursor])) cursor++;
    }
  };
  visit();
  return parsed;
}
export function validateEnvelope(text, expected) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_INPUT)
    throw Error("Input limit exceeded.");
  exact(expected, ["recipe", "snapshotHash", "lockSha256", "wrapperSha256"]);
  if (
    !["web-build", "web-test"].includes(expected.recipe) ||
    ![expected.snapshotHash, expected.lockSha256, expected.wrapperSha256].every(
      validHash,
    )
  )
    throw Error("Invalid approved identity.");
  const doc = parseStrictJson(text);
  exact(doc, ["format", "recipe", "snapshotHash", "lockSha256", "files"]);
  if (
    doc.format !== "sebby-snapshot-v1" ||
    doc.recipe !== expected.recipe ||
    doc.snapshotHash !== expected.snapshotHash ||
    doc.lockSha256 !== expected.lockSha256 ||
    !Array.isArray(doc.files) ||
    !doc.files.length ||
    doc.files.length > 100
  )
    throw Error("Snapshot identity mismatch.");
  const files = [],
    seen = new Set();
  let total = 0;
  for (const file of doc.files) {
    exact(file, ["path", "base64", "sha256"]);
    safePath(file.path);
    if (
      seen.has(file.path.normalize("NFC").toLowerCase()) ||
      typeof file.base64 !== "string" ||
      file.base64.length > 700000 ||
      !validHash(file.sha256)
    )
      throw Error("Invalid source record.");
    seen.add(file.path.normalize("NFC").toLowerCase());
    const estimated =
      Math.floor(file.base64.length / 4) * 3 -
      (file.base64.endsWith("==") ? 2 : file.base64.endsWith("=") ? 1 : 0);
    if (estimated < 0 || total + estimated > MAX_TOTAL)
      throw Error("Decoded snapshot limit exceeded.");
    const bytes = Buffer.from(file.base64, "base64");
    if (
      bytes.toString("base64") !== file.base64 ||
      bytes.length > MAX_FILE ||
      digest(bytes) !== file.sha256
    )
      throw Error("Invalid source bytes.");
    total += bytes.length;
    if (total > MAX_TOTAL) throw Error("Decoded snapshot limit exceeded.");
    files.push({ path: file.path, bytes, sha256: file.sha256 });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const manifest = files.map((f) => ({
    path: f.path,
    sha256: f.sha256,
    bytes: f.bytes.length,
  }));
  if (digest(JSON.stringify(manifest)) !== doc.snapshotHash)
    throw Error("Snapshot manifest hash mismatch.");
  const lock = files.find((f) => f.path === "package-lock.json"),
    pkg = files.find((f) => f.path === "package.json");
  if (!lock || !pkg || lock.sha256 !== doc.lockSha256)
    throw Error("Dependency lock missing/mismatched.");
  const lockDoc = parseStrictJson(lock.bytes.toString("utf8")),
    packageDoc = parseStrictJson(pkg.bytes.toString("utf8"));
  const script = expected.recipe === "web-build" ? "build" : "test";
  if (
    ![2, 3].includes(lockDoc.lockfileVersion) ||
    !lockDoc.packages ||
    typeof packageDoc.scripts?.[script] !== "string" ||
    !packageDoc.scripts[script].trim()
  )
    throw Error("Selected locked recipe not present.");
  return { files, script };
}
async function readRegular(file, maximum) {
  await directory(path.dirname(file));
  const before = await fs.lstat(file);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size > maximum
  )
    throw Error("Unsafe regular file.");
  const handle = await fs.open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.ino !== before.ino ||
      stat.dev !== before.dev ||
      stat.nlink !== 1
    )
      throw Error("File identity changed.");
    const buffer = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < buffer.length) {
      const next = await handle.read(
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (!next.bytesRead) break;
      length += next.bytesRead;
    }
    if (length > maximum) throw Error("File limit exceeded.");
    await directory(path.dirname(file));
    const after = await handle.stat(),
      located = await fs.lstat(file);
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.nlink !== 1 ||
      located.isSymbolicLink() ||
      located.ino !== before.ino ||
      located.dev !== before.dev
    )
      throw Error("File changed during read.");
    return Buffer.from(buffer.subarray(0, length));
  } finally {
    await handle.close();
  }
}
async function directory(target) {
  let cursor = path.parse(path.resolve(target)).root;
  for (const part of path
    .resolve(target)
    .slice(cursor.length)
    .split(path.sep)
    .filter(Boolean)) {
    cursor = path.join(cursor, part);
    const stat = await fs.lstat(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error("Unsafe directory.");
  }
}
async function artifacts(root) {
  const result = [];
  let total = 0,
    entries = 0;
  try {
    await directory(root);
  } catch (error) {
    if (error.code === "ENOENT") return result;
    throw error;
  }
  const walk = async (relative = "", depth = 0) => {
    if (depth > 16) throw Error("Artifact depth limit exceeded.");
    await directory(path.join(root, relative));
    for await (const entry of await fs.opendir(path.join(root, relative))) {
      if (++entries > 200) throw Error("Artifact entry limit exceeded.");
      const name = relative ? relative + "/" + entry.name : entry.name;
      safePath(name);
      if (entry.isSymbolicLink()) throw Error("Artifact links forbidden.");
      if (entry.isDirectory()) {
        await walk(name, depth + 1);
        continue;
      }
      if (
        !entry.isFile() ||
        !/\.(?:html|css|js|json|map|txt|svg|png)$/.test(name) ||
        result.length >= 20
      )
        throw Error("Unsupported artifact.");
      const bytes = await readRegular(path.join(root, name), 256 * 1024);
      total += bytes.length;
      if (total > 1024 * 1024) throw Error("Artifact total limit exceeded.");
      if (
        result.some(
          (x) =>
            x.path.normalize("NFC").toLowerCase() ===
            name.normalize("NFC").toLowerCase(),
        )
      )
        throw Error("Artifact case collision.");
      result.push({
        path: name,
        base64: bytes.toString("base64"),
        sha256: digest(bytes),
      });
    }
  };
  await walk();
  return result;
}
export async function runRecipe({
  text,
  expected,
  workRoot,
  dependencyRoot,
  executor,
  signal,
}) {
  const checked = validateEnvelope(text, expected);
  if (signal?.aborted) throw Error("Cancelled.");
  await directory(workRoot);
  await directory(dependencyRoot);
  const dependencyDirectory = path.join(dependencyRoot, expected.lockSha256);
  await directory(dependencyDirectory);
  if (
    digest(
      await readRegular(
        path.join(dependencyDirectory, "package-lock.json"),
        MAX_FILE,
      ),
    ) !== expected.lockSha256
  )
    throw Error("Preprovisioned dependency lock mismatch.");
  const cache = parseStrictJson(
    (
      await readRegular(
        path.join(dependencyDirectory, "sebby-cache.json"),
        4096,
      )
    ).toString("utf8"),
  );
  exact(cache, ["format", "lockSha256", "contractVersion"]);
  if (
    cache.format !== "sebby-dependency-cache-v1" ||
    cache.lockSha256 !== expected.lockSha256 ||
    cache.contractVersion !== CONTRACT_VERSION
  )
    throw Error("Unreviewed dependency cache.");
  const modules = path.join(dependencyDirectory, "node_modules");
  await directory(modules);
  const project = path.join(workRoot, "project");
  await fs.mkdir(project, { mode: 0o700 }); // exclusive fresh directory, never existing project reuse
  try {
    for (const file of checked.files) {
      if (signal?.aborted) throw Error("Cancelled.");
      const target = path.join(project, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.writeFile(target, file.bytes, { flag: "wx", mode: 0o600 });
    }
    // This link is authored by the trusted wrapper to a fixed image-owned cache,
    // never accepted from stdin and never points at the host project.
    await fs.symlink(modules, path.join(project, "node_modules"), "dir");
    if (signal?.aborted) throw Error("Cancelled.");
    const result = await executor({
      executable: "/usr/local/bin/node",
      args: [
        "/usr/local/lib/node_modules/npm/bin/npm-cli.js",
        "run",
        checked.script,
        "--offline",
        "--ignore-scripts",
      ],
      cwd: project,
      environment: {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        HOME: "/tmp",
        TMPDIR: "/tmp",
        CI: "true",
        NPM_CONFIG_OFFLINE: "true",
        NPM_CONFIG_IGNORE_SCRIPTS: "true",
        NPM_CONFIG_AUDIT: "false",
        NPM_CONFIG_FUND: "false",
        NPM_CONFIG_USERCONFIG: "/opt/sebby/empty-npmrc",
      },
      timeoutMs: 45000,
      maxOutputBytes: 64 * 1024,
      signal,
    });
    exact(result, ["exitCode", "logs"]);
    if (
      !Number.isInteger(result.exitCode) ||
      result.exitCode < 0 ||
      result.exitCode > 255 ||
      typeof result.logs !== "string" ||
      Buffer.byteLength(result.logs) > 64 * 1024 ||
      signal?.aborted
    )
      throw Error("Invalid/aborted recipe result.");
    return {
      format: "sebby-isolated-web-v1",
      contractVersion: CONTRACT_VERSION,
      wrapperSha256: expected.wrapperSha256,
      recipe: expected.recipe,
      snapshotHash: expected.snapshotHash,
      lockSha256: expected.lockSha256,
      exitCode: result.exitCode,
      logs: result.logs,
      artifacts:
        result.exitCode === 0
          ? await artifacts(
              path.join(
                project,
                checked.script === "build" ? "dist" : "test-results",
              ),
            )
          : [],
    };
  } finally {
    await fs.rm(project, { recursive: true, force: true });
  }
}
// Only the explicit image entry point uses this executor. Unit tests inject a
// benign writer and never launch npm or user project commands.
function fixedExecutor(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(request.executable, request.args, {
      cwd: request.cwd,
      env: request.environment,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      detached: true,
    });
    let total = 0,
      parts = [],
      done = false,
      timer,
      grace,
      aborting = false;
    const kill = () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {}
      }
    };
    const finish = (error, code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(grace);
      request.signal?.removeEventListener("abort", abort);
      if (error) reject(Error("Recipe execution failed or exceeded limits."));
      else
        resolve({
          exitCode: code ?? 1,
          logs: Buffer.concat(parts).toString("utf8"),
        });
    };
    const abort = () => {
      if (aborting) return;
      aborting = true;
      kill();
      grace = setTimeout(() => finish(true), 1000);
    };
    for (const stream of [child.stdout, child.stderr]) {
      let streamBytes = 0;
      stream.on("data", (chunk) => {
        if (aborting || done) return;
        streamBytes += chunk.length;
        total += chunk.length;
        if (
          streamBytes > request.maxOutputBytes / 2 ||
          total > request.maxOutputBytes
        ) {
          abort();
          return;
        }
        parts.push(chunk);
      });
    }
    child.on("exit", kill);
    child.on("error", () => finish(true));
    child.on("close", (code) =>
      finish(
        aborting || total > request.maxOutputBytes || request.signal?.aborted,
        code,
      ),
    );
    timer = setTimeout(abort, request.timeoutMs);
    request.signal?.addEventListener("abort", abort, { once: true });
    if (request.signal?.aborted) abort();
  });
}
async function readStdin() {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > MAX_INPUT) throw Error("Input too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function main() {
  const args = process.argv.slice(2);
  if (
    process.platform !== "linux" ||
    process.getuid?.() !== 65532 ||
    args.length !== 9 ||
    args[0] !== "--reviewed-container-wrapper" ||
    args[1] !== "--recipe" ||
    args[3] !== "--snapshot-sha256" ||
    args[5] !== "--lock-sha256" ||
    args[7] !== "--wrapper-sha256"
  )
    throw Error("Image entrypoint not explicitly authorized.");
  const expected = {
    recipe: args[2],
    snapshotHash: args[4],
    lockSha256: args[6],
    wrapperSha256: args[8],
  };
  if (
    digest(await fs.readFile(fileURLToPath(import.meta.url))) !==
    expected.wrapperSha256
  )
    throw Error("Wrapper identity mismatch.");
  let deadline;
  const text = await Promise.race([
    readStdin(),
    new Promise((_, reject) => {
      deadline = setTimeout(() => reject(Error("Input deadline.")), 10000);
    }),
  ]).finally(() => clearTimeout(deadline));
  const result = await runRecipe({
    text,
    expected,
    workRoot: "/work",
    dependencyRoot: "/opt/sebby/dependencies",
    executor: fixedExecutor,
  });
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exitCode = result.exitCode;
}
// Import is inert: no process spawn, stdin read, file mutation or entrypoint call.
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main().catch(() => {
    process.stderr.write("Sebby isolated recipe rejected or failed.\n");
    process.exitCode = 1;
    process.stdin.destroy();
  });
}
