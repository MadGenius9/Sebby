import { useState } from "react";
import { afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
vi.mock("../src/Appearance", () => ({
  PalView: () => (
    <img src="./orbit.png" alt="Sebby, your ice-blue Orbit companion" />
  ),
}));
vi.mock("../src/ProviderSettings", () => ({
  ProviderPicker: () => <div>Selected profile picker</div>,
}));
import { ChatPanel } from "../src/ChatPanel";
function Harness({ report = vi.fn() }: { report?: (text: string) => void }) {
  const [draft, setDraft] = useState("My idea");
  return (
    <ChatPanel
      draft={draft}
      setDraft={setDraft}
      useSkill={setDraft}
      report={report}
    />
  );
}
function setup(overrides: Record<string, unknown> = {}) {
  let callback: (event: any) => void = () => {};
  const unsubscribe = vi.fn();
  const api = {
    providerStatus: vi.fn(async () => ({
      configured: true,
      model: "chosen-model",
      provider: "openai",
    })),
    listConversations: vi.fn(async () => []),
    getConversation: vi.fn(async (id: string) => ({
      id,
      title: "My idea",
      draft: "My idea",
      messages: [],
    })),
    chatStatus: vi.fn(async (id?: string) =>
      id
        ? { runId: id, conversationId: "conv1", status: "awaiting-approval" }
        : { status: "idle" },
    ),
    startChat: vi.fn(async () => ({ runId: "run1", conversationId: "conv1" })),
    cancelChat: vi.fn(async () => ({ cancelled: true })),
    onChatEvent: vi.fn((fn: (event: any) => void) => {
      callback = fn;
      return unsubscribe;
    }),
    onProviderChanged: vi.fn(() => () => {}),
    ...overrides,
  };
  Object.defineProperty(window, "sebby", { configurable: true, value: api });
  return { api, emit: (event: any) => callback(event), unsubscribe };
}
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "sebby", {
    configurable: true,
    value: undefined,
  });
});
it("browser fallback retains Orbit, suggestions and disabled disconnected send", () => {
  render(<Harness />);
  expect(
    screen.getByRole("heading", { name: "What shall we build?" }),
  ).toBeTruthy();
  expect(
    screen
      .getByAltText("Sebby, your ice-blue Orbit companion")
      .getAttribute("src"),
  ).toBe("./orbit.png");
  expect(
    (
      screen.getByRole("button", {
        name: "Send unavailable: AI not connected",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Plan an app" }));
  expect(
    (screen.getByLabelText("Your local chat draft") as HTMLTextAreaElement)
      .value,
  ).toContain("App planning");
});
it("ready chat never auto sends and submits explicit context defaults only", async () => {
  const { api } = setup();
  render(<Harness />);
  await screen.findByRole("button", { name: "Review and send chat" });
  expect(api.startChat).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Review and send chat" }));
  await waitFor(() =>
    expect(api.startChat).toHaveBeenCalledWith({
      text: "My idea",
      includeMemory: false,
      filePaths: [],
      skillIds: [],
    }),
  );
  expect(screen.getByText(/Chat: awaiting-approval/)).toBeTruthy();
});
it("streaming events are text-only, cancellation real and final history replaces provisional text", async () => {
  const { api, emit } = setup();
  render(<Harness />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Review and send chat" }),
  );
  await waitFor(() => expect(api.chatStatus).toHaveBeenCalledWith("run1"));
  await act(async () => {
    emit({ type: "dispatched", runId: "run1", conversationId: "conv1" });
    emit({
      type: "delta",
      runId: "run1",
      conversationId: "conv1",
      delta: "<script>not executable</script>",
    });
    emit({
      type: "status",
      runId: "run1",
      conversationId: "conv1",
      status: "streaming",
    });
  });
  expect(document.querySelector("script")).toBeNull();
  expect(screen.getByText("<script>not executable</script>")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel response" }));
  await waitFor(() => expect(api.cancelChat).toHaveBeenCalledWith("run1"));
  api.getConversation.mockResolvedValue({
    id: "conv1",
    title: "My idea",
    draft: "",
    messages: [
      {
        id: "m1",
        role: "assistant",
        text: "Saved partial",
        status: "interrupted",
      },
    ],
  } as never);
  await act(async () =>
    emit({
      type: "interrupted",
      runId: "run1",
      conversationId: "conv1",
      status: "cancelled",
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
    }),
  );
  await screen.findByText("Saved partial");
  expect(screen.getByText("Interrupted · partial response")).toBeTruthy();
  expect(screen.queryByLabelText("Provisional streaming response")).toBeNull();
});
it("restores active status and saved history without replaying a request", async () => {
  const { api } = setup({
    chatStatus: vi.fn(async () => ({
      runId: "existing",
      conversationId: "conv1",
      status: "streaming",
    })),
    getConversation: vi.fn(async () => ({
      id: "conv1",
      title: "Earlier",
      messages: [
        { id: "u", role: "user", status: "sent", text: "Earlier user text" },
      ],
    })),
  });
  render(<Harness />);
  await screen.findByText("Earlier user text");
  expect(screen.getByRole("button", { name: "Cancel response" })).toBeTruthy();
  expect(api.startChat).not.toHaveBeenCalled();
});
it("denied send preserves unsent draft and ignores unrelated stream events", async () => {
  const { emit, api } = setup();
  render(<Harness />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Review and send chat" }),
  );
  await waitFor(() => expect(api.chatStatus).toHaveBeenCalledWith("run1"));
  await act(async () => {
    emit({ type: "delta", runId: "other", delta: "Wrong conversation" });
    emit({
      type: "status",
      runId: "run1",
      conversationId: "conv1",
      status: "denied",
      error: "Request not sent.",
    });
  });
  expect(
    (screen.getByLabelText("Your local chat draft") as HTMLTextAreaElement)
      .value,
  ).toBe("My idea");
  expect(screen.queryByText("Wrong conversation")).toBeNull();
});
it("unsubscribes UI event listeners without cancelling active work on navigation", async () => {
  const { unsubscribe, api } = setup();
  const view = render(<Harness />);
  await screen.findByRole("button", { name: "Review and send chat" });
  view.unmount();
  expect(unsubscribe).toHaveBeenCalled();
  expect(api.cancelChat).not.toHaveBeenCalled();
});
it("saves a named draft locally without invoking AI", async () => {
  const { api } = setup({
    saveConversationDraft: vi.fn(async () => ({
      id: "conv1",
      title: "Local plan",
      draft: "My idea",
      messages: [],
    })),
  });
  render(<Harness />);
  await screen.findByRole("button", { name: "Review and send chat" });
  fireEvent.change(screen.getByLabelText("New draft title (optional)"), {
    target: { value: "Local plan" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save draft locally" }));
  await screen.findByText("Draft saved locally. No message sent.");
  expect((api as any).saveConversationDraft).toHaveBeenCalledWith({
    title: "Local plan",
    text: "My idea",
  });
  expect(api.startChat).not.toHaveBeenCalled();
});
it("cancelled native deletion retains selection and confirmed deletion clears it", async () => {
  const remove = vi.fn(async () => ({ removed: false }));
  const { api } = setup({
    listConversations: vi.fn(async () => [{ id: "conv1", title: "Saved" }]),
    removeConversation: remove,
  });
  render(<Harness />);
  await screen.findByRole("option", { name: "Saved" });
  fireEvent.change(screen.getByLabelText("Saved conversation"), {
    target: { value: "conv1" },
  });
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Delete selected conversation",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Delete selected conversation" }),
  );
  await screen.findByText("Deletion cancelled. Conversation retained.");
  expect(
    (screen.getByLabelText("Saved conversation") as HTMLSelectElement).value,
  ).toBe("conv1");
  remove.mockResolvedValue({ removed: true });
  fireEvent.click(
    screen.getByRole("button", { name: "Delete selected conversation" }),
  );
  await screen.findByText(
    "Conversation deleted. The current unsent draft is retained locally.",
  );
  expect(
    (screen.getByLabelText("Saved conversation") as HTMLSelectElement).value,
  ).toBe("");
  expect(remove).toHaveBeenCalledWith("conv1");
  expect(api.startChat).not.toHaveBeenCalled();
});
it("local deletion and draft saving are disabled during an active response", async () => {
  setup({
    chatStatus: vi.fn(async () => ({
      runId: "active",
      conversationId: "conv1",
      status: "streaming",
    })),
    removeConversation: vi.fn(),
    saveConversationDraft: vi.fn(),
  });
  render(<Harness />);
  await screen.findByText(/Chat: streaming/);
  expect(
    (
      screen.getByRole("button", {
        name: "Delete selected conversation",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    (
      screen.getByRole("button", {
        name: "Save draft locally",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
