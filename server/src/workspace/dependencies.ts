import { createHash } from "node:crypto";
import type { ProjectDocument } from "./schema.js";
export const PINNED_IMAGE =
  /^[a-zA-Z0-9][a-zA-Z0-9._/:_-]*@sha256:[a-f0-9]{64}$/;
export class DependencyError extends Error {
  constructor(
    public status: 400 | 503,
    message: string,
  ) {
    super(message);
  }
}
const sections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const canonical = (value: unknown) => {
  if (value == null) return "{}";
  if (typeof value !== "object" || Array.isArray(value))
    throw new DependencyError(400, "Dependency declarations must be objects");
  const entries = Object.entries(value);
  if (entries.some(([, v]) => typeof v !== "string" || !v))
    throw new DependencyError(
      400,
      "Dependency versions must be nonempty strings",
    );
  return JSON.stringify(
    Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b))),
  );
};
export function dependencyFingerprint(
  document: ProjectDocument,
): string | null {
  let pkg: any;
  try {
    pkg = JSON.parse(
      document.files.find((f) => f.path === "package.json")?.content || "",
    );
  } catch {
    throw new DependencyError(400, "Add a valid package.json");
  }
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg))
    throw new DependencyError(400, "package.json must be an object");
  if (pkg.workspaces != null)
    throw new DependencyError(
      400,
      "Workspace dependency layouts are not supported by this runner yet",
    );
  const hasDependencies = sections.some((s) => canonical(pkg[s]) !== "{}");
  const lock = document.files.find((f) => f.path === "package-lock.json");
  if (!lock) {
    if (hasDependencies)
      throw new DependencyError(
        400,
        "Dependency projects require a matching package-lock.json and a prebuilt dependency image.",
      );
    return null;
  }
  let data: any;
  try {
    data = JSON.parse(lock.content);
  } catch {
    throw new DependencyError(400, "package-lock.json is not valid JSON");
  }
  if (
    !data ||
    ![2, 3].includes(data.lockfileVersion) ||
    !data.packages ||
    typeof data.packages !== "object" ||
    Array.isArray(data.packages) ||
    !data.packages[""]
  )
    throw new DependencyError(
      400,
      "Use an npm lockfile version 2 or 3 with root package metadata",
    );
  for (const s of sections)
    if (canonical(pkg[s]) !== canonical(data.packages[""][s]))
      throw new DependencyError(
        400,
        "package.json dependency declarations do not match the lockfile",
      );
  if (Object.values(data.packages).some((p: any) => p?.link))
    throw new DependencyError(
      400,
      "Linked/workspace dependencies are not supported yet",
    );
  return hasDependencies
    ? createHash("sha256").update(lock.content).digest("hex")
    : null;
}
export type DependencyPlan = { image: string; lockHash: string | null };
export function dependencyPlan(
  document: ProjectDocument | undefined,
  defaultImage: string,
  catalogRaw: string,
): DependencyPlan {
  const lockHash = document ? dependencyFingerprint(document) : null;
  if (!lockHash) {
    if (!PINNED_IMAGE.test(defaultImage))
      throw new DependencyError(
        503,
        "Configure a preloaded, digest-pinned SEBBY_RUNNER_IMAGE on a rootless Docker worker.",
      );
    return { image: defaultImage, lockHash: null };
  }
  let catalog: unknown;
  try {
    catalog = JSON.parse(catalogRaw || "[]");
  } catch {
    throw new DependencyError(
      503,
      "The dependency image catalog is not valid JSON",
    );
  }
  if (!Array.isArray(catalog) || catalog.length > 100)
    throw new DependencyError(503, "The dependency image catalog is invalid");
  for (const item of catalog)
    if (
      !item ||
      typeof item.lockHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(item.lockHash) ||
      typeof item.image !== "string" ||
      !PINNED_IMAGE.test(item.image)
    )
      throw new DependencyError(
        503,
        "Dependency images require exact lock hashes and digest-pinned image names",
      );
  const matches = catalog.filter((item) => item.lockHash === lockHash);
  if (matches.length !== 1)
    throw new DependencyError(
      503,
      "No unique prebuilt dependency image matches this exact lockfile. Ask the worker operator to provision one.",
    );
  return { image: matches[0].image, lockHash };
}
