import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { Store } from "./services.mjs";
import { TaskStore } from "./tasks.mjs";
import { SkillRegistry } from "./skills.mjs";
import { ReminderStore } from "./reminders.mjs";
import { ConversationStore } from "./conversations.mjs";
import { ConnectorStore } from "./connectors.mjs";
import { TeamStore } from "./team.mjs";

const FORMAT = "sebby-local-backup",
  MAX_BYTES = 20 * 1024 * 1024;
const FILES = Object.freeze([
  "sebby-state.json",
  "sebby-tasks.json",
  "sebby-skills.json",
  "sebby-reminders.json",
  "sebby-conversations.json",
  "sebby-connectors.json",
  "sebby-team.json",
]);
export const BACKUP_FILES = FILES;
const JOURNAL = ".sebby-restore.json";
function exact(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw Error("Backup contains unknown or invalid fields.");
}
function each(value, fn) {
  if (!Array.isArray(value)) throw Error("Invalid backup collection.");
  value.forEach(fn);
}
function strict(name, data) {
  if (name === "sebby-team.json") {
    exact(data, ["version", "team"]);
    each(data.team, (item) =>
      exact(item, [
        "id",
        "name",
        "nameOrigin",
        "role",
        "specialty",
        "job",
        "status",
        "assignedTaskId",
        "createdAt",
        "updatedAt",
      ]),
    );
  }
  if (name === "sebby-state.json") {
    exact(data, ["version", "memories", "personality"]);
    exact(data.personality, ["warmth", "humor"]);
    if (
      !data.memories ||
      typeof data.memories !== "object" ||
      Array.isArray(data.memories) ||
      Object.keys(data.memories).some(
        (key) => !/^(global|[a-f0-9]{64})$/.test(key),
      )
    )
      throw Error("Invalid memory keys.");
  }
  if (name === "sebby-tasks.json") {
    exact(data, ["version", "tasks"]);
    each(data.tasks, (item) => {
      exact(item, [
        "id",
        "title",
        "prompt",
        "role",
        "kind",
        "workspace",
        "status",
        "attempts",
        "createdAt",
        "updatedAt",
        "result",
        "logs",
      ]);
      each(item.logs, (log) => exact(log, ["at", "level", "message"]));
    });
  }
  if (name === "sebby-skills.json") {
    exact(data, ["version", "skills"]);
    each(data.skills, (item) =>
      exact(item, ["id", "name", "description", "instructions"]),
    );
  }
  if (name === "sebby-reminders.json") {
    exact(data, ["version", "reminders"]);
    each(data.reminders, (item) =>
      exact(item, ["id", "title", "dueAt", "createdAt", "updatedAt", "status"]),
    );
  }
  if (name === "sebby-conversations.json") {
    exact(data, ["version", "conversations"]);
    each(data.conversations, (item) => {
      exact(item, [
        "id",
        "title",
        "draft",
        "workspaceId",
        "createdAt",
        "updatedAt",
        "messages",
      ]);
      each(item.messages, (message) =>
        exact(
          message,
          message.role === "assistant"
            ? ["id", "role", "text", "status", "createdAt", "requestId"]
            : ["id", "role", "text", "status", "createdAt"],
        ),
      );
    });
  }
  if (name === "sebby-connectors.json") {
    exact(data, ["version", "connectors"]);
    each(data.connectors, (item) => exact(item, ["id", "name", "type", "url"]));
  }
}
async function regular(file, { missing = false } = {}) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES)
      throw Error(
        "Backup operation requires bounded regular files, not links.",
      );
    return stat;
  } catch (e) {
    if (missing && e.code === "ENOENT") return null;
    throw e;
  }
}
async function read(file) {
  await regular(file);
  return fs.readFile(file, "utf8");
}
async function root(directory) {
  const stat = await fs.lstat(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (await fs.realpath(directory)) !== path.resolve(directory)
  )
    throw Error(
      "Application data directory must be a real canonical directory.",
    );
}
async function validateStores(stores) {
  exact(stores, FILES);
  if (!Object.keys(stores).length) throw Error("Backup contains no stores.");
  const stage = await fs.mkdtemp(
    path.join(os.tmpdir(), "sebby-backup-validation-"),
  );
  try {
    for (const [name, data] of Object.entries(stores)) {
      strict(name, data);
      await fs.writeFile(path.join(stage, name), JSON.stringify(data), {
        flag: "wx",
        mode: 0o600,
      });
    }
    const constructors = {
      "sebby-state.json": Store,
      "sebby-tasks.json": TaskStore,
      "sebby-skills.json": SkillRegistry,
      "sebby-reminders.json": ReminderStore,
      "sebby-conversations.json": ConversationStore,
      "sebby-connectors.json": ConnectorStore,
      "sebby-team.json": TeamStore,
    };
    const normalized = {};
    for (const name of Object.keys(stores)) {
      const service = new constructors[name](stage);
      await service.load();
      normalized[name] = JSON.parse(await read(path.join(stage, name)));
    }
    return normalized;
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}
function parse(value) {
  if (typeof value !== "string" || Buffer.byteLength(value) > MAX_BYTES)
    throw Error("Backup must be JSON text no larger than 20 MiB.");
  let data;
  try {
    data = JSON.parse(value);
  } catch {
    throw Error("Backup is not valid JSON.");
  }
  exact(data, ["format", "version", "createdAt", "stores"]);
  if (
    data.format !== FORMAT ||
    data.version !== 1 ||
    typeof data.createdAt !== "string" ||
    !Number.isFinite(Date.parse(data.createdAt))
  )
    throw Error("Unsupported backup format or version.");
  return data;
}
function journalData(value) {
  exact(value, ["version", "transactionId", "files"]);
  if (
    value.version !== 1 ||
    typeof value.transactionId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(value.transactionId)
  )
    throw Error("Invalid restore journal.");
  each(value.files, (item) => {
    exact(item, ["name", "existed"]);
    if (!FILES.includes(item.name) || typeof item.existed !== "boolean")
      throw Error("Invalid restore journal entry.");
  });
  if (
    !value.files.length ||
    new Set(value.files.map((x) => x.name)).size !== value.files.length
  )
    throw Error("Invalid restore journal entries.");
  return value;
}
/** Native dialogs and service shutdown are main-process responsibilities. Never expose paths or callbacks through raw IPC. */
export class BackupService {
  constructor(directory) {
    this.directory = path.resolve(directory);
    this.pending = null;
    this.busy = false;
  }
  async check() {
    await root(this.directory);
  }
  async exportJSON() {
    await this.check();
    if (await regular(path.join(this.directory, JOURNAL), { missing: true }))
      throw Error("Resolve the pending restore before exporting.");
    const stores = {};
    for (const name of FILES) {
      const file = path.join(this.directory, name);
      if (await regular(file, { missing: true }))
        stores[name] = JSON.parse(await read(file));
    }
    const normalized = await validateStores(stores);
    const payload = JSON.stringify(
      {
        format: FORMAT,
        version: 1,
        createdAt: new Date().toISOString(),
        stores: normalized,
      },
      null,
      2,
    );
    if (Buffer.byteLength(payload) > MAX_BYTES)
      throw Error("Backup exceeds 20 MiB.");
    return payload;
  }
  async previewImport(json) {
    const data = parse(json),
      stores = await validateStores(data.stores);
    const token = randomUUID();
    this.pending = { token, stores };
    return {
      token,
      summary: Object.keys(stores).map((name) => ({
        name,
        bytes: Buffer.byteLength(JSON.stringify(stores[name])),
      })),
      warnings: [
        "Plaintext backup may contain sensitive prompts, memory, and local paths. Credentials are not included.",
        "Restore replaces only the listed local stores. Existing versions will be retained in a local recovery folder.",
        "Running tasks are restored as interrupted, never resumed. Stop all active work and restart Sebby after restoring.",
      ],
    };
  }
  async restore(token, { approve, quiesce } = {}) {
    if (this.busy) throw Error("A backup restore is already in progress.");
    if (
      !this.pending ||
      this.pending.token !== token ||
      typeof approve !== "function" ||
      typeof quiesce !== "function"
    )
      throw Error(
        "Preview this backup and provide native approval and shutdown callbacks first.",
      );
    this.busy = true;
    try {
      const pending = this.pending,
        summary = Object.keys(pending.stores).map((name) => ({
          name,
          bytes: Buffer.byteLength(JSON.stringify(pending.stores[name])),
        }));
      if ((await approve(structuredClone(summary))) !== true)
        return { restored: false };
      if ((await quiesce()) !== true)
        throw Error(
          "Stop all active operations and store writers before restore.",
        );
      await this.check();
      const journalPath = path.join(this.directory, JOURNAL);
      if (await regular(journalPath, { missing: true }))
        throw Error("Resolve the previous interrupted restore first.");
      const transactionId = randomUUID(),
        recoveryDirectory = path.join(
          this.directory,
          `sebby-recovery-${transactionId}`,
        );
      await fs.mkdir(recoveryDirectory, { mode: 0o700 });
      const journal = { version: 1, transactionId, files: [] };
      for (const name of Object.keys(pending.stores)) {
        const target = path.join(this.directory, name),
          exists = !!(await regular(target, { missing: true }));
        if (exists)
          await fs.copyFile(
            target,
            path.join(recoveryDirectory, name),
            fs.constants.COPYFILE_EXCL,
          );
        journal.files.push({ name, existed: exists });
        await fs.writeFile(
          path.join(recoveryDirectory, `${name}.new`),
          JSON.stringify(pending.stores[name], null, 2),
          { flag: "wx", mode: 0o600 },
        );
      }
      await fs.writeFile(journalPath, JSON.stringify(journal), {
        flag: "wx",
        mode: 0o600,
      });
      try {
        for (const { name } of journal.files) {
          await regular(path.join(this.directory, name), { missing: true });
          await fs.rename(
            path.join(recoveryDirectory, `${name}.new`),
            path.join(this.directory, name),
          );
        }
        await fs.unlink(journalPath);
        this.pending = null;
        return { restored: true, restartRequired: true, recoveryDirectory };
      } catch (error) {
        try {
          await this.rollback(journal);
          await fs.unlink(journalPath);
        } catch {
          throw Error(
            "Restore failed and rollback is incomplete. Keep Sebby stopped; recover the pending restore before loading stores.",
          );
        }
        throw Error("Restore failed. Previous local stores were restored.");
      }
    } finally {
      this.busy = false;
    }
  }
  async rollback(journal) {
    const recoveryDirectory = path.join(
      this.directory,
      `sebby-recovery-${journal.transactionId}`,
    );
    await root(recoveryDirectory);
    for (const { name, existed } of journal.files) {
      const target = path.join(this.directory, name);
      await regular(target, { missing: true });
      if (existed) {
        const previous = path.join(recoveryDirectory, name);
        await regular(previous);
        const tmp = path.join(
          this.directory,
          `.sebby-rollback-${randomUUID()}`,
        );
        try {
          await fs.copyFile(previous, tmp, fs.constants.COPYFILE_EXCL);
          await fs.rename(tmp, target);
        } finally {
          await fs.unlink(tmp).catch(() => {});
        }
      } else {
        await fs.unlink(target).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    }
  }
  async recoverPending() {
    await this.check();
    const file = path.join(this.directory, JOURNAL);
    if (!(await regular(file, { missing: true }))) return { recovered: false };
    const journal = journalData(JSON.parse(await read(file)));
    await this.rollback(journal);
    await fs.unlink(file);
    return { recovered: true, restartRequired: true };
  }
}
