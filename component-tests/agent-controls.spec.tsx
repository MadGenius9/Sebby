import { afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { AgentTaskControls } from "../src/AgentControls";
import type { Task } from "../src/bridge";
const task: Task = {
  id: "task1",
  kind: "ai",
  title: "Build",
  prompt: "Build it",
  role: "coder",
  status: "queued",
  workspace: "/project",
  logs: [],
};
function setup(overrides: Record<string, unknown> = {}, value: Task = task) {
  const api = {
    providerStatus: vi.fn(async () => ({
      configured: true,
      provider: "openai",
      model: "chosen-model",
    })),
    startAgent: vi.fn(async () => ({ started: true })),
    cancelAgent: vi.fn(async () => ({ cancelled: true })),
    reviewAgent: vi.fn(async () => ({ reviewed: true })),
    ...overrides,
  };
  Object.defineProperty(window, "sebby", { configurable: true, value: api });
  const report = vi.fn(),
    refresh = vi.fn();
  render(<AgentTaskControls task={value} report={report} refresh={refresh} />);
  return { api, report, refresh };
}
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "sebby", {
    configurable: true,
    value: undefined,
  });
});
it("never starts automatically and default permissions/context are off", async () => {
  const { api } = setup();
  await screen.findByText("Selected: openai · chosen-model");
  expect(api.startAgent).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Review context and start AI run" }),
  );
  await waitFor(() =>
    expect(api.startAgent).toHaveBeenCalledWith({
      taskId: "task1",
      contextOptions: {
        includeMemory: false,
        filePaths: [],
        allowReadTools: false,
        allowEdits: false,
      },
      limits: { maxCalls: 3, maxTotalTokens: 20000 },
    }),
  );
});
it("unconfigured profile blocks start", async () => {
  const { api } = setup({
    providerStatus: vi.fn(async () => ({ configured: false })),
  });
  await screen.findByText(/Configure a provider key/);
  expect(
    (
      screen.getByRole("button", {
        name: "Review context and start AI run",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(api.startAgent).not.toHaveBeenCalled();
});
it("invalid file paths block and edit permission requires explicit checkbox", async () => {
  const { api, report } = setup();
  await screen.findByText(/Selected:/);
  fireEvent.change(screen.getByLabelText(/Explicit workspace file paths/), {
    target: { value: "../secret.txt" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Review context and start AI run" }),
  );
  expect(api.startAgent).not.toHaveBeenCalled();
  expect(report).toHaveBeenCalledWith(expect.stringMatching(/relative/));
  fireEvent.click(screen.getByLabelText("Allow file-edit proposals"));
  expect(screen.getByRole("note").textContent).toContain("full diff review");
});
it("renders evidence as text and requires opening review before native acceptance", async () => {
  const result = JSON.stringify({
    format: "sebby-agent-result",
    version: 1,
    model: "model",
    specialist: { responseId: "resp1", text: "<img src=x onerror=alert(1)>" },
    coordinator: { responseId: "resp2", text: "Verify the result." },
    evidence: [{ tool: "read_file", path: "src/a.ts", status: "denied" }],
    usage: null,
    providerCalls: 2,
    conservativeTokenReservation: 10000,
    requiresUserAcceptance: true,
  });
  const { api } = setup({}, { ...task, status: "awaiting-review", result });
  const button = screen.getByRole("button", {
    name: "Review evidence and request acceptance",
  });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  const details = screen.getByText(
    "Review specialist, coordinator and tool evidence",
  ).parentElement!;
  (details as HTMLDetailsElement).open = true;
  fireEvent(details, new Event("toggle", { bubbles: true }));
  await waitFor(() =>
    expect((button as HTMLButtonElement).disabled).toBe(false),
  );
  expect(document.querySelector("img")).toBeNull();
  expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
  fireEvent.click(button);
  await waitFor(() => expect(api.reviewAgent).toHaveBeenCalledWith("task1"));
});
it("malformed evidence cannot be accepted and non-AI tasks have no controls", () => {
  const { api } = setup(
    {},
    { ...task, status: "awaiting-review", result: "not-json" },
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Review evidence and request acceptance",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(api.reviewAgent).not.toHaveBeenCalled();
  cleanup();
  setup({}, { ...task, kind: "manual" });
  expect(
    screen.queryByRole("region", { name: "AI agent controls" }),
  ).toBeNull();
});
it("running task cancellation calls the real bridge, without inventing results", async () => {
  const { api } = setup({}, { ...task, status: "running" });
  fireEvent.click(screen.getByRole("button", { name: "Cancel AI run" }));
  await waitFor(() => expect(api.cancelAgent).toHaveBeenCalledWith("task1"));
});
