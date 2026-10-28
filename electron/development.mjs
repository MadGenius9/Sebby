import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { validateRelative, validateText } from "./services.mjs";
export const contentHash = (text) =>
  createHash("sha256").update(text).digest("hex");
const LIMIT = 128 * 1024;
const digest = (value) => contentHash(JSON.stringify(value));
function diff(before, after) {
  // A bounded whole-file diff, deliberately not a heuristic patch application.
  const lines = [
    ...(before === null ? [] : before.split("\n").map((s) => `-${s}`)),
    ...after.split("\n").map((s) => `+${s}`),
  ];
  return {
    text: lines.join("\n").slice(0, 64000),
    truncated: lines.join("\n").length > 64000,
    removedLines: before === null ? 0 : before.split("\n").length,
    addedLines: after.split("\n").length,
  };
}
export class DevelopmentTools {
  constructor(
    workspace,
    {
      backupRoot,
      approve = async () => false,
      executables = {},
      timeoutMs = 60000,
    } = {},
  ) {
    if (!backupRoot || !path.isAbsolute(backupRoot))
      throw new Error("An absolute private backup directory is required.");
    this.workspace = workspace;
    this.backupRoot = backupRoot;
    this.approve = approve;
    this.executables = { ...executables };
    this.timeoutMs = Math.min(120000, Math.max(100, timeoutMs));
    this.proposals = new Map();
    this.history = new Map();
    this.plans = new Map();
    this.running = new Map();
    this.busy = false;
    this.runs = [];
  }
  async rootCheck(root = this.workspace.root) {
    if (
      !root ||
      this.workspace.root !== root ||
      (await fs.lstat(root)).isSymbolicLink() ||
      (await fs.realpath(root)) !== root
    )
      throw new Error("Choose the original project folder again.");
    return root;
  }
  async snapshot(relative, root) {
    await this.rootCheck(root);
    validateRelative(relative);
    try {
      return (await this.workspace.read(relative)).content;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      // Creation is root-only; edits may target existing supported source files.
      if (relative.includes("/"))
        throw new Error("New files must be in the project root.");
      if (
        /[<>"|?*]/.test(relative) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9]) *(\.|$)/i.test(relative)
      )
        throw new Error(
          "Choose a portable filename, not a reserved device name.",
        );
      return null;
    }
  }
  async previewEdit({ path: relative, content, expectedHash } = {}) {
    validateText(content);
    validateRelative(relative);
    if (
      expectedHash !== undefined &&
      expectedHash !== null &&
      !/^[a-f0-9]{64}$/.test(expectedHash)
    )
      throw new Error("Invalid expected content hash.");
    if (this.proposals.size >= 10)
      throw new Error("Discard an existing proposal before creating another.");
    const root = await this.rootCheck();
    const before = await this.snapshot(relative, root);
    const beforeHash = before === null ? null : contentHash(before);
    if (expectedHash !== undefined && expectedHash !== beforeHash)
      throw new Error(
        "The file changed. Read it again before proposing an edit.",
      );
    if (before === content) throw new Error("No content change to propose.");
    const proposal = {
      id: randomUUID(),
      path: relative,
      kind: before === null ? "create" : "edit",
      beforeHash,
      afterHash: contentHash(content),
      diff: diff(before, content),
      bytes: Buffer.byteLength(content),
      workspace: root,
    };
    this.proposals.set(proposal.id, { proposal, root, before, content });
    return structuredClone(proposal);
  }
  discardProposal(id) {
    return this.proposals.delete(id);
  }
  async unchanged(relative, root, hash) {
    const value = await this.snapshot(relative, root);
    if ((value === null ? null : contentHash(value)) !== hash)
      throw new Error(
        "The target changed since preview. Nothing was overwritten.",
      );
  }
  async replace(relative, content, root, expectedHash) {
    await this.unchanged(relative, root, expectedHash);
    const target =
      expectedHash === null
        ? path.join(root, relative)
        : await this.workspace.checked(relative);
    const temporary = path.join(
      path.dirname(target),
      `.sebby-${randomUUID()}.tmp`,
    );
    const mode =
      expectedHash === null ? 0o600 : (await fs.stat(target)).mode & 0o777;
    try {
      const handle = await fs.open(temporary, "wx", mode);
      try {
        await handle.writeFile(content, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.unchanged(relative, root, expectedHash);
      if (expectedHash === null) {
        await fs.link(temporary, target);
      } else {
        await fs.rename(temporary, target);
      }
    } finally {
      await fs.unlink(temporary).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
  async applyProposal(id) {
    if (this.busy || this.running.size)
      throw new Error("Finish the current file or command operation first.");
    const entry = this.proposals.get(id);
    if (!entry) throw new Error("Unknown or expired proposal.");
    if (entry.proposal.diff.truncated)
      throw new Error(
        "The preview is truncated. Shorten this change before approval.",
      );
    this.busy = true;
    try {
      await this.unchanged(
        entry.proposal.path,
        entry.root,
        entry.proposal.beforeHash,
      );
      if (
        !(await this.approve({
          ...structuredClone(entry.proposal),
          operation: entry.proposal.kind,
          kind: "apply-edit",
        }))
      )
        return { applied: false };
      await this.unchanged(
        entry.proposal.path,
        entry.root,
        entry.proposal.beforeHash,
      );
      await fs.mkdir(this.backupRoot, { recursive: true, mode: 0o700 });
      if (entry.before !== null)
        await fs.writeFile(
          path.join(this.backupRoot, `${id}.original`),
          entry.before,
          { flag: "wx", mode: 0o600 },
        );
      await fs.writeFile(
        path.join(this.backupRoot, `${id}.json`),
        JSON.stringify({
          ...entry.proposal,
          savedAt: new Date().toISOString(),
        }),
        { flag: "wx", mode: 0o600 },
      );
      await this.replace(
        entry.proposal.path,
        entry.content,
        entry.root,
        entry.proposal.beforeHash,
      );
      this.history.set(id, entry);
      if (this.history.size > 20)
        this.history.delete(this.history.keys().next().value);
      this.proposals.delete(id);
      return {
        applied: true,
        id,
        path: entry.proposal.path,
        hash: entry.proposal.afterHash,
      };
    } finally {
      this.busy = false;
    }
  }
  async undo(id) {
    if (this.busy || this.running.size)
      throw new Error("Finish the current file or command operation first.");
    const entry = this.history.get(id);
    if (!entry)
      throw new Error(
        "Undo is available only for this session’s successful edits.",
      );
    this.busy = true;
    try {
      await this.unchanged(
        entry.proposal.path,
        entry.root,
        entry.proposal.afterHash,
      );
      if (
        !(await this.approve({
          ...structuredClone(entry.proposal),
          operation: entry.proposal.kind,
          kind: "undo-edit",
          removesCreatedFile: entry.before === null,
        }))
      )
        return { undone: false };
      await this.unchanged(
        entry.proposal.path,
        entry.root,
        entry.proposal.afterHash,
      );
      if (entry.before === null) {
        const target = await this.workspace.checked(entry.proposal.path);
        await fs.unlink(target);
      } else
        await this.replace(
          entry.proposal.path,
          entry.before,
          entry.root,
          entry.proposal.afterHash,
        );
      this.history.delete(id);
      return { undone: true, path: entry.proposal.path };
    } finally {
      this.busy = false;
    }
  }
  async planCommand(command) {
    if (!["git-status", "npm-test", "npm-build"].includes(command))
      throw new Error("Command is not allowlisted.");
    if (this.plans.size >= 10)
      throw new Error("Discard an existing command plan first.");
    const root = await this.rootCheck();
    let scripts = null;
    let packageHash = null;
    if (command !== "git-status") {
      const text = (await this.workspace.read("package.json")).content;
      const manifest = JSON.parse(text);
      scripts = manifest.scripts;
      const selected = command === "npm-test" ? "test" : "build";
      if (
        !scripts ||
        typeof scripts !== "object" ||
        typeof scripts[selected] !== "string" ||
        !scripts[selected].trim()
      )
        throw new Error(`No explicit npm ${selected} script is defined.`);
      if (Object.values(scripts).some((value) => typeof value !== "string"))
        throw new Error("Invalid package scripts.");
      packageHash = contentHash(text);
    }
    const plan = {
      id: randomUUID(),
      command,
      workspace: root,
      packageHash,
      scripts,
      warning:
        command === "git-status"
          ? "Reads Git status in this project. No changes are requested."
          : "Npm scripts and lifecycle hooks execute arbitrary project/dependency code, may modify or delete files, access credentials, and use the network. Approve only a project you trust. Script hashes do not verify dependencies. There is no command sandbox.",
      display:
        command === "git-status"
          ? "git --no-optional-locks -c core.fsmonitor=false -c core.untrackedCache=false status --short"
          : command === "npm-test"
            ? "npm test"
            : "npm run build",
    };
    plan.approvalDigest = digest(plan);
    this.plans.set(plan.id, plan);
    return structuredClone(plan);
  }
  discardCommand(id) {
    return this.plans.delete(id);
  }
  async executable(name) {
    const value = this.executables[name];
    if (!value || !path.isAbsolute(value))
      throw new Error(`Trusted ${name} executable is not configured.`);
    if ((await fs.lstat(value)).isSymbolicLink())
      throw new Error("Executable configuration must use canonical paths.");
    const canonical = await fs.realpath(value);
    if (canonical !== value || !(await fs.stat(value)).isFile())
      throw new Error("Invalid trusted executable path.");
    return value;
  }
  startCommand(id) {
    if (!this.plans.has(id))
      throw new Error("Unknown or expired command plan.");
    if (this.running.size || this.busy)
      throw new Error("Finish the current operation first.");
    const record = {
      id,
      command: this.plans.get(id).command,
      status: "awaiting-approval",
    };
    this.runs.push(record);
    if (this.runs.length > 20) this.runs.shift();
    const completion = this.runCommand(id).then(
      (result) => {
        Object.assign(record, result, {
          status: result.started ? "finished" : "not-started",
        });
        return result;
      },
      (error) => {
        record.status = "failed";
        record.error = error.message;
        throw error;
      },
    );
    // Observe rejections even when an IPC caller only polls getRuns.
    completion.catch(() => {});
    return { id, completion };
  }
  getRuns() {
    return structuredClone(this.runs);
  }
  async runCommand(id) {
    const plan = this.plans.get(id);
    if (!plan) throw new Error("Unknown or expired command plan.");
    if (this.running.size || this.busy)
      throw new Error("Only one command or file operation can run at a time.");
    if (plan.command !== "git-status" && process.platform === "win32")
      throw new Error(
        "Npm execution on Windows is disabled until a Job Object process-tree runner is implemented.",
      );
    // Reserve before approval to avoid concurrent native dialogs/launches.
    this.running.set(id, { child: null, cancelled: false });
    try {
      await this.rootCheck(plan.workspace);
      let executable;
      let args;
      if (plan.command === "git-status") {
        executable = await this.executable("git");
        args = [
          "--no-optional-locks",
          "-c",
          "core.fsmonitor=false",
          "-c",
          "core.untrackedCache=false",
          "status",
          "--short",
        ];
      } else {
        executable = await this.executable("node");
        const cli = await this.executable("npmCli");
        args = [
          cli,
          ...(plan.command === "npm-test" ? ["test"] : ["run", "build"]),
        ];
      }
      if (
        !(await this.approve({
          kind: "run-command",
          ...structuredClone(plan),
          executable,
          args,
        }))
      )
        return { id, started: false };
      if (this.running.get(id).cancelled)
        return { id, started: false, cancelled: true };
      await this.rootCheck(plan.workspace);
      if (
        plan.packageHash !== null &&
        contentHash((await this.workspace.read("package.json")).content) !==
          plan.packageHash
      )
        throw new Error(
          "Package scripts changed after approval. Create a new command plan.",
        );
      this.plans.delete(id);
      return await this.launch(plan, executable, args);
    } finally {
      this.running.delete(id);
    }
  }
  launch(plan, executable, args) {
    const env = {};
    // Never inherit NODE_OPTIONS, ELECTRON_RUN_AS_NODE, npm_config_*, or GIT_* injection variables.
    for (const key of [
      "PATH",
      "SystemRoot",
      "WINDIR",
      "TEMP",
      "TMP",
      "TMPDIR",
      "HOME",
      "USERPROFILE",
      "COMSPEC",
      "PATHEXT",
      "LANG",
    ])
      if (process.env[key]) env[key] = process.env[key];
    Object.assign(env, {
      CI: "1",
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: os.devNull,
    });
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        cwd: plan.workspace,
        env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const state = this.running.get(plan.id);
      state.child = child;
      if (state.cancelled) this.stop(state);
      const record = this.runs.find((run) => run.id === plan.id);
      if (record) record.status = "running";
      let output = Buffer.alloc(0);
      let truncated = false;
      let timedOut = false;
      const append = (data) => {
        const room = LIMIT - output.length;
        if (data.length > room) truncated = true;
        if (room > 0) output = Buffer.concat([output, data.subarray(0, room)]);
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      const timer = setTimeout(() => {
        timedOut = true;
        this.stop(state);
      }, this.timeoutMs);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(
          new Error(
            `Command could not start (${error.code || "unknown error"}).`,
          ),
        );
      });
      child.once("close", (exitCode, signal) => {
        clearTimeout(timer);
        resolve({
          id: plan.id,
          started: true,
          exitCode,
          signal,
          output: output.toString("utf8"),
          truncated,
          timedOut,
          cancelled: state.cancelled,
          terminationWarning: state.killError || null,
        });
      });
    });
  }
  stop(state) {
    if (!state.child?.pid) return;
    try {
      if (process.platform !== "win32")
        process.kill(-state.child.pid, "SIGKILL");
      else state.child.kill("SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH")
        state.killError = "Process termination could not be confirmed.";
    }
  }
  shutdown() {
    for (const id of this.running.keys()) this.cancelCommand(id);
  }
  cancelCommand(id) {
    const state = this.running.get(id);
    if (!state) return false;
    state.cancelled = true;
    this.stop(state);
    return true;
  }
}
