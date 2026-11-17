// Run on the computer containing the selected source folder; never in the cloud worker.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { localTask } from "./companion-files.mjs";
const args = process.argv.slice(2),
  value = (key) => args[args.indexOf(key) + 1];
if (args.includes("--help")) {
  console.log(
    "node scripts/companion.mjs --server https://your-sebby --root /selected/project [--code ONE_TIME_CODE] [--allow-write]\nRead-only by default. Writes update existing reviewed files with local backups. No commands, deletes, or new files.",
  );
  process.exit(0);
}
if (!args.includes("--server") || !args.includes("--root"))
  throw new Error("Pass --server and --root. Use --help for details.");
const server = new URL(value("--server"));
if (
  server.pathname !== "/" ||
  server.search ||
  server.hash ||
  server.username ||
  server.password ||
  !(
    server.protocol === "https:" ||
    (server.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(server.hostname))
  )
)
  throw new Error("Server must be an HTTPS origin or local loopback HTTP");
const root = await fs.realpath(value("--root"));
if (!(await fs.stat(root)).isDirectory())
  throw new Error("Select a source folder");
if (
  root === path.parse(root).root ||
  root === (await fs.realpath(os.homedir()))
)
  throw new Error(
    "Select a project subfolder, not your home folder or filesystem root",
  );
const writable = args.includes("--allow-write"),
  configDirectory =
    process.env.SEBBY_COMPANION_CONFIG_DIR ||
    path.join(os.homedir(), ".config", "sebby"),
  credentialsFile = path.join(
    configDirectory,
    "companion-" + Buffer.from(server.origin).toString("base64url") + ".json",
  );
if (
  path.resolve(configDirectory) === root ||
  path.resolve(configDirectory).startsWith(root + path.sep)
)
  throw new Error(
    "Companion credentials and backups must be outside the selected source folder",
  );
await fs.mkdir(configDirectory, { recursive: true, mode: 0o700 });
let credentials;
async function api(route, body, token) {
  const response = await fetch(new URL("/api/companions" + route, server), {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(20000),
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 401)
      throw new Error("Device was revoked or expired. Pair again.");
    throw new Error("Companion request refused (" + response.status + ")");
  }
  return response.json();
}
if (args.includes("--code")) {
  credentials = await api("/device/pair", {
    code: value("--code"),
    label: os.hostname().slice(0, 80),
    rootName: path.basename(root).slice(0, 80) || "Selected folder",
    writable,
  });
  await fs.writeFile(
    credentialsFile,
    JSON.stringify({ ...credentials, root, writable }),
    { mode: 0o600 },
  );
} else {
  credentials = JSON.parse(await fs.readFile(credentialsFile, "utf8"));
  if (credentials.root !== root || credentials.writable !== writable)
    throw new Error(
      "Selected folder or write mode changed. Revoke the old connection and pair again.",
    );
}
console.log(
  `Sebby companion connected for ${path.basename(root)} (${writable ? "reviewed writes with backups" : "read-only"}). Press Ctrl+C to disconnect this process.`,
);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    stopping = true;
  });
while (!stopping) {
  try {
    const { job } = await api("/device/poll", {}, credentials.token);
    if (job) {
      let result;
      try {
        result = await localTask(root, job, {
          writable,
          backupDirectory: path.join(configDirectory, "backups"),
        });
      } catch (error) {
        result = { ok: false, error: String(error.message).slice(0, 400) };
      }
      await fs.appendFile(
        path.join(configDirectory, "actions.jsonl"),
        JSON.stringify({
          time: new Date().toISOString(),
          jobId: job.id,
          operation: job.operation,
          path: job.path || null,
          ok: result.ok,
        }) + "\n",
        { mode: 0o600 },
      );
      await api(
        "/device/result/" + encodeURIComponent(job.id),
        result,
        credentials.token,
      );
    }
  } catch (error) {
    console.error(error.message);
    if (/revoked or expired/.test(error.message)) break;
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, 2000));
}
