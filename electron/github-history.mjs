import { randomUUID } from "node:crypto";
import {
  StrictGitHubStore,
  exact,
  canonicalRepository,
  validTime,
} from "./github-authority.mjs";
const GRAPH = {
  prepared: ["creating-objects", "cancelled", "failed", "uncertain"],
  "creating-objects": ["commit-created", "uncertain", "failed", "cancelled"],
  "commit-created": ["creating-branch", "uncertain", "cancelled"],
  "creating-branch": ["branch-created", "uncertain", "failed"],
  "branch-created": ["creating-pr"],
  "creating-pr": ["published", "uncertain", "failed", "cancelled"],
  published: [],
  uncertain: [],
  failed: [],
  cancelled: [],
};
const ERRORS = [
  "network-error",
  "timeout",
  "cancelled",
  "response-invalid",
  "permission-denied",
  "remote-rejected",
  "restart-interrupted",
];
const uuid = (x) =>
  typeof x === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
    x,
  );
const sha = (x) => typeof x === "string" && /^[a-f0-9]{40}$/.test(x);
const outcome = (phase) =>
  ["published", "uncertain", "failed", "cancelled", "branch-created"].includes(
    phase,
  )
    ? phase
    : "pending";
function branch(value) {
  if (
    typeof value !== "string" ||
    value.length > 200 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(value) ||
    value.includes("..") ||
    value.includes("//") ||
    value.includes("@{") ||
    value
      .split("/")
      .some(
        (x) =>
          !x || x.startsWith(".") || x.endsWith(".") || x.endsWith(".lock"),
      )
  )
    throw Error("Invalid Git branch.");
  return value;
}
function files(values) {
  if (!Array.isArray(values) || !values.length || values.length > 100)
    throw Error("Invalid publication file count.");
  const seen = new Set();
  for (const item of values) {
    exact(item, ["path", "sha256"]);
    if (
      typeof item.path !== "string" ||
      item.path.length > 512 ||
      /[\\\x00-\x1f\x7f:]/.test(item.path) ||
      item.path
        .split("/")
        .some(
          (x) => !x || x === "." || x === ".." || x.toLowerCase() === ".git",
        ) ||
      seen.has(item.path) ||
      typeof item.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(item.sha256)
    )
      throw Error("Invalid publication path/hash metadata.");
    seen.add(item.path);
  }
}
function record(item) {
  exact(item, [
    "id",
    "owner",
    "repo",
    "baseBranch",
    "baseSHA",
    "newBranch",
    "files",
    "phase",
    "outcome",
    "treeSHA",
    "commitSHA",
    "prNumber",
    "errorCode",
    "createdAt",
    "updatedAt",
  ]);
  const canonical = canonicalRepository({ owner: item.owner, repo: item.repo });
  if (
    !uuid(item.id) ||
    canonical.owner !== item.owner ||
    canonical.repo !== item.repo ||
    !sha(item.baseSHA) ||
    !Object.hasOwn(GRAPH, item.phase) ||
    item.outcome !== outcome(item.phase)
  )
    throw Error("Invalid publication record.");
  branch(item.baseBranch);
  branch(item.newBranch);
  if (item.newBranch === item.baseBranch)
    throw Error("New branch must differ from base.");
  files(item.files);
  for (const key of ["treeSHA", "commitSHA"])
    if (item[key] !== null && !sha(item[key]))
      throw Error("Invalid verified SHA.");
  if (
    item.prNumber !== null &&
    (!Number.isSafeInteger(item.prNumber) || item.prNumber < 1)
  )
    throw Error("Invalid verified PR number.");
  if (item.errorCode !== null && !ERRORS.includes(item.errorCode))
    throw Error("Unknown publication error code.");
  if (
    [
      "commit-created",
      "creating-branch",
      "branch-created",
      "creating-pr",
      "published",
    ].includes(item.phase) &&
    (!item.commitSHA || !item.treeSHA)
  )
    throw Error("Verified commit/tree evidence required.");
  if (item.phase === "published" && !item.prNumber)
    throw Error("Verified draft PR evidence required.");
  validTime(item.createdAt);
  validTime(item.updatedAt);
  if (item.updatedAt < item.createdAt) throw Error("Invalid timestamp order.");
}
function validate(value) {
  exact(value, ["version", "operations"]);
  if (
    value.version !== 1 ||
    !Array.isArray(value.operations) ||
    value.operations.length > 200
  )
    throw Error("Invalid publication history.");
  const ids = new Set();
  for (const item of value.operations) {
    record(item);
    if (ids.has(item.id)) throw Error("Duplicate operation ID.");
    ids.add(item.id);
  }
  return structuredClone(value);
}
export class GitHubHistory extends StrictGitHubStore {
  constructor(directory) {
    super(directory, "sebby-github-history.json", validate, {
      version: 1,
      operations: [],
    });
  }
  load() {
    return this.serial(async () => {
      this.loaded = false;
      const document = await this.read();
      let changed = false;
      for (const item of document.operations)
        if (
          [
            "prepared",
            "creating-objects",
            "commit-created",
            "creating-branch",
            "creating-pr",
          ].includes(item.phase)
        ) {
          item.phase = "uncertain";
          item.outcome = "uncertain";
          item.errorCode = "restart-interrupted";
          item.updatedAt = Math.max(Date.now(), item.updatedAt);
          changed = true;
        }
      if (changed) await this.write(document);
      else this.document = document;
      this.loaded = true;
      return this.list();
    });
  }
  list() {
    this.requireLoaded();
    return structuredClone(this.document.operations);
  }
  get(id) {
    this.requireLoaded();
    if (!uuid(id)) throw Error("Invalid operation ID.");
    const item = this.document.operations.find((x) => x.id === id);
    if (!item) throw Error("Publication operation not found.");
    return structuredClone(item);
  }
  begin(input) {
    exact(input, [
      "owner",
      "repo",
      "baseBranch",
      "baseSHA",
      "newBranch",
      "files",
    ]);
    input = structuredClone(input);
    return this.serial(async () => {
      this.requireLoaded();
      const canonical = canonicalRepository({
          owner: input.owner,
          repo: input.repo,
        }),
        now = Date.now();
      const item = {
        id: randomUUID(),
        ...canonical,
        baseBranch: input.baseBranch,
        baseSHA: input.baseSHA,
        newBranch: input.newBranch,
        files: structuredClone(input.files),
        phase: "prepared",
        outcome: "pending",
        treeSHA: null,
        commitSHA: null,
        prNumber: null,
        errorCode: null,
        createdAt: now,
        updatedAt: now,
      };
      record(item);
      const next = structuredClone(this.document);
      // Never evict uncertain or pending publication evidence to make space.
      if (next.operations.length >= 200)
        throw Error(
          "Publication history full; review/export before adding operations.",
        );
      next.operations.push(item);
      await this.write(next);
      return structuredClone(item);
    });
  }
  advance(id, patch) {
    exact(patch, ["phase", "treeSHA", "commitSHA", "prNumber", "errorCode"]);
    patch = structuredClone(patch);
    return this.serial(async () => {
      this.requireLoaded();
      const previous = this.get(id);
      if (!GRAPH[previous.phase].includes(patch.phase))
        throw Error("Invalid publication phase transition.");
      for (const key of ["treeSHA", "commitSHA", "prNumber"])
        if (
          Object.hasOwn(patch, key) &&
          previous[key] !== null &&
          previous[key] !== patch[key]
        )
          throw Error("Verified publication evidence is immutable.");
      if (
        (Object.hasOwn(patch, "treeSHA") ||
          Object.hasOwn(patch, "commitSHA")) &&
        patch.phase !== "commit-created"
      )
        throw Error(
          "Commit evidence only accepted with verified commit stage.",
        );
      if (Object.hasOwn(patch, "prNumber") && patch.phase !== "published")
        throw Error("PR evidence only accepted with verified publication.");
      const item = {
        ...previous,
        ...patch,
        outcome: outcome(patch.phase),
        updatedAt: Math.max(Date.now(), previous.updatedAt),
      };
      record(item);
      const next = structuredClone(this.document);
      next.operations[next.operations.findIndex((x) => x.id === id)] = item;
      await this.write(next);
      return structuredClone(item);
    });
  }
}
