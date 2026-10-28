import { afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { OrchestrationPanel } from "../src/OrchestrationPanel";
const digest = "a".repeat(64);
const evidence = JSON.stringify({
  format: "sebby-agent-result",
  version: 1,
  specialist: { text: "<script>bad()</script>" },
  coordinator: { text: "Independent critique" },
  evidence: [{ tool: "read_file", path: "app.ts" }],
  usage: { totalTokens: 123 },
});
const plan = (phase = "awaiting-step-review") => ({
  id: "plan",
  phase,
  digest,
  errorCode: null,
  definition: {
    goal: "Build a bounded app",
    identity: {
      profileId: "profile",
      provider: "openai",
      model: "selected-model",
      workspaceRoot: "/project",
    },
    steps: [
      {
        role: "coder",
        title: "Implement view",
        prompt: "Build it",
        limits: { maxCalls: 3, maxTotalTokens: 20000, maxOutputTokens: 2048 },
      },
    ],
    budget: { maxCalls: 4, maxTotalTokens: 40000 },
    reservation: { maxCalls: 4, maxTotalTokens: 40000 },
  },
  children: [
    {
      index: 0,
      taskId: "task",
      runId: "run",
      resultDigest: digest,
      accepted: phase !== "awaiting-step-review",
      member: { name: "Mira", role: "coder" },
    },
  ],
  finalResult:
    phase === "awaiting-final-review"
      ? {
          text: "Final critique: independently test the app.",
          responseId: "response",
          sha256: "b".repeat(64),
          usage: { totalTokens: 45 },
          contextDigest: digest,
        }
      : null,
});
function setup(plans: ReturnType<typeof plan>[] = []) {
  const api = {
    orchestrationStatus: vi.fn(async () => ({ busy: false, plans })),
    listTasks: vi.fn(async () => [
      {
        id: "task",
        title: "Implement view",
        status: "awaiting-review",
        result: evidence,
      },
    ]),
    createOrchestration: vi.fn(async (_input: unknown) => ({ created: false })),
    startOrchestrationStep: vi.fn(async (_input: unknown) => ({
      started: true,
    })),
    acceptOrchestrationStep: vi.fn(async (_input: unknown) => ({
      reviewed: false,
    })),
    finalizeOrchestration: vi.fn(async (_input: unknown) => ({
      started: true,
    })),
    acceptOrchestrationFinal: vi.fn(async (_input: unknown) => ({
      accepted: false,
    })),
    cancelOrchestration: vi.fn(async (_input: unknown) => ({
      cancelled: true,
    })),
  };
  Object.defineProperty(window, "sebby", { configurable: true, value: api });
  return api;
}
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "sebby", {
    configurable: true,
    value: undefined,
  });
});
it("no automatic execution or status request, browser controls unavailable", () => {
  const api = setup();
  render(<OrchestrationPanel report={vi.fn()} />);
  expect(api.orchestrationStatus).not.toHaveBeenCalled();
  expect(api.startOrchestrationStep).not.toHaveBeenCalled();
  expect(api.createOrchestration).not.toHaveBeenCalled();
});
it("manual creation uses explicit conservative budgets and empty context by default", async () => {
  const api = setup();
  render(<OrchestrationPanel report={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Plan goal"), {
    target: { value: "Make an app" },
  });
  fireEvent.change(screen.getByLabelText("Step 1 title"), {
    target: { value: "Plan" },
  });
  fireEvent.change(screen.getByLabelText("Step 1 prompt"), {
    target: { value: "Outline implementation" },
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Review plan with native confirmation",
    }),
  );
  await waitFor(() => expect(api.createOrchestration).toHaveBeenCalledOnce());
  expect(api.createOrchestration.mock.calls[0][0]).toMatchObject({
    goal: "Make an app",
    grantCeiling: {
      includeMemory: false,
      allowReadTools: false,
      allowEdits: false,
      skillIds: [],
      filePaths: [],
    },
    steps: [
      {
        role: "planner",
        contextOptions: {
          includeMemory: false,
          allowReadTools: false,
          allowEdits: false,
          filePaths: [],
        },
        limits: { maxCalls: 3, maxTotalTokens: 20000, maxOutputTokens: 2048 },
      },
    ],
    finalLimits: { maxOutputTokens: 2048, maxTotalTokens: 20000 },
  });
  expect(api.startOrchestrationStep).not.toHaveBeenCalled();
});
it("full child evidence must be opened and acknowledged before exact digest acceptance", async () => {
  const api = setup([plan()]);
  render(<OrchestrationPanel report={vi.fn()} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh plan status and evidence" }),
  );
  await screen.findByText("Mira · Implement view");
  const button = screen.getByRole("button", {
    name: "Accept step evidence with native confirmation",
  });
  expect(button.hasAttribute("disabled")).toBe(true);
  const details = screen
    .getByText(
      "Full specialist result, coordinator review, tool evidence and usage",
    )
    .closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await waitFor(() =>
    expect(
      screen
        .getByLabelText(/I reviewed this complete specialist/)
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByLabelText(/I reviewed this complete specialist/));
  fireEvent.click(button);
  await waitFor(() =>
    expect(api.acceptOrchestrationStep).toHaveBeenCalledWith({
      planId: "plan",
      taskId: "task",
      resultDigest: digest,
    }),
  );
  expect(document.querySelector("script")).toBeNull();
  expect(api.startOrchestrationStep).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", {
          name: "Accept step evidence with native confirmation",
        })
        .hasAttribute("disabled"),
    ).toBe(true),
  );
});
it("final critique is fully visible and separate native acceptance is digest-bound", async () => {
  const api = setup([plan("awaiting-final-review")]);
  render(<OrchestrationPanel report={vi.fn()} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh plan status and evidence" }),
  );
  await screen.findByText("Final critique: independently test the app.");
  const button = screen.getByRole("button", {
    name: "Accept final evidence with native confirmation",
  });
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByLabelText(/I reviewed the full final critique/));
  fireEvent.click(button);
  await waitFor(() =>
    expect(api.acceptOrchestrationFinal).toHaveBeenCalledWith({
      planId: "plan",
      finalResultDigest: "b".repeat(64),
    }),
  );
  expect(api.finalizeOrchestration).not.toHaveBeenCalled();
});
it("next step starts only explicitly and cancellation does not imply rollback", async () => {
  const api = setup([plan("ready")]);
  render(<OrchestrationPanel report={vi.fn()} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh plan status and evidence" }),
  );
  await screen.findByRole("button", {
    name: "Start next specialist with native approval",
  });
  expect(api.startOrchestrationStep).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Start next specialist with native approval",
    }),
  );
  await waitFor(() =>
    expect(api.startOrchestrationStep).toHaveBeenCalledWith({ planId: "plan" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel this plan" }));
  await screen.findByText(/completed edits or billed requests may remain/);
  expect(api.cancelOrchestration).toHaveBeenCalledWith({ planId: "plan" });
});
it("step count capped at four and aggregate budget cannot undercut declared child reservations", () => {
  setup();
  render(<OrchestrationPanel report={vi.fn()} />);
  for (let i = 0; i < 3; i++)
    fireEvent.click(
      screen.getByRole("button", { name: "Add sequential step" }),
    );
  expect(
    screen
      .getByRole("button", { name: "Add sequential step" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("Total plan call budget"), {
    target: { value: "3" },
  });
  expect(
    screen
      .getByRole("button", { name: "Review plan with native confirmation" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
