import { describe, it, expect, afterAll, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installLocalFeatures } from "../electron/local-features.mjs";
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-component-"));
const handlers = new Map();
const { Workspace } = await import("../electron/services.mjs");
const { installLocalExecutor } =
  await import("../electron/local-executor-ipc.mjs");
const workspace = new Workspace();
await fs.mkdir(path.join(directory, "project"));
await fs.writeFile(
  path.join(directory, "project", "README.md"),
  "Real fixture text",
);
await workspace.select(path.join(directory, "project"));
const services = await installLocalFeatures({
  directory,
  register: (name, fn) => handlers.set(name, fn),
  workspace,
  confirm: async () => false,
});
const executor = installLocalExecutor({
  ...services,
  workspace,
  register: (name, fn) => handlers.set(name, fn),
  confirm: async () => true,
});
const methods = {
  startLocalUtility: "start-local-utility",
  reviewLocalUtility: "review-local-utility",
  listTeam: "list-team",
  createTeamMember: "create-team-member",
  renameTeamMember: "rename-team-member",
  retireTeamMember: "retire-team-member",
  assignTeamTask: "assign-team-task",
  listTasks: "list-tasks",
  createTask: "create-task",
  cancelTask: "cancel-task",
  retryTask: "retry-task",
  removeTask: "remove-task",
  listSkills: "list-skills",
  importSkill: "import-skill",
  removeSkill: "remove-skill",
  listReminders: "list-reminders",
  createReminder: "create-reminder",
  snoozeReminder: "snooze-reminder",
  dismissReminder: "dismiss-reminder",
};
Object.defineProperty(window, "sebby", {
  configurable: true,
  value: Object.fromEntries(
    Object.entries(methods).map(([method, handler]) => [
      method,
      async (input) => handlers.get(handler)(input),
    ]),
  ),
});
const { TeamPanel } = await import("../src/TeamPanel");
const { TasksPanel, RemindersPanel, ImportedSkills } =
  await import("../src/LocalPanels");
afterEach(cleanup);
afterAll(async () => {
  await executor.shutdown();
  await fs.rm(directory, { recursive: true, force: true });
  delete window.sebby;
});
describe("desktop components using real local IPC service handlers", () => {
  it("creates a named specialist with honest executor state and persisted identity", async () => {
    const errors = [];
    render(<TeamPanel report={(s) => errors.push(s)} />);
    fireEvent.change(screen.getByLabelText("Clear job"), {
      target: { value: "Plan small verified app milestones" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Let Sebby name a specialist" }),
    );
    await screen.findByRole("heading", { name: "Mira" });
    expect(screen.getByText("Planning")).toBeTruthy();
    expect(screen.getByText(/Name assigned by Sebby/)).toBeTruthy();
    expect((await handlers.get("list-team")())[0].job).toContain("verified");
    expect(errors).toEqual([]);
  });
  it("creates and cancels a real durable queued task, not fake work", async () => {
    const errors = [];
    render(<TasksPanel report={(s) => errors.push(s)} />);
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Plan a test project" },
    });
    fireEvent.change(screen.getByLabelText("What needs doing?"), {
      target: { value: "Split the goal into three safe steps" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save to queue" }));
    await screen.findByRole("heading", { name: "Plan a test project" });
    expect(screen.getByText("planner · queued")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel", exact: true }),
    );
    await screen.findByText("planner · cancelled");
    expect((await handlers.get("list-tasks")())[0].status).toBe("cancelled");
    expect(errors).toEqual([]);
  });
  it("imports instructions as untrusted and uses actual content", async () => {
    let draft = "";
    const errors = [];
    render(
      <ImportedSkills
        report={(s) => errors.push(s)}
        useSkill={(s) => (draft = s)}
      />,
    );
    fireEvent.click(screen.getByText("Add a skill"));
    fireEvent.change(screen.getByLabelText("Skill ID"), {
      target: { value: "user-check-tests" },
    });
    fireEvent.change(screen.getByLabelText("Skill name"), {
      target: { value: "Check the tests" },
    });
    fireEvent.change(screen.getByLabelText("Skill description"), {
      target: { value: "Read tests before editing" },
    });
    fireEvent.change(screen.getByLabelText("Skill instructions"), {
      target: { value: "Read the tests. State what remains unverified." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save instruction skill" }),
    );
    await screen.findByRole("heading", { name: "Check the tests" });
    expect(screen.getByText("Imported · Untrusted instructions")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use in draft" }));
    expect(draft).toBe("Read the tests. State what remains unverified.");
    expect(errors).toEqual([]);
  });
  it("saves and dismisses an in-app reminder without notification claims", async () => {
    const errors = [];
    render(<RemindersPanel report={(s) => errors.push(s)} />);
    fireEvent.change(screen.getByLabelText("Reminder"), {
      target: { value: "Review milestone" },
    });
    fireEvent.change(screen.getByLabelText("Your local date and time"), {
      target: { value: "2026-12-01T12:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save reminder" }));
    await screen.findByRole("heading", { name: "Review milestone" });
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss", exact: true }),
    );
    await waitFor(async () =>
      expect((await handlers.get("list-reminders")())[0].status).toBe(
        "dismissed",
      ),
    );
    expect(errors).toEqual([]);
  });
  it("runs actual local inventory and requires separate review before completion", async () => {
    const errors = [];
    render(<TasksPanel report={(s) => errors.push(s)} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Review and start utility…" }),
    );
    await screen.findByRole("heading", {
      name: "Local utility: workspace inventory",
    });
    await waitFor(
      () =>
        expect(screen.getByText("researcher · awaiting-review")).toBeTruthy(),
      { timeout: 4000 },
    );
    expect(screen.getByText(/# Workspace inventory/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Review and accept this utility result…",
      }),
    );
    await screen.findByText("researcher · completed");
    const utility = (await handlers.get("list-tasks")()).find(
      (t) => t.kind === "local-inventory",
    );
    expect(utility.result).toContain("README.md");
    expect(utility.result).toContain("not AI analysis");
    expect(errors).toEqual([]);
  });
});
