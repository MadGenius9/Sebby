import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const TASK_STATUSES = Object.freeze([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
export const TASK_ROLES = Object.freeze([
  "planner",
  "coder",
  "reviewer",
  "researcher",
]);
const transitions = {
  queued: ["running", "cancelled"],
  running: ["completed", "failed", "cancelled", "interrupted"],
  interrupted: ["queued", "cancelled"],
  failed: ["queued"],
  completed: [],
  cancelled: [],
};
const MAX_TASKS = 100,
  MAX_LOGS = 100,
  MAX_STORE_BYTES = 4 * 1024 * 1024;
const clone = (value) => structuredClone(value);
function text(value, maximum, label, empty = false) {
  if (
    typeof value !== "string" ||
    (!empty && !value.trim()) ||
    Buffer.byteLength(value, "utf8") > maximum ||
    value.includes("\0")
  )
    throw new Error(`Invalid ${label}.`);
  return value;
}
function timestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new Error("Invalid task timestamp.");
  return value;
}
function logEntry(value) {
  if (!value || !["info", "warning", "error"].includes(value.level))
    throw new Error("Invalid task log level.");
  return {
    at: timestamp(value.at),
    level: value.level,
    message: text(value.message, 2048, "log message"),
  };
}
function validateRecord(value) {
  if (
    !value ||
    typeof value.id !== "string" ||
    !/^[a-f0-9-]{36}$/.test(value.id) ||
    !TASK_ROLES.includes(value.role) ||
    !TASK_STATUSES.includes(value.status) ||
    !Number.isSafeInteger(value.attempts) ||
    value.attempts < 0 ||
    !Array.isArray(value.logs) ||
    value.logs.length > MAX_LOGS
  )
    throw new Error("Invalid task record.");
  return {
    id: value.id,
    title: text(value.title, 160, "task title"),
    prompt: text(value.prompt, 16000, "task prompt"),
    role: value.role,
    workspace:
      value.workspace === null
        ? null
        : text(value.workspace, 2048, "workspace"),
    status: value.status,
    attempts: value.attempts,
    createdAt: timestamp(value.createdAt),
    updatedAt: timestamp(value.updatedAt),
    result:
      value.result === null
        ? null
        : text(value.result, 32000, "task result", true),
    logs: value.logs.map(logEntry),
  };
}
/** Durable metadata only. An external approved executor must actually perform work. */
export class TaskStore {
  constructor(directory) {
    this.file = path.join(directory, "sebby-tasks.json");
    this.records = [];
    this.queue = Promise.resolve();
    this.loaded = false;
  }
  async load() {
    if (this.loaded) return this.list();
    try {
      const stat = await fs.lstat(this.file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > MAX_STORE_BYTES
      )
        throw new Error("Invalid task store.");
      const data = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (
        data.version !== 1 ||
        !Array.isArray(data.tasks) ||
        data.tasks.length > MAX_TASKS
      )
        throw new Error("Invalid task store.");
      this.records = data.tasks.map(validateRecord);
      if (
        new Set(this.records.map((task) => task.id)).size !==
        this.records.length
      )
        throw new Error("Duplicate task IDs.");
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error(
          "Saved tasks could not be loaded. Existing storage was not overwritten.",
        );
    }
    this.loaded = true;
    if (this.records.some((task) => task.status === "running")) {
      await this.update((records) => {
        for (const task of records)
          if (task.status === "running") {
            task.status = "interrupted";
            task.updatedAt = new Date().toISOString();
            task.logs.push({
              at: task.updatedAt,
              level: "warning",
              message:
                "Execution was interrupted by a restart. Review before retrying; prior side effects may have occurred.",
            });
            task.logs = task.logs.slice(-MAX_LOGS);
          }
      });
    }
    return this.list();
  }
  list() {
    this.assertLoaded();
    return clone(this.records);
  }
  get(id) {
    this.assertLoaded();
    return clone(this.find(this.records, id));
  }
  assertLoaded() {
    if (!this.loaded) throw new Error("Load task storage first.");
  }
  find(records, id) {
    const task = records.find((item) => item.id === id);
    if (!task) throw new Error("Task not found.");
    return task;
  }
  update(mutator) {
    this.assertLoaded();
    const operation = this.queue.then(async () => {
      const next = clone(this.records);
      const result = mutator(next);
      const encoded = JSON.stringify({ version: 1, tasks: next }, null, 2);
      if (Buffer.byteLength(encoded) > MAX_STORE_BYTES)
        throw new Error("Task storage is full. Remove old tasks first.");
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, encoded, { flag: "wx", mode: 0o600 });
        await fs.rename(temporary, this.file);
      } finally {
        await fs.unlink(temporary).catch(() => {});
      }
      this.records = next;
      return clone(result);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async create(input) {
    if (!input || !TASK_ROLES.includes(input.role))
      throw new Error("Choose planner, coder, reviewer, or researcher.");
    const title = text(input.title, 160, "task title"),
      prompt = text(input.prompt, 16000, "task prompt");
    const workspace =
      input.workspace == null ? null : text(input.workspace, 2048, "workspace");
    return this.update((records) => {
      if (records.length >= MAX_TASKS)
        throw new Error("Task limit reached. Remove old tasks first.");
      const now = new Date().toISOString();
      const task = {
        id: randomUUID(),
        title,
        prompt,
        role: input.role,
        workspace,
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
        result: null,
        logs: [
          {
            at: now,
            level: "info",
            message: "Queued. No work has executed yet.",
          },
        ],
      };
      records.push(task);
      return task;
    });
  }
  async transition(id, status, options = {}) {
    if (
      !TASK_STATUSES.includes(status) ||
      !options ||
      typeof options !== "object"
    )
      throw new Error("Invalid task transition.");
    const message =
      options.message == null
        ? null
        : text(options.message, 2048, "transition message");
    const result =
      options.result == null
        ? null
        : text(options.result, 32000, "task result", true);
    if (result !== null && status !== "completed" && status !== "failed")
      throw new Error("Results belong to completed or failed tasks only.");
    return this.update((records) => {
      const task = this.find(records, id);
      if (!transitions[task.status].includes(status))
        throw new Error(`Cannot move a ${task.status} task to ${status}.`);
      task.status = status;
      task.updatedAt = new Date().toISOString();
      if (status === "running") task.attempts += 1;
      if (status === "queued") task.result = null;
      if (result !== null) task.result = result;
      task.logs.push({
        at: task.updatedAt,
        level:
          status === "failed"
            ? "error"
            : status === "interrupted"
              ? "warning"
              : "info",
        message: message || `Task changed to ${status}.`,
      });
      task.logs = task.logs.slice(-MAX_LOGS);
      return task;
    });
  }
  async appendLog(id, input) {
    const log = logEntry({ ...input, at: new Date().toISOString() });
    return this.update((records) => {
      const task = this.find(records, id);
      task.logs.push(log);
      task.logs = task.logs.slice(-MAX_LOGS);
      task.updatedAt = log.at;
      return task;
    });
  }
  async remove(id) {
    return this.update((records) => {
      const task = this.find(records, id);
      if (["queued", "running"].includes(task.status))
        throw new Error("Cancel an active task before removing it.");
      records.splice(records.indexOf(task), 1);
      return { removed: true };
    });
  }
}
