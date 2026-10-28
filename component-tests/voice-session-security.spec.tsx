import { useEffect, useState } from "react";
import { afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import {
  VoiceSessionProvider,
  VoiceSessionStatus,
  useVoiceSession,
} from "../src/VoiceSession";
import { VoiceControls } from "../src/VoiceControls";
import { SpeechButton } from "../src/SpeechButton";
vi.mock("../src/Appearance", () => ({ PalView: () => <img alt="Sebby" /> }));
vi.mock("../src/ProviderSettings", () => ({
  ProviderPicker: () => <div>Profile</div>,
}));
import { ChatPanel } from "../src/ChatPanel";
let utterance: any;
function speech() {
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      onstart?: () => void;
      onend?: () => void;
      onerror?: () => void;
      constructor(public text: string) {
        utterance = this;
      }
    },
  );
  const cancel = vi.fn();
  vi.stubGlobal("speechSynthesis", {
    cancel,
    speak: vi.fn(),
    getVoices: () => [{ localService: true, lang: "en-US" }],
  });
  return cancel;
}
function Registered({
  stopCapture,
  stopChat,
}: {
  stopCapture: () => void;
  stopChat: () => void;
}) {
  const s = useVoiceSession();
  useEffect(
    () => s.registerCapture(stopCapture),
    [s.registerCapture, stopCapture],
  );
  useEffect(() => s.registerChat(stopChat), [s.registerChat, stopChat]);
  return (
    <button onClick={() => s.setChat("waiting for response")}>
      Mark owned chat active
    </button>
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(window, "sebby", {
    configurable: true,
    value: undefined,
  });
});
it("independent stop branches continue when capture and device speech cleanup throw", async () => {
  speech();
  vi.spyOn(window.speechSynthesis, "cancel").mockImplementation(() => {
    throw Error("device failed");
  });
  const chat = vi.fn();
  render(
    <VoiceSessionProvider>
      <Registered
        stopCapture={() => {
          throw Error("track failed");
        }}
        stopChat={chat}
      />
      <VoiceSessionStatus />
    </VoiceSessionProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Mark owned chat active" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Stop voice and current chat" }),
  );
  await waitFor(() => expect(chat).toHaveBeenCalledOnce());
});
it("independent stop intent cancels an event-disclosed run before start promise resolves", async () => {
  let event!: (v: any) => void;
  let resolve!: (v: { runId: string; conversationId: string }) => void;
  const api = {
    providerStatus: async () => ({
      configured: true,
      provider: "openai",
      model: "chosen",
    }),
    listConversations: async () => [],
    getConversation: async () => ({
      id: "conversation",
      title: "test",
      draft: "",
      messages: [],
    }),
    chatStatus: async (id?: string) =>
      id ? { runId: id, status: "cancelled" } : { status: "idle" },
    startChat: vi.fn(() => new Promise((r) => (resolve = r))),
    cancelChat: vi.fn(async () => ({ cancelled: true })),
    onChatEvent: (fn: (v: any) => void) => {
      event = fn;
      return () => {};
    },
  };
  Object.defineProperty(window, "sebby", { configurable: true, value: api });
  function Harness() {
    const [draft, setDraft] = useState("Hello");
    return (
      <ChatPanel
        draft={draft}
        setDraft={setDraft}
        useSkill={vi.fn()}
        report={vi.fn()}
      />
    );
  }
  render(<Harness />);
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Review and send chat" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Review and send chat" }));
  await waitFor(() => expect(api.startChat).toHaveBeenCalledOnce());
  fireEvent.click(
    screen.getByRole("button", { name: "Stop voice and current chat" }),
  );
  expect(api.cancelChat).not.toHaveBeenCalled();
  act(() =>
    event({ type: "status", status: "preparing", runId: "owned-late-run" }),
  );
  await waitFor(() =>
    expect(api.cancelChat).toHaveBeenCalledWith("owned-late-run"),
  );
  await act(async () =>
    resolve({ runId: "owned-late-run", conversationId: "conversation" }),
  );
  await waitFor(() =>
    expect(api.cancelChat).toHaveBeenCalledWith("owned-late-run"),
  );
  expect(
    api.cancelChat.mock.calls.every(([id]) => id === "owned-late-run"),
  ).toBe(true);
});
