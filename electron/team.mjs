import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
export const TEAM_ROLES = Object.freeze([
  "planner",
  "coder",
  "reviewer",
  "researcher",
]);
const roles = {
  planner: {
    specialty: "Planning and task breakdown",
    names: [
      "Mira",
      "Elliot",
      "Rowan",
      "Clara",
      "Theo",
      "Iris",
      "Arthur",
      "Esme",
    ],
  },
  coder: {
    specialty: "Implementation and debugging",
    names: ["Finn", "Ada", "Jules", "Leo", "Nina", "Owen", "Remy", "Zara"],
  },
  reviewer: {
    specialty: "Code review and verification",
    names: ["Sage", "Alex", "Cleo", "Hugo", "Lena", "Miles", "Rhea", "Tessa"],
  },
  researcher: {
    specialty: "Research and source evaluation",
    names: ["Nova", "Arlo", "Bea", "Drew", "Freya", "Kit", "Nora", "Quinn"],
  },
};
const MAX_ITEMS = 32,
  MAX_BYTES = 256 * 1024;
const validId = (id) =>
  typeof id === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
function exact(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw Error(
      "Unsupported team fields. Identities do not accept credentials, tools, or authority.",
    );
}
function text(value, max, label) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Buffer.byteLength(value) > max ||
    /[\x00-\x1f]/.test(value)
  )
    throw Error(`Choose a valid ${label}.`);
  return value.trim();
}
function time(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw Error("Invalid team timestamp.");
  return value;
}
function record(item) {
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
  ]);
  if (
    !validId(item.id) ||
    !TEAM_ROLES.includes(item.role) ||
    !["sebby-assigned", "user-renamed"].includes(item.nameOrigin) ||
    !["executor-not-connected", "retired"].includes(item.status) ||
    (item.assignedTaskId !== null && !validId(item.assignedTaskId)) ||
    item.specialty !== roles[item.role].specialty
  )
    throw Error("Invalid team identity.");
  return {
    id: item.id,
    name: text(item.name, 80, "teammate name"),
    nameOrigin: item.nameOrigin,
    role: item.role,
    specialty: item.specialty,
    job: text(item.job, 2000, "job description"),
    status: item.status,
    assignedTaskId: item.assignedTaskId,
    createdAt: time(item.createdAt),
    updatedAt: time(item.updatedAt),
  };
}
/** Durable specialist identities and task references, not an agent executor or permission grant. */
export class TeamStore {
  constructor(directory, { now = () => Date.now() } = {}) {
    this.file = path.join(directory, "sebby-team.json");
    this.now = now;
    this.items = [];
    this.ready = false;
    this.queue = Promise.resolve();
  }
  async load() {
    if (this.ready) return this.list();
    try {
      const stat = await fs.lstat(this.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES)
        throw Error("Invalid team storage.");
      const data = JSON.parse(await fs.readFile(this.file, "utf8"));
      exact(data, ["version", "team"]);
      if (
        data.version !== 1 ||
        !Array.isArray(data.team) ||
        data.team.length > MAX_ITEMS
      )
        throw Error("Invalid team storage.");
      const items = data.team.map(record);
      if (
        new Set(items.map((x) => x.id)).size !== items.length ||
        new Set(items.map((x) => x.name.toLocaleLowerCase("en-US"))).size !==
          items.length
      )
        throw Error("Duplicate team identity.");
      this.items = items;
    } catch (error) {
      if (error.code !== "ENOENT")
        throw Error(
          "Team identities could not be loaded. Existing data was not overwritten.",
        );
    }
    this.ready = true;
    return this.list();
  }
  assertReady() {
    if (!this.ready) throw Error("Load team identities first.");
  }
  list() {
    this.assertReady();
    return structuredClone(this.items);
  }
  get(id) {
    this.assertReady();
    const item = this.items.find((x) => x.id === id);
    if (!item) throw Error("Teammate not found.");
    return structuredClone(item);
  }
  update(fn) {
    this.assertReady();
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.items),
        result = fn(next),
        payload = JSON.stringify({ version: 1, team: next }, null, 2);
      if (Buffer.byteLength(payload) > MAX_BYTES)
        throw Error("Team storage limit reached.");
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, payload, { flag: "wx", mode: 0o600 });
        await fs.rename(temporary, this.file);
      } finally {
        await fs.unlink(temporary).catch(() => {});
      }
      this.items = next;
      return structuredClone(result);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async create(input) {
    exact(input, ["role", "job"]);
    if (!TEAM_ROLES.includes(input.role))
      throw Error("Choose planner, coder, reviewer, or researcher.");
    const role = input.role,
      job = text(input.job, 2000, "job description");
    return this.update((items) => {
      if (items.length >= MAX_ITEMS)
        throw Error(
          "Team limit reached. This build keeps up to 32 identities including retired members.",
        );
      const used = new Set(items.map((x) => x.name.toLocaleLowerCase("en-US"))),
        name = roles[role].names.find(
          (name) => !used.has(name.toLocaleLowerCase("en-US")),
        );
      if (!name)
        throw Error(
          "No unused names remain for this specialty. Rename an existing teammate to free an authored name.",
        );
      const now = time(this.now()),
        item = {
          id: randomUUID(),
          name,
          nameOrigin: "sebby-assigned",
          role,
          specialty: roles[role].specialty,
          job,
          status: "executor-not-connected",
          assignedTaskId: null,
          createdAt: now,
          updatedAt: now,
        };
      items.push(item);
      return item;
    });
  }
  async mutate(id, fn) {
    return this.update((items) => {
      const item = items.find((x) => x.id === id);
      if (!item) throw Error("Teammate not found.");
      if (item.status === "retired") throw Error("This teammate is retired.");
      fn(item, items);
      item.updatedAt = time(this.now());
      return item;
    });
  }
  async rename(id, value) {
    const name = text(value, 80, "teammate name");
    return this.mutate(id, (item, items) => {
      if (
        items.some(
          (x) =>
            x.id !== id &&
            x.name.toLocaleLowerCase("en-US") ===
              name.toLocaleLowerCase("en-US"),
        )
      )
        throw Error("Choose a distinct teammate name.");
      item.name = name;
      item.nameOrigin = "user-renamed";
    });
  }
  async retire(id) {
    return this.mutate(id, (item) => {
      item.status = "retired";
      item.assignedTaskId = null;
    });
  }
  async assignTask(id, taskId) {
    if (taskId !== null && !validId(taskId))
      throw Error("Choose an existing task ID.");
    return this.mutate(id, (item) => {
      item.assignedTaskId = taskId;
    });
  }
}
