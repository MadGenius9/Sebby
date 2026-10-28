import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const MAX_FILE = 8 * 1024 * 1024,
  MAX_MESSAGES = 200,
  MAX_CONVERSATIONS = 100,
  MAX_TEXT = 64 * 1024;
const validId = (id) => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id);
function text(value, max = MAX_TEXT) {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value) > max ||
    value.includes("\0")
  )
    throw Error("Invalid conversation text.");
  return value;
}
function timestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw Error("Invalid conversation timestamp.");
  return value;
}
function validate(item) {
  if (
    !item ||
    !validId(item.id) ||
    !Array.isArray(item.messages) ||
    item.messages.length > MAX_MESSAGES
  )
    throw Error("Invalid conversation.");
  const messages = item.messages.map((m) => {
    if (!m || !validId(m.id) || !["user", "assistant"].includes(m.role))
      throw Error("Invalid message.");
    if (m.role === "user" && !["unsent", "sent"].includes(m.status))
      throw Error("Invalid user message status.");
    if (
      m.role === "assistant" &&
      (!["complete", "interrupted"].includes(m.status) ||
        typeof m.requestId !== "string" ||
        !m.requestId ||
        m.requestId.length > 200)
    )
      throw Error("Assistant messages need response provenance.");
    return {
      id: m.id,
      role: m.role,
      text: text(m.text),
      status: m.status,
      createdAt: timestamp(m.createdAt),
      ...(m.role === "assistant" ? { requestId: m.requestId } : {}),
    };
  });
  const result = {
    id: item.id,
    title: text(item.title, 200),
    draft: text(item.draft),
    createdAt: timestamp(item.createdAt),
    updatedAt: timestamp(item.updatedAt),
    messages,
  };
  if (item.workspaceId !== undefined)
    result.workspaceId = text(item.workspaceId, 1024);
  return result;
}
/** Local history only. This service never calls a model or fabricates assistant text. */
export class ConversationStore {
  constructor(directory, { now = () => Date.now() } = {}) {
    this.file = path.join(directory, "sebby-conversations.json");
    this.now = now;
    this.items = [];
    this.queue = Promise.resolve();
    this.ready = false;
  }
  async load() {
    try {
      const stat = await fs.lstat(this.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE)
        throw Error();
      const data = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (
        data.version !== 1 ||
        !Array.isArray(data.conversations) ||
        data.conversations.length > MAX_CONVERSATIONS
      )
        throw Error();
      const items = data.conversations.map(validate);
      if (new Set(items.map((x) => x.id)).size !== items.length) throw Error();
      this.items = items;
      this.ready = true;
    } catch (e) {
      if (e.code === "ENOENT") {
        this.items = [];
        this.ready = true;
      } else
        throw Error(
          "Conversation history could not be loaded. The existing file was not overwritten.",
        );
    }
  }
  assertReady() {
    if (!this.ready) throw Error("Load conversation history before use.");
  }
  list() {
    this.assertReady();
    return this.items
      .map(({ messages, draft, ...meta }) => ({
        ...meta,
        messageCount: messages.length,
        hasDraft: !!draft,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  get(id) {
    this.assertReady();
    const item = this.items.find((x) => x.id === id);
    if (!item) throw Error("Conversation not found.");
    return structuredClone(item);
  }
  async update(fn) {
    this.assertReady();
    const op = this.queue.then(async () => {
      const next = structuredClone(this.items);
      const result = fn(next);
      const payload = JSON.stringify({ version: 1, conversations: next });
      if (Buffer.byteLength(payload) > MAX_FILE)
        throw Error(
          "Conversation history storage limit reached. Export or delete old conversations.",
        );
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
  async create({ title = "New conversation", workspaceId } = {}) {
    text(title, 200);
    if (workspaceId !== undefined) text(workspaceId, 1024);
    return this.update((items) => {
      if (items.length >= MAX_CONVERSATIONS)
        throw Error("Conversation limit reached.");
      const now = timestamp(this.now());
      const item = {
        id: randomUUID(),
        title,
        draft: "",
        createdAt: now,
        updatedAt: now,
        messages: [],
        ...(workspaceId !== undefined ? { workspaceId } : {}),
      };
      items.push(item);
      return structuredClone(item);
    });
  }
  async mutate(id, fn) {
    return this.update((items) => {
      const item = items.find((x) => x.id === id);
      if (!item) throw Error("Conversation not found.");
      fn(item);
      item.updatedAt = timestamp(this.now());
      return structuredClone(item);
    });
  }
  async saveDraft(id, draft) {
    text(draft);
    return this.mutate(id, (item) => {
      item.draft = draft;
    });
  }
  async rename(id, title) {
    text(title, 200);
    return this.mutate(id, (item) => {
      item.title = title;
    });
  }
  async appendUser(id, content, { status = "unsent" } = {}) {
    text(content);
    if (!["unsent", "sent"].includes(status))
      throw Error("Invalid user message status.");
    return this.mutate(id, (item) => {
      if (item.messages.length >= MAX_MESSAGES)
        throw Error("Message limit reached; start a new conversation.");
      item.messages.push({
        id: randomUUID(),
        role: "user",
        text: content,
        status,
        createdAt: timestamp(this.now()),
      });
      item.draft = "";
    });
  }
  async appendAssistant(id, content, { requestId, status = "complete" } = {}) {
    text(content);
    if (
      typeof requestId !== "string" ||
      !requestId ||
      requestId.length > 200 ||
      !["complete", "interrupted"].includes(status)
    )
      throw Error("Assistant messages need response provenance.");
    return this.mutate(id, (item) => {
      if (item.messages.length >= MAX_MESSAGES)
        throw Error("Message limit reached; start a new conversation.");
      item.messages.push({
        id: randomUUID(),
        role: "assistant",
        text: content,
        status,
        requestId,
        createdAt: timestamp(this.now()),
      });
    });
  }
  async remove(id, { confirmed = false } = {}) {
    if (confirmed !== true) throw Error("Confirm conversation deletion first.");
    return this.update((items) => {
      const index = items.findIndex((x) => x.id === id);
      if (index < 0) throw Error("Conversation not found.");
      items.splice(index, 1);
      return { removed: true };
    });
  }
  export() {
    this.assertReady();
    return { version: 1, conversations: structuredClone(this.items) };
  }
}
