import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
const LIMIT = 200,
  MAX_BYTES = 512 * 1024;
function timestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000)
    throw Error("Choose a valid reminder time.");
  return value;
}
function title(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Buffer.byteLength(value) > 500 ||
    value.includes("\0")
  )
    throw Error("Reminder title must be 1–500 bytes.");
  return value.trim();
}
function validate(item) {
  if (
    !item ||
    typeof item.id !== "string" ||
    !/^[a-f0-9-]{36}$/.test(item.id) ||
    !["scheduled", "delivered", "dismissed"].includes(item.status)
  )
    throw Error("Invalid reminder.");
  return {
    id: item.id,
    title: title(item.title),
    dueAt: timestamp(item.dueAt),
    createdAt: timestamp(item.createdAt),
    updatedAt: timestamp(item.updatedAt),
    status: item.status,
  };
}
/** Passive durable reminders. No OS notifications, background timers, or network access. */
export class ReminderStore {
  constructor(directory, { now = () => Date.now() } = {}) {
    this.file = path.join(directory, "sebby-reminders.json");
    this.now = now;
    this.items = [];
    this.ready = false;
    this.queue = Promise.resolve();
  }
  async load() {
    try {
      const stat = await fs.lstat(this.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES)
        throw Error();
      const data = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (
        data.version !== 1 ||
        !Array.isArray(data.reminders) ||
        data.reminders.length > LIMIT
      )
        throw Error();
      const items = data.reminders.map(validate);
      if (new Set(items.map((x) => x.id)).size !== items.length) throw Error();
      this.items = items;
      this.ready = true;
    } catch (e) {
      if (e.code === "ENOENT") {
        this.items = [];
        this.ready = true;
      } else
        throw Error(
          "Reminders could not be loaded. The existing file was not overwritten.",
        );
    }
  }
  assertReady() {
    if (!this.ready) throw Error("Load reminders before use.");
  }
  list() {
    this.assertReady();
    return structuredClone(this.items).sort((a, b) => a.dueAt - b.dueAt);
  }
  due() {
    this.assertReady();
    const now = this.now();
    return this.list().filter(
      (x) => x.status === "scheduled" && x.dueAt <= now,
    );
  }
  async update(fn) {
    this.assertReady();
    const op = this.queue.then(async () => {
      const next = structuredClone(this.items);
      const result = fn(next);
      const payload = JSON.stringify({ version: 1, reminders: next });
      if (Buffer.byteLength(payload) > MAX_BYTES)
        throw Error("Reminder storage limit reached.");
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(tmp, payload, { flag: "wx", mode: 0o600 });
        await fs.rename(tmp, this.file);
      } finally {
        await fs.unlink(tmp).catch(() => {});
      }
      this.items = next;
      return result;
    });
    this.queue = op.catch(() => {});
    return op;
  }
  async create({ title: value, dueAt } = {}) {
    const label = title(value);
    timestamp(dueAt);
    return this.update((items) => {
      if (items.length >= LIMIT) throw Error("Reminder limit reached.");
      const now = timestamp(this.now());
      const item = {
        id: randomUUID(),
        title: label,
        dueAt,
        createdAt: now,
        updatedAt: now,
        status: "scheduled",
      };
      items.push(item);
      return structuredClone(item);
    });
  }
  async change(id, fn) {
    return this.update((items) => {
      const item = items.find((x) => x.id === id);
      if (!item) throw Error("Reminder not found.");
      fn(item);
      item.updatedAt = timestamp(this.now());
      return structuredClone(item);
    });
  }
  async markDelivered(id) {
    return this.change(id, (item) => {
      if (item.status !== "scheduled" || item.dueAt > this.now())
        throw Error("Only due scheduled reminders can be delivered.");
      item.status = "delivered";
    });
  }
  async snooze(id, dueAt) {
    timestamp(dueAt);
    if (dueAt <= this.now()) throw Error("Snooze time must be in the future.");
    return this.change(id, (item) => {
      item.dueAt = dueAt;
      item.status = "scheduled";
    });
  }
  async dismiss(id) {
    return this.change(id, (item) => {
      item.status = "dismissed";
    });
  }
  async remove(id, { confirmed = false } = {}) {
    if (confirmed !== true) throw Error("Confirm reminder deletion first.");
    return this.update((items) => {
      const index = items.findIndex((x) => x.id === id);
      if (index < 0) throw Error("Reminder not found.");
      items.splice(index, 1);
      return { removed: true };
    });
  }
}
