import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { db } from "../db.js";
import {
  documentSchema,
  type ProjectBinding,
  type ProjectDocument,
  type ProposalSummary,
} from "./schema.js";
import {
  ownedProject,
  rememberRevision,
  revisionDocument,
  revisionDiff,
} from "./repository.js";

export class WorkspaceError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409 | 503,
    message: string,
  ) {
    super(message);
  }
}
db.exec(`CREATE TABLE IF NOT EXISTS workspace_bindings (
 bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
 grant_id TEXT NOT NULL, allow_runs INTEGER NOT NULL DEFAULT 0
); CREATE TABLE IF NOT EXISTS workspace_proposals (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
 bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, grant_id TEXT NOT NULL,
 summary TEXT NOT NULL, base_revision INTEGER NOT NULL, candidate TEXT NOT NULL,
 review_hash TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL,
 applied_revision INTEGER
); CREATE INDEX IF NOT EXISTS workspace_proposals_project ON workspace_proposals(project_id,created_at);`);

export function bindingFor(
  userId: string,
  botId: string,
): ProjectBinding | null {
  const r = db
    .prepare(
      `SELECT b.bot_id,b.project_id,b.grant_id,b.allow_runs,p.name AS project_name
 FROM workspace_bindings b JOIN bots a ON a.id=b.bot_id JOIN workspace_projects p ON p.id=b.project_id
 WHERE b.bot_id=? AND a.user_id=? AND p.user_id=?`,
    )
    .get(botId, userId, userId) as any;
  return r
    ? {
        botId: r.bot_id,
        projectId: r.project_id,
        grantId: r.grant_id,
        allowRuns: !!r.allow_runs,
        projectName: r.project_name,
      }
    : null;
}
export function assertBinding(
  userId: string,
  botId: string,
  projectId: string,
  grantId: string,
  pinnedGrant?: string | null,
) {
  const b = bindingFor(userId, botId);
  if (
    !b ||
    b.projectId !== projectId ||
    b.grantId !== grantId ||
    (pinnedGrant !== undefined && pinnedGrant !== b.grantId)
  )
    throw new WorkspaceError(
      403,
      "Project assignment changed or is not authorized. Start a new project conversation.",
    );
  return b;
}
export function bindAgent(
  userId: string,
  projectId: string,
  botId: string,
  allowRuns: boolean,
) {
  if (!ownedProject(userId, projectId))
    throw new WorkspaceError(404, "Project not found");
  const bot = db
    .prepare("SELECT * FROM bots WHERE id=? AND user_id=?")
    .get(botId, userId) as any;
  if (!bot || bot.kind === "room" || bot.hidden)
    throw new WorkspaceError(404, "Agent not found");
  return db.transaction(() => {
    db.prepare(
      "UPDATE workspace_proposals SET state='revoked' WHERE bot_id=? AND state='pending'",
    ).run(botId);
    db.prepare(
      "INSERT INTO workspace_bindings(bot_id,project_id,grant_id,allow_runs) VALUES (?,?,?,?) ON CONFLICT(bot_id) DO UPDATE SET project_id=excluded.project_id,grant_id=excluded.grant_id,allow_runs=excluded.allow_runs",
    ).run(botId, projectId, randomUUID(), allowRuns ? 1 : 0);
    return bindingFor(userId, botId)!;
  })();
}
export function unbindAgent(userId: string, projectId: string, botId: string) {
  const b = bindingFor(userId, botId);
  if (!b || b.projectId !== projectId)
    throw new WorkspaceError(404, "Assignment not found");
  db.transaction(() => {
    db.prepare(
      "UPDATE workspace_proposals SET state='revoked' WHERE bot_id=? AND state='pending'",
    ).run(botId);
    db.prepare("DELETE FROM workspace_bindings WHERE bot_id=?").run(botId);
  })();
}
export const proposalInput = z
  .object({
    projectId: z.string().uuid(),
    grantId: z.string().uuid(),
    revision: z.number().int().positive(),
    summary: z.string().trim().min(1).max(4000),
    changes: z
      .array(
        z
          .object({
            path: z.string().min(1).max(180),
            content: z.string().max(100000).nullable(),
          })
          .strict(),
      )
      .max(10)
      .default([]),
    scene: documentSchema.shape.scene.optional(),
  })
  .strict()
  .refine(
    (p) => p.changes.length > 0 || p.scene !== undefined,
    "Propose at least one file or scene change",
  );

export function propose(
  userId: string,
  botId: string,
  input: unknown,
  pinnedGrant?: string | null,
) {
  const parsed = proposalInput.safeParse(input);
  if (!parsed.success)
    throw new WorkspaceError(
      400,
      parsed.error.issues[0]?.message || "Invalid proposal",
    );
  const p = parsed.data;
  return db.transaction(() => {
    assertBinding(userId, botId, p.projectId, p.grantId, pinnedGrant);
    const project = ownedProject(userId, p.projectId)!;
    if (project.revision !== p.revision)
      throw new WorkspaceError(
        409,
        "Read the current project revision before proposing changes.",
      );
    if (
      (
        db
          .prepare(
            "SELECT count(*) AS n FROM workspace_proposals WHERE project_id=? AND state='pending'",
          )
          .get(p.projectId) as any
      ).n >= 20
    )
      throw new WorkspaceError(
        409,
        "Review or reject pending proposals before adding more.",
      );
    if (new Set(p.changes.map((f) => f.path)).size !== p.changes.length)
      throw new WorkspaceError(
        400,
        "A file may appear only once in a proposal",
      );
    let files = [...project.files];
    for (const change of p.changes) {
      if (change.content === null && !files.some((f) => f.path === change.path))
        throw new WorkspaceError(
          400,
          "Cannot remove a file that does not exist",
        );
      const index = files.findIndex((f) => f.path === change.path);
      if (change.content === null) files.splice(index, 1);
      else if (index >= 0)
        files[index] = { path: change.path, content: change.content };
      else files.push({ path: change.path, content: change.content });
    }
    const candidate = documentSchema.safeParse({
      name: project.name,
      files,
      scene: p.scene ?? project.scene,
    });
    if (!candidate.success)
      throw new WorkspaceError(
        400,
        candidate.error.issues[0]?.message || "Invalid proposed project",
      );
    if (
      JSON.stringify(candidate.data.files) === JSON.stringify(project.files) &&
      JSON.stringify(candidate.data.scene) === JSON.stringify(project.scene)
    )
      throw new WorkspaceError(400, "The proposal contains no changes");
    const document = JSON.stringify(candidate.data);
    if (Buffer.byteLength(document) > 950000)
      throw new WorkspaceError(400, "Proposed project exceeds the save limit");
    const id = randomUUID(),
      reviewHash = createHash("sha256")
        .update(
          JSON.stringify({
            projectId: p.projectId,
            botId,
            grantId: p.grantId,
            revision: p.revision,
            summary: p.summary,
            document,
          }),
        )
        .digest("hex");
    db.prepare(
      "INSERT INTO workspace_proposals(id,project_id,bot_id,grant_id,summary,base_revision,candidate,review_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      p.projectId,
      botId,
      p.grantId,
      p.summary,
      p.revision,
      document,
      reviewHash,
      Date.now(),
    );
    return proposalSummary(userId, id)!;
  })();
}
function proposalRow(userId: string, id: string) {
  return db
    .prepare(
      `SELECT r.*,a.name AS bot_name,p.revision AS current_revision FROM workspace_proposals r JOIN workspace_projects p ON p.id=r.project_id JOIN bots a ON a.id=r.bot_id WHERE r.id=? AND p.user_id=? AND a.user_id=?`,
    )
    .get(id, userId, userId) as any;
}
const summary = (r: any): ProposalSummary => ({
  id: r.id,
  projectId: r.project_id,
  botId: r.bot_id,
  botName: r.bot_name,
  summary: r.summary,
  baseRevision: r.base_revision,
  state: r.state,
  reviewHash: r.review_hash,
  createdAt: r.created_at,
  appliedRevision: r.applied_revision,
  stale: r.current_revision !== r.base_revision && r.state === "pending",
});
export function proposalSummary(userId: string, id: string) {
  const row = proposalRow(userId, id);
  return row ? summary(row) : null;
}
export function listProposals(userId: string, projectId: string) {
  if (!ownedProject(userId, projectId))
    throw new WorkspaceError(404, "Project not found");
  return (
    db
      .prepare(
        "SELECT id FROM workspace_proposals WHERE project_id=? ORDER BY created_at DESC LIMIT 100",
      )
      .all(projectId) as { id: string }[]
  ).map((r) => proposalSummary(userId, r.id)!);
}
export async function reviewProposal(userId: string, id: string) {
  const r = proposalRow(userId, id);
  if (!r) throw new WorkspaceError(404, "Proposal not found");
  const before = revisionDocument(r.project_id, r.base_revision);
  if (!before) throw new WorkspaceError(404, "Base revision not found");
  const candidate = documentSchema.parse(JSON.parse(r.candidate));
  const diff = await revisionDiff(before, candidate);
  return {
    proposal: summary(r),
    diff: diff.diff,
    sceneChanged: diff.sceneChanged,
    beforeScene: before.scene,
    afterScene: candidate.scene,
  };
}
export function applyProposal(userId: string, id: string, reviewHash: string) {
  return db.transaction(() => {
    const r = proposalRow(userId, id);
    if (!r) throw new WorkspaceError(404, "Proposal not found");
    if (r.state !== "pending" || r.review_hash !== reviewHash)
      throw new WorkspaceError(409, "Proposal changed or was already reviewed");
    assertBinding(userId, r.bot_id, r.project_id, r.grant_id);
    const project = ownedProject(userId, r.project_id)!;
    if (project.revision !== r.base_revision)
      throw new WorkspaceError(
        409,
        "This proposal is stale. Ask the agent to revise it against the latest saved project.",
      );
    const candidate: ProjectDocument = documentSchema.parse(
      JSON.parse(r.candidate),
    );
    const revision = project.revision + 1,
      updatedAt = Date.now();
    const saved = db
      .prepare(
        "UPDATE workspace_projects SET name=?,document=?,revision=?,updated_at=? WHERE id=? AND user_id=? AND revision=?",
      )
      .run(
        candidate.name,
        JSON.stringify(candidate),
        revision,
        updatedAt,
        project.id,
        userId,
        project.revision,
      );
    if (!saved.changes)
      throw new WorkspaceError(409, "Project revision changed before applying");
    rememberRevision(project.id, revision, candidate);
    db.prepare(
      "UPDATE workspace_proposals SET state='applied',applied_revision=? WHERE id=?",
    ).run(revision, id);
    return { ...candidate, id: project.id, revision, updatedAt };
  })();
}
export function rejectProposal(userId: string, id: string) {
  return db.transaction(() => {
    const r = proposalRow(userId, id);
    if (!r) throw new WorkspaceError(404, "Proposal not found");
    if (r.state !== "pending")
      throw new WorkspaceError(409, "Proposal was already reviewed or revoked");
    db.prepare(
      "UPDATE workspace_proposals SET state='rejected' WHERE id=?",
    ).run(id);
    return proposalSummary(userId, id)!;
  })();
}
