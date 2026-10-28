import { randomUUID, createHash } from "node:crypto";
import { validateRelative, MAX_TEXT_BYTES } from "./services.mjs";
const definitions = Object.freeze({
  "workspace-inventory": {
    taskKind: "local-inventory",
    role: "researcher",
    title: "Local utility: workspace inventory",
    prompt:
      "Run the deterministic local workspace inventory utility. List bounded supported file paths and sizes only; do not read contents, call AI, modify files, or run commands. Report the observed metadata and limitations for review.",
  },
  "project-brief": {
    taskKind: "local-brief",
    role: "planner",
    title: "Local utility: project brief template",
    prompt:
      "Run the deterministic local project brief template utility. Use only bounded workspace file metadata to produce an unfilled planning template with observed inventory. Do not infer app requirements, call AI, modify files, or run commands. Report the template and limitations for review.",
  },
});
const digest = (value) => createHash("sha256").update(value).digest("hex");
function definitionForTask(task) {
  const def = Object.values(definitions).find(
    (def) => def.taskKind === task.kind,
  );
  if (
    !def ||
    task.title !== def.title ||
    task.prompt !== def.prompt ||
    task.role !== def.role
  )
    throw Error("This task is not an authentic supported local utility.");
  return def;
}
function exact(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw Error("Unsupported local utility input.");
}
/** Deterministic, read-only utility execution. No model, shell, connector, or autonomous agent. */
export class LocalExecutor {
  constructor({ tasks, team, workspace, approve }) {
    if (!tasks || !team || !workspace || typeof approve !== "function")
      throw Error(
        "Local utility needs stores, selected workspace, and native approval.",
      );
    this.tasks = tasks;
    this.team = team;
    this.workspace = workspace;
    this.approve = approve;
    this.active = null;
    this.runs = new Map();
    this.reviewing = new Set();
  }
  get isActive() {
    return this.active !== null || this.reviewing.size > 0;
  }
  get activeCount() {
    return (this.active ? 1 : 0) + this.reviewing.size;
  }
  async startNew(input) {
    exact(input, ["kind", "memberId"]);
    const def = definitions[input.kind];
    if (!def) throw Error("Choose workspace-inventory or project-brief.");
    if (this.active)
      throw Error("Wait for the current local utility to finish or cancel it.");
    const root = this.workspace.root;
    if (!root)
      throw Error("Choose a workspace before running a local utility.");
    const member =
      input.memberId == null ? null : this.team.get(input.memberId);
    if (
      member &&
      (member.status === "retired" ||
        member.role !== def.role ||
        member.assignedTaskId !== null)
    )
      throw Error(
        "Choose an unassigned, active specialist matching this utility’s role.",
      );
    const runId = randomUUID(),
      controller = new AbortController(),
      run = { runId, controller, taskId: null, root, promise: null };
    this.active = run;
    try {
      const accepted = await this.approve({
        runId,
        kind: input.kind,
        title: def.title,
        workspace: root,
        member: member
          ? { id: member.id, name: member.name, role: member.role }
          : null,
        notice:
          "Deterministic local utility, not AI. Reads bounded file names and sizes only. No files changed, no network, no commands. Result needs a separate review.",
      });
      if (accepted !== true) {
        return { started: false };
      }
      controller.signal.throwIfAborted();
      if (this.workspace.root !== root)
        throw Error("The workspace changed before approval completed.");
      if (member) {
        const current = this.team.get(member.id);
        if (
          current.status === "retired" ||
          current.assignedTaskId !== null ||
          current.role !== def.role
        )
          throw Error(
            "The selected specialist changed before approval completed.",
          );
      }
      const task = await this.tasks.create({
        title: def.title,
        prompt: def.prompt,
        role: def.role,
        kind: def.taskKind,
        workspace: root,
      });
      run.taskId = task.id;
      if (member) await this.team.assignTask(member.id, task.id);
      controller.signal.throwIfAborted();
      await this.tasks.transition(task.id, "running", {
        message: `Started approved deterministic utility. Run ${runId}. No AI or commands.`,
      });
      run.promise = this.execute(run, input.kind, member).finally(() => {
        if (this.active === run) this.active = null;
      });
      this.runs.set(runId, run.promise);
      while (this.runs.size > 20)
        this.runs.delete(this.runs.keys().next().value);
      // Observe rejections even if the renderer disconnects instead of calling wait().
      run.promise.catch(() => {});
      return { started: true, runId, task: this.tasks.get(task.id) };
    } catch (error) {
      if (run.taskId) {
        const task = this.tasks.get(run.taskId);
        if (["queued", "running"].includes(task.status))
          await this.tasks
            .transition(
              task.id,
              task.status === "queued" || controller.signal.aborted
                ? "cancelled"
                : "failed",
              {
                message:
                  "Local utility could not start. No completion was claimed.",
              },
            )
            .catch(() => {});
      }
      throw error;
    } finally {
      if (!run.promise && this.active === run) this.active = null;
    }
  }
  async execute(run, kind, member) {
    try {
      run.controller.signal.throwIfAborted();
      if (this.workspace.root !== run.root)
        throw Error("Workspace changed during utility execution.");
      await this.tasks.appendLog(run.taskId, {
        level: "info",
        message:
          "Inspecting allowlisted file metadata in the approved workspace.",
      });
      const entries = await this.workspace.list({
        signal: run.controller.signal,
      });
      run.controller.signal.throwIfAborted();
      if (this.workspace.root !== run.root)
        throw Error("Workspace changed during utility execution.");
      if (!Array.isArray(entries) || entries.length > 300)
        throw Error("Workspace returned an invalid bounded inventory.");
      for (const entry of entries) {
        validateRelative(entry.path);
        if (
          !Number.isSafeInteger(entry.size) ||
          entry.size < 0 ||
          entry.size > MAX_TEXT_BYTES
        )
          throw Error("Workspace returned invalid file metadata.");
      }
      const observedAt = new Date().toISOString(),
        total = entries.reduce((sum, file) => sum + file.size, 0);
      const lines = [];
      let bytes = 0;
      for (const file of entries) {
        const line = `- ${JSON.stringify(file.path)}: ${file.size} bytes`;
        if (bytes + Buffer.byteLength(line) > 20000) break;
        lines.push(line);
        bytes += Buffer.byteLength(line);
      }
      const report = [
        kind === "project-brief"
          ? "# Project brief template — deterministic local utility"
          : "# Workspace inventory — deterministic local utility",
        `Run ID: ${run.runId}`,
        `Observed: ${observedAt}`,
        `Workspace: ${JSON.stringify(run.root)}`,
        `Specialist identity: ${member ? JSON.stringify(member.name) : "Unassigned"} (identity label only; this was not AI execution)`,
        `Observed supported files: ${entries.length}`,
        `Combined observed file sizes: ${total} bytes`,
        `Listed in this report: ${lines.length}`,
        "",
        ...(kind === "project-brief"
          ? [
              "## Planning template — requires your input",
              "Outcome: [not inferred]",
              "Audience: [not inferred]",
              "Must-have behavior: [not inferred]",
              "Constraints and approval boundaries: [not inferred]",
              "Acceptance tests: [not inferred]",
              "",
              "## Observed inventory",
            ]
          : ["## Observed inventory"]),
        ...lines,
        "",
        "## Limitations",
        "This is deterministic local file metadata inspection, not AI analysis or a completed app-building request. No file contents were read by this utility. No network requests, shell commands, or project writes occurred.",
        "The workspace service excludes unsupported, hidden, sensitive-named and symlink paths, caps traversal depth/entries, and returns at most 300 files. Counts describe only returned metadata, not the entire project. Files can change after observation.",
        "A named specialist is an identity attached to this utility, not proof of model reasoning. Sebby is awaiting your review before calling this specific utility complete.",
      ].join("\n");
      run.controller.signal.throwIfAborted();
      await this.tasks.transition(run.taskId, "awaiting-review", {
        result: report,
        message: `Local utility produced observed evidence. SHA-256 ${digest(report)}. Awaiting separate review; not complete.`,
      });
      if (run.controller.signal.aborted)
        await this.tasks.transition(run.taskId, "cancelled", {
          message: "Cancelled before the result was accepted for review.",
        });
      return this.tasks.get(run.taskId);
    } catch (error) {
      const cancelled = run.controller.signal.aborted,
        task = this.tasks.get(run.taskId);
      if (task.status === "running")
        await this.tasks.transition(
          run.taskId,
          cancelled ? "cancelled" : "failed",
          {
            message: cancelled
              ? "Local utility cancelled; scanning was aborted cooperatively. No completion claimed."
              : "Local utility failed or its workspace changed. No completion claimed.",
          },
        );
      return this.tasks.get(run.taskId);
    }
  }
  async wait(runId) {
    const promise = this.runs.get(runId);
    if (!promise)
      throw Error(
        "Local utility run is not active or retained in this session. Read its persistent task record instead.",
      );
    return promise;
  }
  async cancel(taskId) {
    const run = this.active;
    if (!run || run.taskId !== taskId)
      throw Error("This task has no active local utility to cancel.");
    run.controller.abort(new Error("Local utility cancelled."));
    if (run.promise) return run.promise;
    return { cancelling: true };
  }
  async shutdown() {
    if (this.reviewing.size)
      throw Error("Finish the pending result review before shutdown.");
    const run = this.active;
    if (!run) return;
    run.controller.abort(new Error("Application is stopping."));
    if (run.promise) await run.promise;
    else
      throw Error(
        "Close the pending utility approval before shutdown can finish.",
      );
  }
  async review(taskId, { approveReview } = {}) {
    if (typeof approveReview !== "function")
      throw Error("Native result review is required.");
    if (this.reviewing.has(taskId))
      throw Error("Finish the open review first.");
    this.reviewing.add(taskId);
    try {
      const task = this.tasks.get(taskId);
      definitionForTask(task);
      if (task.status !== "awaiting-review" || !task.result)
        throw Error("This utility has no pending result to review.");
      const hash = digest(task.result);
      const accepted = await approveReview({
        taskId,
        title: task.title,
        workspace: task.workspace,
        result: task.result,
        sha256: hash,
        notice:
          "Review this deterministic local utility result. This does not complete any broader app-building request or claim an AI specialist ran.",
      });
      if (accepted !== true)
        return { reviewed: false, task: this.tasks.get(taskId) };
      const current = this.tasks.get(taskId);
      definitionForTask(current);
      if (
        current.status !== "awaiting-review" ||
        digest(current.result || "") !== hash
      )
        throw Error("The result changed during review. Review it again.");
      return {
        reviewed: true,
        task: await this.tasks.transition(taskId, "completed", {
          message: `User reviewed the local utility evidence through Sebby. SHA-256 ${hash}. No broader task completion implied.`,
        }),
      };
    } finally {
      this.reviewing.delete(taskId);
    }
  }
}
