import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
vi.mock("../src/Appearance", () => ({ PalView: () => <img alt="Sebby" /> }));
vi.mock("../src/ProviderSettings", () => ({
  ProviderPicker: () => <div>Profile</div>,
}));
vi.mock("../src/LocalVoiceSettings", () => ({
  LocalVoiceSettings: () => <div>Voice settings</div>,
}));
vi.mock("../src/SpeechButton", () => ({
  SpeechButton: () => <button>Read manually</button>,
}));
vi.mock("../src/VoiceControls", () => ({
  VoiceControls: ({
    onConversationTranscript,
  }: {
    onConversationTranscript: (text: string) => void;
  }) => (
    <button onClick={() => onConversationTranscript("Spoken question")}>
      Submit spoken turn fixture
    </button>
  ),
}));
vi.mock("../src/localSpeech", () => ({
  voicePreferences: () => ({ provider: "neural", voice: "af_heart", speed: 1 }),
  speakNeuralText: vi.fn(async () => {}),
  stopNeuralSpeech: vi.fn(async () => {}),
}));
import { ChatPanel } from "../src/ChatPanel";
import { speakNeuralText } from "../src/localSpeech";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  Object.defineProperty(window, "sebby", {
    configurable: true,
    value: undefined,
  });
});
function fixture(configured = true) {
  let event!: (value: Record<string, unknown>) => void;
  const conversation = {
    id: "conversation",
    title: "Voice turn",
    draft: "",
    messages: [
      {
        id: "assistant",
        role: "assistant",
        text: "Completed actual-provider reply fixture",
        status: "complete",
      },
    ],
  };
  const api = {
    providerStatus: vi.fn(async () => ({
      configured,
      provider: "ollama",
      model: configured ? "qwen3:8b" : "",
    })),
    listConversations: vi.fn(async () => []),
    getConversation: vi.fn(async () => conversation),
    chatStatus: vi.fn(async (id?: string) =>
      id
        ? { runId: id, status: "streaming", conversationId: "conversation" }
        : { status: "idle" },
    ),
    startChat: vi.fn(async () => ({
      runId: "owned-run",
      conversationId: "conversation",
    })),
    cancelChat: vi.fn(async () => ({ cancelled: true })),
    onChatEvent: (fn: typeof event) => {
      event = fn;
      return () => {};
    },
  };
  Object.defineProperty(window, "sebby", { configurable: true, value: api });
  function Harness() {
    const [draft, setDraft] = useState("");
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
  return {
    api,
    conversation,
    emit: (value: Record<string, unknown>) =>
      act(() =>
        event({ runId: "owned-run", conversationId: "conversation", ...value }),
      ),
  };
}
async function startVoiceTurn(api: ReturnType<typeof fixture>["api"]) {
  await waitFor(() => expect(api.providerStatus).toHaveBeenCalled());
  // Profile readiness updates on a microtask following its status call.
  await waitFor(() =>
    expect(screen.getByText(/ollama · qwen3:8b/)).toBeTruthy(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Submit spoken turn fixture" }),
  );
  await waitFor(() => expect(api.startChat).toHaveBeenCalledOnce());
  await waitFor(() => expect(api.chatStatus).toHaveBeenCalledWith("owned-run"));
}

it("only a completed owned voice turn reads its completed saved assistant message", async () => {
  const f = fixture();
  await startVoiceTurn(f.api);
  expect(f.api.startChat).toHaveBeenCalledWith({
    text: "Spoken question",
    includeMemory: false,
    filePaths: [],
    skillIds: [],
  });
  f.emit({ type: "status", status: "completed", runId: "another-run" });
  expect(speakNeuralText).not.toHaveBeenCalled();
  f.emit({ type: "status", status: "completed" });
  await waitFor(() => expect(speakNeuralText).toHaveBeenCalledOnce());
  expect(vi.mocked(speakNeuralText).mock.calls[0].slice(0, 2)).toEqual([
    "Completed actual-provider reply fixture",
    "en",
  ]);
  f.emit({ type: "status", status: "completed" });
  expect(speakNeuralText).toHaveBeenCalledOnce();
});

it.each(["denied", "error", "cancelled", "interrupted"])(
  "%s voice turn never produces automatic speech",
  async (status) => {
    const f = fixture();
    await startVoiceTurn(f.api);
    f.emit({ type: "status", status });
    await waitFor(() => expect(f.api.getConversation).toHaveBeenCalled());
    expect(speakNeuralText).not.toHaveBeenCalled();
  },
);

it("interruption while a saved reply is loading suppresses late automatic reading", async () => {
  const f = fixture();
  await startVoiceTurn(f.api);
  const releases: ((value: typeof f.conversation) => void)[] = [];
  f.api.getConversation.mockImplementation(
    () => new Promise((resolve) => releases.push(resolve)),
  );
  f.emit({ type: "status", status: "completed" });
  await waitFor(() => expect(releases.length).toBeGreaterThan(0));
  act(() => window.dispatchEvent(new Event("sebby:voice-interrupt")));
  await act(async () => releases.forEach((resolve) => resolve(f.conversation)));
  expect(speakNeuralText).not.toHaveBeenCalled();
});

it("explicit Cancel response suppresses a racing completed voice event", async () => {
  const f = fixture();
  await startVoiceTurn(f.api);
  fireEvent.click(screen.getByRole("button", { name: "Cancel response" }));
  await waitFor(() =>
    expect(f.api.cancelChat).toHaveBeenCalledWith("owned-run"),
  );
  f.emit({ type: "status", status: "completed" });
  await act(async () => {});
  expect(speakNeuralText).not.toHaveBeenCalled();
});

it("unconfigured chat retains the spoken transcript as a draft without a provider request", async () => {
  const f = fixture(false);
  await waitFor(() =>
    expect(screen.getByText(/AI is not connected/)).toBeTruthy(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Submit spoken turn fixture" }),
  );
  expect(
    (screen.getByLabelText("Your local chat draft") as HTMLTextAreaElement)
      .value,
  ).toBe("Spoken question");
  expect(f.api.startChat).not.toHaveBeenCalled();
  expect(speakNeuralText).not.toHaveBeenCalled();
});

it("a spoken turn preserves an existing typed draft and requires explicit review before sending", async () => {
  const f = fixture();
  await waitFor(() =>
    expect(screen.getByText(/ollama · qwen3:8b/)).toBeTruthy(),
  );
  fireEvent.change(screen.getByLabelText("Your local chat draft"), {
    target: { value: "Keep this typed project plan." },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Submit spoken turn fixture" }),
  );
  expect(
    (screen.getByLabelText("Your local chat draft") as HTMLTextAreaElement)
      .value,
  ).toBe("Keep this typed project plan.\nSpoken question");
  expect(f.api.startChat).not.toHaveBeenCalled();
  expect(speakNeuralText).not.toHaveBeenCalled();
});

it("the explicit send-and-speak action submits the current draft and speaks only after completion", async () => {
  const f = fixture();
  await waitFor(() =>
    expect(screen.getByText(/ollama · qwen3:8b/)).toBeTruthy(),
  );
  const action = screen.getByRole("button", {
    name: "Review, send and speak reply",
  }) as HTMLButtonElement;
  expect(action.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Your local chat draft"), {
    target: { value: "Can you hear me?" },
  });
  expect(action.disabled).toBe(false);
  fireEvent.click(action);
  await waitFor(() => expect(f.api.startChat).toHaveBeenCalledOnce());
  expect(f.api.startChat).toHaveBeenCalledWith({
    text: "Can you hear me?",
    includeMemory: false,
    filePaths: [],
    skillIds: [],
  });
  expect(speakNeuralText).not.toHaveBeenCalled();
  f.emit({ type: "status", status: "completed" });
  await waitFor(() => expect(speakNeuralText).toHaveBeenCalledOnce());
});
