import { validateMesh } from "./mesh.js";
import { z } from "zod";

const vector = z.tuple([
  z.number().finite().min(-10000).max(10000),
  z.number().finite().min(-10000).max(10000),
  z.number().finite().min(-10000).max(10000),
]);
const scale = z.tuple([
  z.number().min(0.01).max(1000),
  z.number().min(0.01).max(1000),
  z.number().min(0.01).max(1000),
]);
const baseObjectSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    kind: z.enum(["box", "sphere", "cylinder"]),
    position: vector,
    rotation: vector,
    scale,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .strict();
export const meshSchema = z
  .object({
    vertices: z.array(vector).min(1).max(2048),
    faces: z
      .array(z.array(z.number().int().min(0).max(2047)).min(3).max(16))
      .min(1)
      .max(2048),
  })
  .strict()
  .superRefine((mesh, ctx) => {
    const error = validateMesh(mesh);
    if (error) ctx.addIssue({ code: "custom", message: error });
  });
export const objectSchema = z.discriminatedUnion("kind", [
  baseObjectSchema,
  baseObjectSchema
    .extend({ kind: z.literal("mesh"), mesh: meshSchema })
    .strict(),
]);
const fileSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .max(180)
      .refine(
        (p) =>
          !p.startsWith("/") &&
          !p.includes("\\") &&
          p
            .split("/")
            .every(
              (s) =>
                /^[a-zA-Z0-9_@.-]+$/.test(s) &&
                s !== "." &&
                s !== ".." &&
                ![".git", "node_modules"].includes(s.toLowerCase()),
            ),
        "Use a relative project path without traversal",
      ),
    content: z.string().max(100_000),
  })
  .strict();
export const documentSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    files: z
      .array(fileSchema)
      .max(40)
      .refine(
        (a) => new Set(a.map((f) => f.path)).size === a.length,
        "File paths must be unique",
      )
      .refine((a) => {
        const paths = a.map((f) => f.path.toLowerCase());
        const seen = new Set(paths);
        return (
          seen.size === paths.length &&
          paths.every((p) =>
            p
              .split("/")
              .slice(0, -1)
              .every(
                (_, i, parts) => !seen.has(parts.slice(0, i + 1).join("/")),
              ),
          )
        );
      }, "File paths collide or overlap"),
    scene: z
      .object({
        objects: z
          .array(objectSchema)
          .max(100)
          .refine(
            (a) => new Set(a.map((o) => o.id)).size === a.length,
            "Object IDs must be unique",
          ),
      })
      .strict(),
  })
  .strict();
export const saveSchema = documentSchema.extend({
  revision: z.number().int().min(1),
});
export type SceneObject = z.infer<typeof objectSchema>;
export type ProjectDocument = z.infer<typeof documentSchema>;
export type Project = ProjectDocument & {
  id: string;
  revision: number;
  updatedAt: number;
};
export type ProjectSummary = Pick<
  Project,
  "id" | "name" | "revision" | "updatedAt"
>;

export type RunCommand = "build" | "test";
export type RunnerStatus = {
  available: boolean;
  reason: string;
  backend: "docker";
  image?: string;
  lockHash?: string | null;
};
export type RunRecord = {
  id: string;
  projectId: string;
  revision: number;
  command: RunCommand;
  state: string;
  log: string;
  snapshotHash: string | null;
  snapshotCommit: string | null;
  image: string | null;
  lockHash: string | null;
  artifactState: string;
  exitCode: number | null;
  createdAt: number;
  finishedAt: number | null;
};

export type ProjectBinding = {
  botId: string;
  projectId: string;
  grantId: string;
  allowRuns: boolean;
  projectName: string;
};
export type ProposalSummary = {
  id: string;
  projectId: string;
  botId: string;
  botName: string;
  summary: string;
  baseRevision: number;
  state: string;
  reviewHash: string;
  createdAt: number;
  appliedRevision: number | null;
  stale: boolean;
};
export type ProposalReview = {
  proposal: ProposalSummary;
  diff: string;
  sceneChanged: boolean;
  beforeScene: ProjectDocument["scene"];
  afterScene: ProjectDocument["scene"];
};

export type BuildManifest = {
  runId: string;
  projectId: string;
  revision: number;
  sourceHash: string | null;
  image: string | null;
  lockHash: string | null;
  outputDirectory: string;
  manifestHash: string;
  totalBytes: number;
  createdAt: number;
  files: { path: string; bytes: number; sha256: string; mime: string }[];
  previewCandidate: boolean;
  previewVerified: false;
};
export type BuildPreview = {
  html: string;
  warnings: string[];
  runId: string;
  revision: number;
  manifestHash: string;
  previewVerified: false;
};

export type SourceImportReview = {
  document: ProjectDocument;
  archiveSha256: string;
  sourceRoot: string;
  totalBytes: number;
  skipped: { path: string; reason: string }[];
  warnings: string[];
};

export type KnowledgeHit = {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  sha256: string;
  score: number;
};
