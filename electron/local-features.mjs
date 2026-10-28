import { TeamStore } from "./team.mjs";
import { ConnectorStore } from "./connectors.mjs";
import { validateText } from "./services.mjs";
import { TaskStore } from "./tasks.mjs";
import { SkillRegistry } from "./skills.mjs";
import { ReminderStore } from "./reminders.mjs";
import { ConversationStore } from "./conversations.mjs";
/** Register only user-facing local actions. Never expose store transition internals. */
export async function installLocalFeatures({
  directory,
  register,
  workspace,
  confirm,
  onConnectorRemoved = () => {},
  cancelActiveTask = async () => null,
}) {
  const team = new TeamStore(directory),
    connectors = new ConnectorStore(directory),
    tasks = new TaskStore(directory),
    skills = new SkillRegistry(directory),
    reminders = new ReminderStore(directory),
    conversations = new ConversationStore(directory);
  await Promise.all([
    team.load(),
    connectors.load(),
    tasks.load(),
    skills.load(),
    reminders.load(),
    conversations.load(),
  ]);
  register("list-team", () => team.list());
  register("create-team-member", (input) =>
    team.create({ role: input?.role, job: input?.job }),
  );
  register("rename-team-member", (input) =>
    team.rename(input?.id, input?.name),
  );
  register("retire-team-member", async (id) => {
    const member = team.list().find((x) => x.id === id);
    if (!member) throw Error("Specialist not found.");
    if (
      !(await confirm(
        "Retire this specialist?",
        `${member.name} will stop receiving assignments. Existing task records are kept.`,
      ))
    )
      return null;
    return team.retire(id);
  });
  register("assign-team-task", (input) => {
    const member = team.list().find((x) => x.id === input?.id);
    if (!member) throw Error("Specialist not found.");
    if (input?.taskId !== null) {
      const task = tasks.get(input?.taskId);
      if (task.role !== member.role)
        throw Error("Assign a task matching this specialist’s role.");
    }
    return team.assignTask(input.id, input.taskId);
  });
  register("list-connectors", () => connectors.list());
  register("add-connector", (input) => connectors.add(input));
  register("remove-connector", async (id) => {
    const item = connectors.get(id);
    if (!(await confirm("Remove connector bookmark?", item.name)))
      return { removed: false };
    onConnectorRemoved(id);
    return connectors.remove(id, { confirmed: true });
  });
  register("list-tasks", () => tasks.list());
  register("create-task", (input) =>
    tasks.create({
      title: input?.title,
      prompt: input?.prompt,
      role: input?.role,
      workspace: workspace.root,
    }),
  );
  register("cancel-task", async (id) => {
    const handled = await cancelActiveTask(id);
    if (handled) return handled;
    return tasks.transition(id, "cancelled", {
      message: "Cancelled by you. No automatic retry.",
    });
  });
  register("retry-task", (id) => {
    if (tasks.get(id).kind !== "ai")
      throw Error(
        "Start a fresh local utility with a new approval instead of retrying this result.",
      );
    return tasks.transition(id, "queued", {
      message: "Queued again by you. Waiting for an approved executor.",
    });
  });
  register("remove-task", async (id) => {
    const task = tasks.get(id);
    if (
      !(await confirm(
        "Remove task?",
        `Remove the local record “${task.title}”? This cannot be undone.`,
      ))
    )
      return { removed: false };
    return tasks.remove(id);
  });
  register("list-skills", () => skills.list());
  register("import-skill", (input) => skills.importSkill(input));
  register("remove-skill", async (id) => {
    const skill = skills.get(id);
    if (!(await confirm("Remove imported skill?", skill.name)))
      return { removed: false };
    return skills.remove(id);
  });
  register("list-reminders", () => reminders.list());
  register("create-reminder", (input) => reminders.create(input));
  register("snooze-reminder", (input) =>
    reminders.snooze(input?.id, input?.dueAt),
  );
  register("dismiss-reminder", (id) => reminders.dismiss(id));
  register("list-conversations", () => conversations.list());
  register("get-conversation", (id) => conversations.get(id));
  register("save-conversation-draft", async (input) => {
    if (!input || typeof input !== "object") throw Error("Invalid draft.");
    validateText(input.text);
    if (Buffer.byteLength(input.text) > 64 * 1024)
      throw Error("Draft exceeds 64 KiB.");
    if (input.id) return conversations.saveDraft(input.id, input.text);
    const item = await conversations.create({
      title: input.title || "Saved draft",
      workspaceId: workspace.root || undefined,
    });
    return conversations.saveDraft(item.id, input.text);
  });
  register("remove-conversation", async (id) => {
    const item = conversations.get(id);
    if (
      !(await confirm(
        "Delete saved conversation?",
        `Delete “${item.title}” and its local messages?`,
      ))
    )
      return { removed: false };
    return conversations.remove(id, { confirmed: true });
  });
  return { tasks, skills, reminders, conversations, connectors, team };
}
