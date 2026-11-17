import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import { db } from "../db.js";
import { ownedProject } from "./repository.js";
import {
  artifactPath,
  validateArtifacts,
  type ValidatedArtifacts,
} from "./artifact-protocol.js";
import type { BuildManifest } from "./schema.js";
db.exec(`CREATE TABLE IF NOT EXISTS workspace_builds (
 run_id TEXT PRIMARY KEY REFERENCES workspace_runs(id) ON DELETE CASCADE,
 output_directory TEXT NOT NULL,manifest_hash TEXT NOT NULL,total_bytes INTEGER NOT NULL,created_at INTEGER NOT NULL
); CREATE TABLE IF NOT EXISTS workspace_build_files (
 run_id TEXT NOT NULL REFERENCES workspace_builds(run_id) ON DELETE CASCADE,
 path TEXT NOT NULL,bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,mime TEXT NOT NULL,data BLOB NOT NULL,
 PRIMARY KEY(run_id,path)
);`);
export function retainArtifacts(runId: string, artifacts: ValidatedArtifacts) {
  db.prepare(
    "INSERT INTO workspace_builds(run_id,output_directory,manifest_hash,total_bytes,created_at) VALUES (?,?,?,?,?)",
  ).run(
    runId,
    artifacts.outputDirectory,
    artifacts.manifestHash,
    artifacts.totalBytes,
    Date.now(),
  );
  const insert = db.prepare(
    "INSERT INTO workspace_build_files(run_id,path,bytes,sha256,mime,data) VALUES (?,?,?,?,?,?)",
  );
  for (const file of artifacts.files)
    insert.run(runId, file.path, file.bytes, file.sha256, file.mime, file.data);
}
function accessibleRun(userId: string, runId: string) {
  const run = db
    .prepare("SELECT * FROM workspace_runs WHERE id=?")
    .get(runId) as any;
  return run &&
    run.state === "succeeded" &&
    run.artifact_state === "ready" &&
    ownedProject(userId, run.project_id)
    ? run
    : null;
}
export function buildManifest(
  userId: string,
  runId: string,
): BuildManifest | null {
  const run = accessibleRun(userId, runId);
  if (!run) return null;
  const build = db
    .prepare("SELECT * FROM workspace_builds WHERE run_id=?")
    .get(runId) as any;
  if (!build) return null;
  const files = db
    .prepare(
      "SELECT path,bytes,sha256,mime FROM workspace_build_files WHERE run_id=? ORDER BY path",
    )
    .all(runId) as BuildManifest["files"];
  return {
    runId,
    projectId: run.project_id,
    revision: run.revision,
    sourceHash: run.snapshot_hash,
    image: run.runner_image,
    lockHash: run.dependency_hash,
    outputDirectory: build.output_directory,
    manifestHash: build.manifest_hash,
    totalBytes: build.total_bytes,
    createdAt: build.created_at,
    files,
    previewCandidate: files.some((f) => f.path === "index.html"),
    previewVerified: false,
  };
}
export function readBuildFiles(userId: string, runId: string) {
  if (!buildManifest(userId, runId)) return null;
  const rows = db
    .prepare(
      "SELECT path,bytes,sha256,mime,data FROM workspace_build_files WHERE run_id=? ORDER BY path",
    )
    .all(runId) as {
    path: string;
    bytes: number;
    sha256: string;
    mime: string;
    data: Buffer;
  }[];
  for (const f of rows)
    if (
      !artifactPath(f.path) ||
      f.data.length !== f.bytes ||
      createHash("sha256").update(f.data).digest("hex") !== f.sha256
    )
      throw new Error("Stored build output failed integrity checking");
  return rows;
}
export function buildZip(userId: string, runId: string) {
  const files = readBuildFiles(userId, runId);
  if (!files) return null;
  const archive: Record<string, Uint8Array> = Object.create(null);
  for (const file of files) archive[file.path] = file.data;
  return zipSync(archive, { level: 0 });
}
export { validateArtifacts };
