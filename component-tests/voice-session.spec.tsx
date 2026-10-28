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
it("voice-only stop never cancels chat; explicit global stop does", () => {
  speech();
  const capture = vi.fn(),
    chat = vi.fn();
  render(
    <VoiceSessionProvider>
      <Registered stopCapture={capture} stopChat={chat} />
      <VoiceSessionStatus />
    </VoiceSessionProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Mark owned chat active" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Stop voice activity" }));
  expect(capture).toHaveBeenCalledOnce();
  expect(chat).not.toHaveBeenCalled();
  expect(screen.getByText(/Stop requested/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Stop voice and current chat" }),
  );
  expect(chat).toHaveBeenCalledOnce();
});
it("reading state requires onstart and stale utterance events cannot revive a stopped session", () => {
  speech();
  render(
    <VoiceSessionProvider>
      <VoiceSessionStatus />
      <SpeechButton text="Actual response" />
    </VoiceSessionProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Read response aloud locally" }),
  );
  expect(screen.getByText(/Local speech: queued/)).toBeTruthy();
  act(() => utterance.onstart());
  expect(screen.getByText(/Local speech: reading/)).toBeTruthy();
  const previous = utterance;
  fireEvent.click(screen.getByRole("button", { name: "Stop voice activity" }));
  act(() => previous.onstart());
  expect(screen.getByText(/Local speech: idle/)).toBeTruthy();
  expect(screen.queryByText(/Local speech: reading/)).toBeNull();
});
it("microphone start stops local playback; read-aloud disabled during capture; global stop releases tracks", async () => {
  const stopSpeech = speech(),
    stopTrack = vi.fn();
  const api = {
    voiceStatus: async () => ({ configured: true, provider: "openai" }),
    beginVoiceCapture: vi.fn(async () => ({ captureId: "capture" })),
    endVoiceCapture: vi.fn(async () => ({})),
    cancelVoice: vi.fn(async () => ({})),
    transcribeVoice: vi.fn(),
  };
  Object.defineProperty(window, "sebby", { configurable: true, value: api });
  class Recorder {
    static isTypeSupported() {
      return true;
    }
    state = "inactive";
    onstop: any;
    ondataavailable: any;
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.onstop?.();
    }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: stopTrack }],
      })),
    },
  });
  render(
    <VoiceSessionProvider>
      <VoiceSessionStatus />
      <VoiceControls report={vi.fn()} onTranscript={vi.fn()} />
      <SpeechButton text="Actual response" />
    </VoiceSessionProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Read response aloud locally" }),
  );
  act(() => utterance.onstart());
  fireEvent.change(screen.getByLabelText("Transcription model"), {
    target: { value: "gpt-transcribe" },
  });
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Start recording" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
  await screen.findByRole("button", { name: "Stop recording" });
  expect(stopSpeech).toHaveBeenCalled();
  expect(
    screen
      .getByRole("button", { name: "Read response aloud locally" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Stop voice activity" }));
  expect(stopTrack).toHaveBeenCalledOnce();
  expect(api.cancelVoice).toHaveBeenCalledWith("capture");
  expect(api.transcribeVoice).not.toHaveBeenCalled();
});
it("stop intent survives pending chat.start and cancels only its eventual owned run", async () => {
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
    onChatEvent: () => () => {},
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
  await act(async () =>
    resolve({ runId: "owned-late-run", conversationId: "conversation" }),
  );
  await waitFor(() =>
    expect(api.cancelChat).toHaveBeenCalledWith("owned-late-run"),
  );
  expect(api.cancelChat).toHaveBeenCalledOnce();
});
it("voice stop during pending native capture consent never opens a microphone after late approval", async () => {
  let grant!: (v: { captureId: string }) => void;
  const getMedia = vi.fn();
  const api = {
    voiceStatus: async () => ({ configured: true, provider: "openai" }),
    beginVoiceCapture: vi.fn(() => new Promise((r) => (grant = r))),
    cancelVoice: vi.fn(async () => ({})),
    endVoiceCapture: vi.fn(),
    transcribeVoice: vi.fn(),
  };
  Object.defineProperty(window, "sebby", { configurable: true, value: api });
  vi.stubGlobal(
    "MediaRecorder",
    class {
      static isTypeSupported() {
        return true;
      }
    },
  );
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: getMedia },
  });
  render(
    <VoiceSessionProvider>
      <VoiceSessionStatus />
      <VoiceControls report={vi.fn()} onTranscript={vi.fn()} />
    </VoiceSessionProvider>,
  );
  fireEvent.change(screen.getByLabelText("Transcription model"), {
    target: { value: "gpt-transcribe" },
  });
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Start recording" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
  await waitFor(() => expect(api.beginVoiceCapture).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Stop voice activity" }));
  await act(async () => grant({ captureId: "late-grant" }));
  expect(api.cancelVoice).toHaveBeenCalledWith("late-grant");
  expect(getMedia).not.toHaveBeenCalled();
  expect(api.transcribeVoice).not.toHaveBeenCalled();
});
