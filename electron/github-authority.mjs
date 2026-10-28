import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function exact(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    throw Error("Unknown or invalid GitHub authority/history fields.");
}
export function canonicalRepository(value) {
  exact(value, ["owner", "repo"]);
  if (
    typeof value.owner !== "string" ||
    !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(value.owner) ||
    typeof value.repo !== "string" ||
    !/^[a-zA-Z0-9_.-]{1,100}$/.test(value.repo) ||
    [".", ".."].includes(value.repo)
  )
    throw Error("Invalid exact GitHub repository.");
  return { owner: value.owner.toLowerCase(), repo: value.repo.toLowerCase() };
}
export function validTime(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw Error("Invalid timestamp.");
  return value;
}
// Main-process local stores only. No renderer-selected paths or authority-bearing backup restore.
export class StrictGitHubStore {
  constructor(directory, filename, validate, empty) {
    this.directory = directory;
    this.file = path.join(directory, filename);
    this.validate = validate;
    this.empty = empty;
    this.loaded = false;
    this.tail = Promise.resolve();
  }
  serial(fn) {
    const next = this.tail.then(fn);
    this.tail = next.catch(() => {});
    return next;
  }
  async read() {
    await fs.mkdir(this.directory, { recursive: true });
    const parent = await fs.lstat(this.directory);
    if (!parent.isDirectory() || parent.isSymbolicLink())
      throw Error("Unsafe GitHub store directory.");
    try {
      const stat = await fs.lstat(this.file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > 2 * 1024 * 1024
      )
        throw Error("Unsafe GitHub store file.");
      return this.validate(JSON.parse(await fs.readFile(this.file, "utf8")));
    } catch (error) {
      if (error.code === "ENOENT") return structuredClone(this.empty);
      throw Error("GitHub store is corrupt or unsafe; original preserved.");
    }
  }
  async write(document) {
    const checked = this.validate(document),
      text = JSON.stringify(checked, null, 2);
    if (Buffer.byteLength(text) > 2 * 1024 * 1024)
      throw Error("GitHub store size limit reached.");
    try {
      const stat = await fs.lstat(this.file);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw Error("Unsafe GitHub store file.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temp, "wx", 0o600);
      try {
        await handle.writeFile(text);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temp, this.file);
    } finally {
      await fs.rm(temp, { force: true });
    }
    this.document = checked;
  }
  requireLoaded() {
    if (!this.loaded) throw Error("Load GitHub store first.");
  }
}
const CAPABILITIES = Object.freeze(["new-branch-commit", "draft-pr"]);
function validate(document) {
  exact(document, ["version", "repositories"]);
  if (
    document.version !== 1 ||
    !Array.isArray(document.repositories) ||
    document.repositories.length > 100
  )
    throw Error("Invalid GitHub authority document.");
  const seen = new Set();
  for (const item of document.repositories) {
    exact(item, ["owner", "repo", "grantedAt"]);
    const canonical = canonicalRepository({
      owner: item.owner,
      repo: item.repo,
    });
    if (
      canonical.owner !== item.owner ||
      canonical.repo !== item.repo ||
      seen.has(`${item.owner}/${item.repo}`)
    )
      throw Error("Invalid canonical authority repository.");
    seen.add(`${item.owner}/${item.repo}`);
    validTime(item.grantedAt);
  }
  return structuredClone(document);
}
export class GitHubAuthority extends StrictGitHubStore {
  constructor(directory, { approve = async () => false } = {}) {
    super(directory, "sebby-github-authority.json", validate, {
      version: 1,
      repositories: [],
    });
    this.approve = approve;
  }
  load() {
    return this.serial(async () => {
      this.loaded = false;
      this.document = await this.read();
      this.loaded = true;
      return this.list();
    });
  }
  list() {
    this.requireLoaded();
    return structuredClone(this.document.repositories);
  }
  isAllowed(repository) {
    this.requireLoaded();
    const { owner, repo } = canonicalRepository(repository);
    return this.document.repositories.some(
      (x) => x.owner === owner && x.repo === repo,
    );
  }
  change(repository, grant) {
    const canonical = canonicalRepository(repository);
    return this.serial(async () => {
      this.requireLoaded();
      if (
        (await this.approve({
          action: grant
            ? "grant-github-publication"
            : "revoke-github-publication",
          ...canonical,
          capabilities: [...CAPABILITIES],
        })) !== true
      )
        return { approved: false, allowed: this.isAllowed(canonical) };
      const next = structuredClone(this.document);
      next.repositories = next.repositories.filter(
        (x) => x.owner !== canonical.owner || x.repo !== canonical.repo,
      );
      if (grant)
        next.repositories.push({ ...canonical, grantedAt: Date.now() });
      await this.write(next);
      return { approved: true, allowed: grant };
    });
  }
  grant(repository) {
    return this.change(repository, true);
  }
  revoke(repository) {
    return this.change(repository, false);
  }
}
