import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "../db.js";
import { env } from "../env.js";
import {
  documentSchema,
  type Project,
  type ProjectDocument,
} from "./schema.js";
const exec = promisify(execFile);

db.exec(`CREATE TABLE IF NOT EXISTS workspace_projects (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, document TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
); CREATE INDEX IF NOT EXISTS workspace_projects_owner ON workspace_projects(user_id, updated_at);
CREATE TABLE IF NOT EXISTS workspace_revisions (
 project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL, document TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY (project_id, revision)
); INSERT OR IGNORE INTO workspace_revisions(project_id,revision,document,created_at)
 SELECT id,revision,document,updated_at FROM workspace_projects;`);

export function ownedProject(userId: string, id: string): Project | null {
  const row = db
    .prepare("SELECT * FROM workspace_projects WHERE id=? AND user_id=?")
    .get(id, userId) as any;
  return row
    ? {
        ...JSON.parse(row.document),
        id: row.id,
        revision: row.revision,
        updatedAt: row.updated_at,
      }
    : null;
}
export function revisionDocument(
  id: string,
  revision: number,
): ProjectDocument | null {
  const row = db
    .prepare(
      "SELECT document FROM workspace_revisions WHERE project_id=? AND revision=?",
    )
    .get(id, revision) as { document: string } | undefined;
  return row ? documentSchema.parse(JSON.parse(row.document)) : null;
}
export function rememberRevision(
  id: string,
  revision: number,
  document: ProjectDocument,
) {
  db.prepare(
    "INSERT INTO workspace_revisions(project_id,revision,document,created_at) VALUES (?,?,?,?)",
  ).run(id, revision, JSON.stringify(document), Date.now());
}
export const snapshotHash = (document: ProjectDocument) =>
  createHash("sha256").update(JSON.stringify(document)).digest("hex");

export async function writeSources(root: string, document: ProjectDocument) {
  const parsed = documentSchema.parse(document);
  for (const file of parsed.files) {
    const dest = path.resolve(root, file.path);
    if (!dest.startsWith(path.resolve(root) + path.sep))
      throw new Error("Invalid snapshot path");
    await fs.mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
    await fs.writeFile(dest, file.content, { flag: "wx", mode: 0o600 });
  }
}
const gitArgs = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.attributesFile=/dev/null",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "user.name=Sebby",
  "-c",
  "user.email=workspace@sebby.invalid",
];
async function git(cwd: string, args: string[]) {
  const { stdout } = await exec("git", [...gitArgs, ...args], {
    cwd,
    timeout: 15000,
    maxBuffer: 2_000_000,
    env: {
      PATH: process.env.PATH,
      HOME: cwd,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      LANG: "C.UTF-8",
    },
  });
  return stdout.trim();
}
export async function snapshot(document: ProjectDocument, runId: string) {
  if (!/^[0-9a-f-]{36}$/.test(runId)) throw new Error("Invalid snapshot id");
  const root = path.resolve(
    process.env.SEBBY_RUNS_DIR || path.join(path.dirname(env.dbPath), "runs"),
  );
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const dir = path.join(root, runId);
  await fs.mkdir(dir, { mode: 0o700 });
  try {
    await writeSources(dir, document);
    await git(dir, ["init", "--initial-branch=workspace"]);
    await git(dir, ["add", "--force", "--all", "--", "."]);
    await git(dir, [
      "commit",
      "--allow-empty",
      "-m",
      "Saved Sebby project snapshot",
    ]);
    return {
      directory: dir,
      commit: await git(dir, ["rev-parse", "HEAD"]),
      hash: snapshotHash(document),
    };
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true });
    throw e;
  }
}
export async function revisionDiff(
  before: ProjectDocument,
  after: ProjectDocument,
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-diff-"));
  try {
    await writeSources(dir, before);
    await git(dir, ["init", "--initial-branch=workspace"]);
    await git(dir, ["add", "--force", "--all", "--", "."]);
    await git(dir, ["commit", "--allow-empty", "-m", "Before"]);
    for (const item of await fs.readdir(dir))
      if (item !== ".git")
        await fs.rm(path.join(dir, item), { recursive: true, force: true });
    await writeSources(dir, after);
    await git(dir, ["add", "--force", "--all", "--", "."]);
    const { stdout } = await exec(
      "git",
      [
        ...gitArgs,
        "diff",
        "--cached",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--",
      ],
      {
        cwd: dir,
        timeout: 15000,
        maxBuffer: 2_000_000,
        env: {
          PATH: process.env.PATH,
          HOME: dir,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          LANG: "C.UTF-8",
        },
      },
    );
    return {
      diff: stdout,
      sceneChanged:
        JSON.stringify(before.scene) !== JSON.stringify(after.scene),
      nameChanged: before.name !== after.name,
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
