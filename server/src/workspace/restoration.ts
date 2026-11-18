import { createHash } from "node:crypto";
import { db } from "../db.js";
import { documentSchema, type Project, type RestoreReview } from "./schema.js";
import {
  ownedProject,
  revisionDocument,
  revisionDiff,
  rememberRevision,
  snapshotHash,
} from "./repository.js";
export class RestoreError extends Error {
  constructor(
    public status: 400 | 404 | 409 | 503,
    message: string,
  ) {
    super(message);
  }
}
db.exec(`CREATE TABLE IF NOT EXISTS workspace_restores (
 project_id TEXT NOT NULL, revision INTEGER NOT NULL, source_revision INTEGER NOT NULL,
 base_revision INTEGER NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),review_hash TEXT NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,revision),
 FOREIGN KEY(project_id,revision) REFERENCES workspace_revisions(project_id,revision) ON DELETE CASCADE,
 FOREIGN KEY(project_id,source_revision) REFERENCES workspace_revisions(project_id,revision)
);`);
function candidate(userId: string, id: string, base: number, target: number) {
  if (
    !Number.isSafeInteger(base) ||
    !Number.isSafeInteger(target) ||
    base < 1 ||
    target < 1
  )
    throw new RestoreError(400, "Choose positive saved revision numbers");
  const project = ownedProject(userId, id);
  if (!project) throw new RestoreError(404, "Project not found");
  if (project.revision !== base)
    throw new RestoreError(
      409,
      "This project changed. Reopen it and review the restoration again.",
    );
  if (target >= base)
    throw new RestoreError(409, "Choose an earlier saved revision to restore");
  const after = revisionDocument(id, target);
  if (!after) throw new RestoreError(404, "Saved revision not found");
  const before = documentSchema.parse({
    name: project.name,
    files: project.files,
    scene: project.scene,
  });
  if (snapshotHash(before) === snapshotHash(after))
    throw new RestoreError(
      409,
      "That revision already matches the current project",
    );
  const reviewHash = createHash("sha256")
    .update(
      JSON.stringify({
        userId,
        id,
        base,
        target,
        before: snapshotHash(before),
        after: snapshotHash(after),
      }),
    )
    .digest("hex");
  return { project, before, after, reviewHash };
}
export async function reviewRestoration(
  userId: string,
  id: string,
  base: number,
  target: number,
): Promise<RestoreReview> {
  const prepared = candidate(userId, id, base, target);
  let changes;
  try {
    changes = await revisionDiff(prepared.before, prepared.after);
  } catch {
    throw new RestoreError(
      503,
      "Could not prepare restoration diff. Verify the server Git installation.",
    );
  }
  const current = ownedProject(userId, id);
  if (!current) throw new RestoreError(404, "Project not found");
  if (current.revision !== base)
    throw new RestoreError(
      409,
      "Project changed while preparing the review. Reopen it and try again.",
    );
  return {
    projectId: id,
    baseRevision: base,
    targetRevision: target,
    reviewHash: prepared.reviewHash,
    ...changes,
    beforeName: prepared.before.name,
    afterName: prepared.after.name,
    beforeScene: prepared.before.scene,
    afterScene: prepared.after.scene,
  };
}
export function applyRestoration(
  userId: string,
  id: string,
  base: number,
  target: number,
  reviewHash: string,
): Project {
  return db.transaction(() => {
    const prepared = candidate(userId, id, base, target);
    if (reviewHash !== prepared.reviewHash)
      throw new RestoreError(
        409,
        "The restoration review no longer matches. Review it again before applying.",
      );
    const updatedAt = Date.now(),
      revision = base + 1;
    const result = db
      .prepare(
        "UPDATE workspace_projects SET name=?,document=?,revision=?,updated_at=? WHERE id=? AND user_id=? AND revision=?",
      )
      .run(
        prepared.after.name,
        JSON.stringify(prepared.after),
        revision,
        updatedAt,
        id,
        userId,
        base,
      );
    if (!result.changes)
      throw new RestoreError(409, "Project changed before restoration");
    rememberRevision(id, revision, prepared.after);
    db.prepare(
      "INSERT INTO workspace_restores(project_id,revision,source_revision,base_revision,user_id,review_hash,created_at) VALUES(?,?,?,?,?,?,?)",
    ).run(id, revision, target, base, userId, reviewHash, updatedAt);
    return { ...prepared.after, id, revision, updatedAt };
  })();
}
