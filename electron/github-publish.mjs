import { directGitHubPublishRequest } from "./github-publish-transport.mjs";
import dns from "node:dns/promises";
import { isIP } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { isPublicAddress } from "./mcp-discovery.mjs";
import { validateRelative } from "./services.mjs";
import { validateGitHubConfig } from "./github-storage.mjs";
const LIMIT = 1024 * 1024,
  FILE_LIMIT = 64 * 1024,
  TOTAL_LIMIT = 512 * 1024;
const SHA = /^[a-f0-9]{40}$/;
const CONTROLS =
  /[\x00-\x1f\x7f-\x9f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f]/;
const exact = (v, keys) => {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(v, k))
  )
    throw Error("Invalid publication request.");
};
const digest = (s) => createHash("sha256").update(s).digest("hex");
const blobHash = (b) =>
  createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
const clone = (v) => structuredClone(v);
const branchName = (s) =>
  typeof s === "string" &&
  s.length <= 120 &&
  /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(s) &&
  !s.includes("..") &&
  !s.includes("//") &&
  !s.endsWith("/") &&
  s
    .split("/")
    .every(
      (p) => !p.startsWith(".") && !p.endsWith(".") && !p.endsWith(".lock"),
    ) &&
  !/^(github_pat_|gh[pousr]_)/.test(s);
function text(v, max, empty = false) {
  if (
    typeof v !== "string" ||
    (!empty && !v.trim()) ||
    Buffer.byteLength(v) > max ||
    v.includes("\0")
  )
    throw Error("Invalid bounded text.");
  return v;
}
function pathName(p) {
  validateRelative(p);
  if (
    CONTROLS.test(p) ||
    p.split("/").some((x) => x.startsWith(".")) ||
    p.length > 240
  )
    throw Error("Unsupported publication path.");
  return p;
}
function source(s) {
  text(s, FILE_LIMIT, true);
  if (
    /(?:github_pat_[A-Za-z0-9_]{15,}|gh[pousr]_[A-Za-z0-9]{15,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(
      s,
    )
  )
    throw Error("Possible credential content; publication blocked.");
  return s;
}
function parseBlob(v, expected) {
  if (
    !v ||
    v.sha !== expected ||
    v.encoding !== "base64" ||
    typeof v.content !== "string" ||
    !Number.isSafeInteger(v.size) ||
    v.size < 0 ||
    v.size > FILE_LIMIT
  )
    throw Error("Invalid remote text blob.");
  const b64 = v.content.replace(/\n/g, "");
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      b64,
    )
  )
    throw Error("Invalid remote text blob.");
  const b = Buffer.from(b64, "base64");
  if (
    b.toString("base64") !== b64 ||
    b.length !== v.size ||
    blobHash(b) !== expected
  )
    throw Error("Remote blob verification failed.");
  return source(new TextDecoder("utf-8", { fatal: true }).decode(b));
}
const encoded = (s) => s.split("/").map(encodeURIComponent).join("/");
const safeLabel = (s) =>
  typeof s === "string"
    ? s
        .replace(
          /[\x00-\x1f\x7f-\x9f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g,
          " ",
        )
        .slice(0, 150)
    : "";
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const stop = () => reject(Error("cancelled"));
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", stop));
  });
}
export class GitHubPublisher {
  #run = null;
  #closed = false;
  #proposals = new Map();
  #last = null;
  constructor({
    workspace,
    config,
    vault,
    permissions,
    history,
    approveRead = async () => false,
    approvePublish = async () => false,
    approvePR = async () => false,
    transport = directGitHubPublishRequest,
    resolve = (host) => dns.lookup(host, { all: true, verbatim: true }),
  }) {
    Object.assign(this, {
      workspace,
      config,
      vault,
      permissions,
      history,
      approveRead,
      approvePublish,
      approvePR,
      transport,
      resolve,
    });
  }
  get isBusy() {
    return !!this.#run;
  }
  status() {
    return {
      busy: this.isBusy,
      operation: this.#run?.operation || null,
      lastOutcome: this.#last,
      proposalIds: [...this.#proposals.keys()],
    };
  }
  cancel() {
    const cancelled = this.isBusy;
    this.#run?.controller.abort();
    return { cancelled };
  }
  shutdown() {
    this.#closed = true;
    this.cancel();
    this.#proposals.clear();
  }
  discard(input) {
    exact(input, ["proposalId"]);
    if (this.isBusy) throw Error("Publication operation pending.");
    if (typeof input.proposalId !== "string")
      throw Error("Invalid proposal ID.");
    return { discarded: this.#proposals.delete(input.proposalId) };
  }
  clearCache() {
    if (this.isBusy) throw Error("Publication operation pending.");
    this.#proposals.clear();
  }
  #check(run) {
    if (this.#closed || run.controller.signal.aborted) throw Error("cancelled");
  }
  async #allowed(cfg) {
    if (
      !cfg.useToken ||
      !cfg.owner ||
      !cfg.repo ||
      !(await this.permissions.isAllowed({ owner: cfg.owner, repo: cfg.repo }))
    )
      throw Error(
        "Repository publication permission and explicit token use are required.",
      );
  }
  #same(cfg, root) {
    if (
      JSON.stringify(this.config.get()) !== JSON.stringify(cfg) ||
      (root !== undefined && this.workspace.root !== root)
    )
      throw Error("Configuration or workspace changed. Prepare again.");
  }
  async #request(run, cfg, suffix, method = "GET", body) {
    this.#check(run);
    this.#same(cfg);
    await this.#allowed(cfg);
    this.#check(run);
    const token = await this.vault.getToken();
    this.#check(run);
    if (!token) throw Error("Configure a GitHub token first.");
    const addresses = await abortable(
      this.resolve("api.github.com"),
      run.controller.signal,
    );
    this.#check(run);
    if (
      !Array.isArray(addresses) ||
      !addresses.length ||
      addresses.length > 32 ||
      addresses.some(
        (a) => !isPublicAddress(a.address) || isIP(a.address) !== a.family,
      )
    )
      throw Error("Unsafe GitHub address.");
    this.#same(cfg);
    await this.#allowed(cfg);
    this.#check(run);
    if (method === "POST") run.writeAttempted = true;
    const response = await abortable(
      this.transport({
        apiPath: `/repos/${cfg.owner}/${cfg.repo}${suffix}`,
        method,
        body,
        token,
        address: addresses[0].address,
        family: addresses[0].family,
        signal: run.controller.signal,
      }),
      run.controller.signal,
    );
    this.#check(run);
    if (!response || response.status !== (method === "POST" ? 201 : 200))
      throw Error(
        "GitHub request rejected; inspect the repository before retrying.",
      );
    if (
      !/^application\/(?:json|vnd\.github\+json)(?:\s*;|$)/i.test(
        response.headers?.["content-type"] || "",
      ) ||
      typeof response.body !== "string" ||
      Buffer.byteLength(response.body) > LIMIT
    )
      throw Error("Invalid bounded GitHub response.");
    return JSON.parse(response.body);
  }
  async #head(run, cfg, branch) {
    const v = await this.#request(
      run,
      cfg,
      `/git/ref/heads/${encoded(branch)}`,
    );
    if (
      v.ref !== `refs/heads/${branch}` ||
      v.object?.type !== "commit" ||
      !SHA.test(v.object.sha)
    )
      throw Error("Unexpected GitHub branch response.");
    return v.object.sha;
  }
  async #operate(operation, fn) {
    if (this.#closed) throw Error("Publication service is shut down.");
    if (this.isBusy) throw Error("Publication operation pending.");
    const run = {
      operation,
      controller: new AbortController(),
      writeAttempted: false,
      record: null,
    };
    this.#run = run;
    const timer = setTimeout(() => run.controller.abort(), 120000);
    try {
      const result = await fn(run);
      this.#last = result.status;
      return result;
    } catch {
      const status = run.writeAttempted
        ? "uncertain"
        : run.controller.signal.aborted
          ? "cancelled"
          : "error";
      if (run.record) {
        try {
          run.record = await this.history.advance(run.record.id, {
            phase: status === "error" ? "failed" : status,
          });
        } catch {
          /* persisted prior intent remains evidence; never hide possible writes */
        }
      }
      this.#last = status;
      return {
        status,
        message:
          status === "uncertain"
            ? "Remote writes may have occurred. No automatic retry; inspect GitHub and the publication journal."
            : "Publication stopped. Check configuration, consent, unchanged files, permissions and repository state.",
        ...(run.record ? { publication: run.record } : {}),
      };
    } finally {
      clearTimeout(timer);
      this.#run = null;
    }
  }
  async prepare(input) {
    input = clone(input);
    exact(input, ["paths", "baseBranch", "branch", "message"]);
    if (
      !Array.isArray(input.paths) ||
      !input.paths.length ||
      input.paths.length > 10 ||
      new Set(input.paths).size !== input.paths.length ||
      !branchName(input.baseBranch) ||
      !branchName(input.branch) ||
      !input.branch.startsWith("sebby/") ||
      input.branch === input.baseBranch
    )
      throw Error("Choose up to ten paths and a new sebby/ branch.");
    input.paths.forEach(pathName);
    text(input.message, 2000);
    if (CONTROLS.test(input.message))
      throw Error("Use a plain single-line commit message.");
    return this.#operate("prepare", async (run) => {
      const cfg = validateGitHubConfig(this.config.get()),
        root = this.workspace.root;
      if (!root) throw Error("Select a workspace.");
      await this.#allowed(cfg);
      this.#check(run);
      const paths = [...input.paths].sort();
      const local = [];
      for (const p of paths) {
        const content = source((await this.workspace.read(p)).content);
        local.push({ path: p, after: content, sha256: digest(content) });
        this.#check(run);
      }
      this.#same(cfg, root);
      const approved = await this.approveRead({
        operation: "prepare-publication",
        owner: cfg.owner,
        repo: cfg.repo,
        baseBranch: input.baseBranch,
        paths,
        maximumRequests: 13,
        notice:
          "Read the exact base branch, its bounded tree and selected text blobs to prepare a full diff. No writes yet.",
      });
      this.#check(run);
      if (approved !== true) return { status: "denied" };
      this.#same(cfg, root);
      const baseSHA = await this.#head(run, cfg, input.baseBranch);
      const commit = await this.#request(run, cfg, `/git/commits/${baseSHA}`);
      if (commit.sha !== baseSHA || !SHA.test(commit.tree?.sha))
        throw Error("Invalid base commit.");
      const treeSHA = commit.tree.sha;
      const tree = await this.#request(
        run,
        cfg,
        `/git/trees/${treeSHA}?recursive=1`,
      );
      if (
        tree.sha !== treeSHA ||
        tree.truncated !== false ||
        !Array.isArray(tree.tree) ||
        tree.tree.length > 10000
      )
        throw Error("Complete bounded base tree required.");
      const entries = new Map();
      for (const entry of tree.tree) {
        if (typeof entry.path !== "string" || entries.has(entry.path))
          throw Error("Invalid base tree.");
        entries.set(entry.path, entry);
      }
      let total = 0;
      const files = [];
      for (const item of local) {
        const parts = item.path.split("/");
        for (let i = 1; i < parts.length; i++) {
          const ancestor = entries.get(parts.slice(0, i).join("/"));
          if (ancestor && ancestor.type !== "tree")
            throw Error("Path collides with an existing object.");
        }
        const old = entries.get(item.path);
        if (
          old &&
          (old.type !== "blob" ||
            old.mode !== "100644" ||
            !SHA.test(old.sha) ||
            old.size > FILE_LIMIT)
        )
          throw Error("Only regular bounded text blobs may be replaced.");
        const before = old
          ? parseBlob(
              await this.#request(run, cfg, `/git/blobs/${old.sha}`),
              old.sha,
            )
          : "";
        total += Buffer.byteLength(before) + Buffer.byteLength(item.after);
        if (total > TOTAL_LIMIT) throw Error("Full diff exceeds review limit.");
        if (before === item.after && old) continue;
        files.push({
          ...item,
          before,
          mode: old?.mode || "100644",
          exists: !!old,
          diff: `--- ${old ? "a/" + item.path : "/dev/null"}\n+++ b/${item.path}\n${before
            .split("\n")
            .map((l) => "-" + l)
            .join("\n")}\n${item.after
            .split("\n")
            .map((l) => "+" + l)
            .join("\n")}`,
        });
      }
      this.#same(cfg, root);
      if (!files.length) throw Error("No changes to publish.");
      const proposal = {
        id: randomUUID(),
        owner: cfg.owner,
        repo: cfg.repo,
        baseBranch: input.baseBranch,
        baseSHA,
        branch: input.branch,
        message: input.message,
        files,
        createdAt: new Date().toISOString(),
      };
      proposal.truncated = false;
      proposal.digest = digest(JSON.stringify(proposal));
      const retained = { proposal, config: cfg, root, treeSHA };
      this.#proposals.clear();
      this.#proposals.set(proposal.id, retained);
      return { status: "ready", proposal: clone(proposal) };
    });
  }
  async publish(input) {
    input = clone(input);
    exact(input, ["proposalId", "digest"]);
    const saved = this.#proposals.get(input.proposalId);
    if (!saved || input.digest !== saved.proposal.digest)
      throw Error("Prepare a new publication preview first.");
    return this.#operate("publish", async (run) => {
      const { proposal: p, config: cfg, root, treeSHA } = saved;
      this.#same(cfg, root);
      await this.#allowed(cfg);
      this.#check(run);
      const approved = await this.approvePublish({
        ...clone(p),
        notice:
          "Publish ONLY these reviewed files to a NEW branch. This uploads source code; repository visibility is unverified, so treat all uploaded content as public. It may trigger existing GitHub Actions and costs, and is not a merge. Base HEAD rechecks are not an atomic lease; it may change afterward. Partial object/ref writes cannot be rolled back automatically.",
      });
      this.#check(run);
      if (approved !== true) return { status: "denied" };
      this.#proposals.delete(p.id);
      this.#same(cfg, root);
      await this.#allowed(cfg);
      for (const f of p.files) {
        if (
          digest(source((await this.workspace.read(f.path)).content)) !==
          f.sha256
        )
          throw Error("Local file changed.");
      }
      this.#same(cfg, root);
      if ((await this.#head(run, cfg, p.baseBranch)) !== p.baseSHA)
        throw Error("Base branch changed.");
      run.record = await this.history.begin({
        owner: cfg.owner,
        repo: cfg.repo,
        baseBranch: p.baseBranch,
        baseSHA: p.baseSHA,
        newBranch: p.branch,
        files: p.files.map((f) => ({ path: f.path, sha256: f.sha256 })),
      });
      this.#check(run);
      run.record = await this.history.advance(run.record.id, {
        phase: "creating-objects",
      });
      const entries = [];
      for (const f of p.files) {
        const blob = await this.#request(run, cfg, "/git/blobs", "POST", {
          content: Buffer.from(f.after).toString("base64"),
          encoding: "base64",
        });
        if (blob.sha !== blobHash(Buffer.from(f.after)))
          throw Error("Created blob mismatch.");
        entries.push({
          path: f.path,
          mode: f.mode,
          type: "blob",
          sha: blob.sha,
        });
      }
      const tree = await this.#request(run, cfg, "/git/trees", "POST", {
        base_tree: treeSHA,
        tree: entries,
      });
      if (!SHA.test(tree.sha)) throw Error("Invalid created tree.");
      const commit = await this.#request(run, cfg, "/git/commits", "POST", {
        message: p.message,
        tree: tree.sha,
        parents: [p.baseSHA],
      });
      if (
        !SHA.test(commit.sha) ||
        commit.tree?.sha !== tree.sha ||
        !Array.isArray(commit.parents) ||
        commit.parents.length !== 1 ||
        commit.parents[0].sha !== p.baseSHA
      )
        throw Error("Invalid created commit.");
      run.record = await this.history.advance(run.record.id, {
        phase: "commit-created",
        treeSHA: tree.sha,
        commitSHA: commit.sha,
      });
      this.#same(cfg, root);
      if ((await this.#head(run, cfg, p.baseBranch)) !== p.baseSHA)
        throw Error("Base branch changed before branch creation.");
      for (const f of p.files) {
        if (
          digest(source((await this.workspace.read(f.path)).content)) !==
          f.sha256
        )
          throw Error("Local file changed before branch creation.");
      }
      this.#same(cfg, root);
      run.record = await this.history.advance(run.record.id, {
        phase: "creating-branch",
      });
      const ref = await this.#request(run, cfg, "/git/refs", "POST", {
        ref: `refs/heads/${p.branch}`,
        sha: commit.sha,
      });
      if (
        ref.ref !== `refs/heads/${p.branch}` ||
        ref.object?.sha !== commit.sha ||
        ref.object?.type !== "commit"
      )
        throw Error("Invalid created branch response.");
      run.record = await this.history.advance(run.record.id, {
        phase: "branch-created",
      });
      return { status: "branch-created", publication: run.record };
    });
  }
  async createDraftPR(input) {
    input = clone(input);
    exact(input, ["publicationId", "title", "body"]);
    text(input.title, 200);
    text(input.body, 8000, true);
    if (CONTROLS.test(input.title)) throw Error("Use a plain PR title.");
    return this.#operate("draft-pr", async (run) => {
      const p = await this.history.get(input.publicationId);
      if (
        !p ||
        p.phase !== "branch-created" ||
        !SHA.test(p.commitSHA) ||
        !branchName(p.baseBranch) ||
        !p.newBranch?.startsWith("sebby/")
      )
        throw Error("A verified newly created branch is required.");
      const cfg = validateGitHubConfig(this.config.get());
      if (
        cfg.owner.toLowerCase() !== p.owner.toLowerCase() ||
        cfg.repo.toLowerCase() !== p.repo.toLowerCase()
      )
        throw Error("Repository changed.");
      await this.#allowed(cfg);
      this.#check(run);
      if (
        (await this.approvePR({
          owner: p.owner,
          repo: p.repo,
          branch: p.newBranch,
          baseBranch: p.baseBranch,
          commitSHA: p.commitSHA,
          title: input.title,
          body: input.body,
          draft: true,
          notice:
            "Create a separate draft pull request. This can notify collaborators and trigger CI. Never merge automatically.",
        })) !== true
      )
        return { status: "denied" };
      this.#check(run);
      if ((await this.#head(run, cfg, p.newBranch)) !== p.commitSHA)
        throw Error("Publication branch changed.");
      run.record = await this.history.advance(p.id, { phase: "creating-pr" });
      const pr = await this.#request(run, cfg, "/pulls", "POST", {
        title: input.title,
        body: input.body,
        head: p.newBranch,
        base: p.baseBranch,
        draft: true,
        maintainer_can_modify: false,
      });
      if (
        !Number.isSafeInteger(pr.number) ||
        pr.number < 1 ||
        pr.draft !== true ||
        pr.head?.sha !== p.commitSHA ||
        pr.head?.ref !== p.newBranch ||
        pr.base?.ref !== p.baseBranch
      )
        throw Error("Invalid draft PR response.");
      run.record = await this.history.advance(p.id, {
        phase: "published",
        prNumber: pr.number,
      });
      return { status: "published", publication: run.record };
    });
  }
  async checks(input) {
    input = clone(input);
    exact(input, ["publicationId"]);
    return this.#operate("checks", async (run) => {
      const p = await this.history.get(input.publicationId);
      if (!p || !SHA.test(p.commitSHA))
        throw Error("Verified journal commit required.");
      const cfg = validateGitHubConfig(this.config.get());
      if (
        cfg.owner.toLowerCase() !== p.owner.toLowerCase() ||
        cfg.repo.toLowerCase() !== p.repo.toLowerCase()
      )
        throw Error("Repository changed.");
      await this.#allowed(cfg);
      this.#check(run);
      if (
        (await this.approveRead({
          operation: "publication-checks",
          owner: p.owner,
          repo: p.repo,
          commitSHA: p.commitSHA,
          maximumRequests: 1,
          notice:
            "Read up to 50 check runs for this recorded commit. No reruns, logs or remote writes.",
        })) !== true
      )
        return { status: "denied" };
      this.#check(run);
      const v = await this.#request(
        run,
        cfg,
        `/commits/${p.commitSHA}/check-runs?per_page=50`,
      );
      if (
        !Array.isArray(v.check_runs) ||
        v.check_runs.length > 50 ||
        !Number.isSafeInteger(v.total_count) ||
        v.total_count < 0 ||
        v.check_runs.some((c) => c.head_sha !== p.commitSHA)
      )
        throw Error("Invalid anchored check results.");
      return {
        status: "ok",
        commitSHA: p.commitSHA,
        checks: v.check_runs.map((c) => ({
          name: safeLabel(c.name),
          status: safeLabel(c.status),
          conclusion: c.conclusion === null ? null : safeLabel(c.conclusion),
        })),
        truncated: v.total_count > v.check_runs.length,
        observedAt: new Date().toISOString(),
      };
    });
  }
}
