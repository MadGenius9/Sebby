import { useEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { VoiceControls } from "../src/VoiceControls";
import {
  VoiceSessionProvider,
  VoiceSessionStatus,
  useVoiceSession,
} from "../src/VoiceSession";

let recorder: Recorder;
class Recorder {
  static isTypeSupported(type: string) {
    return type === "audio/webm;codecs=opus";
  }
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((value: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    recorder = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({
      data: new Blob(["synthetic fixture"], { type: this.mimeType }),
    });
    this.onstop?.();
  }
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(window, "sebby", {
    configurable: true,
    value: undefined,
  });
});
function fixture() {
  const stopTrack = vi.fn();
  const getMedia = vi.fn(async () => ({
    getTracks: () => [{ stop: stopTrack }],
  }));
  const api = {
    localVoiceStatus: vi.fn(async () => ({
      available: true,
      assetsReady: true,
      voices: [],
      inputLanguages: ["auto", "en", "es"],
    })),
    voiceStatus: vi.fn(async () => ({ configured: false, provider: "ollama" })),
    beginVoiceCapture: vi.fn(async () => ({ captureId: "local-capture" })),
    endVoiceCapture: vi.fn(async () => ({})),
    transcribeVoice: vi.fn(async () => ({
      status: "completed",
      text: "Hola Sebby",
    })),
    cancelVoice: vi.fn(async () => ({})),
    cancelLocalSpeech: vi.fn(async () => ({})),
  };
  Object.defineProperty(window, "sebby", { configurable: true, value: api });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: getMedia },
  });
  Object.defineProperty(Blob.prototype, "arrayBuffer", {
    configurable: true,
    value: async () => new Uint8Array([1, 2, 3]).buffer,
  });
  vi.stubGlobal("MediaRecorder", Recorder);
  return { api, stopTrack, getMedia };
}
async function ready() {
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Start recording",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
}
function StopChat({ stop }: { stop: () => void }) {
  const session = useVoiceSession();
  useEffect(() => session.registerChat(stop), [session.registerChat, stop]);
  return null;
}

it("local recognition works with an Ollama profile and binds independently selected input language", async () => {
  const { api, getMedia, stopTrack } = fixture(),
    transcript = vi.fn();
  render(
    <VoiceSessionProvider>
      <VoiceControls report={vi.fn()} onTranscript={transcript} />
    </VoiceSessionProvider>,
  );
  await ready();
  expect(api.voiceStatus).not.toHaveBeenCalled();
  expect(api.beginVoiceCapture).not.toHaveBeenCalled();
  const unsupported = screen.getByRole("option", {
    name: "Japanese",
  }) as HTMLOptionElement;
  expect(unsupported.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Input speech language"), {
    target: { value: "es" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
  await screen.findByText("Listening · microphone active");
  expect(api.beginVoiceCapture).toHaveBeenCalledWith({
    provider: "local",
    model: "whisper-small",
    language: "es",
  });
  expect(getMedia).toHaveBeenCalledWith({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
  fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
  await screen.findByRole("button", { name: "Transcribe recording" });
  expect(stopTrack).toHaveBeenCalledOnce();
  expect(api.transcribeVoice).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Transcribe recording" }));
  await waitFor(() => expect(transcript).toHaveBeenCalledWith("Hola Sebby"));
  expect(api.cancelVoice).toHaveBeenCalledWith("local-capture");
});

it("conversation transcription is opt-in and calls only its reviewed conversation callback", async () => {
  const { api } = fixture(),
    draft = vi.fn(),
    conversation = vi.fn();
  render(
    <VoiceSessionProvider>
      <VoiceControls
        report={vi.fn()}
        onTranscript={draft}
        onConversationTranscript={conversation}
      />
    </VoiceSessionProvider>,
  );
  await ready();
  const checkbox = screen.getByRole("checkbox", {
    name: /Conversation mode for this session/,
  }) as HTMLInputElement;
  expect(checkbox.checked).toBe(false);
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
  await screen.findByText("Listening · microphone active");
  fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
  await waitFor(() => expect(conversation).toHaveBeenCalledWith("Hola Sebby"));
  expect(api.transcribeVoice).toHaveBeenCalledOnce();
  expect(draft).not.toHaveBeenCalled();
  expect(screen.getByText(/Native approval is still required/)).toBeTruthy();
  expect(
    (
      screen.getByRole("button", {
        name: "Start recording",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});

it("press-to-talk cancels owned chat before permission waits; stopped late grant cannot open the mic", async () => {
  const { api, getMedia } = fixture(),
    stopChat = vi.fn();
  let grant!: (value: { captureId: string }) => void;
  api.beginVoiceCapture.mockImplementationOnce(
    () => new Promise((resolve) => (grant = resolve)),
  );
  render(
    <VoiceSessionProvider>
      <StopChat stop={stopChat} />
      <VoiceSessionStatus />
      <VoiceControls report={vi.fn()} onTranscript={vi.fn()} />
    </VoiceSessionProvider>,
  );
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
  expect(stopChat).toHaveBeenCalledOnce();
  expect(api.cancelLocalSpeech).toHaveBeenCalled();
  await waitFor(() => expect(api.beginVoiceCapture).toHaveBeenCalledOnce());
  expect(getMedia).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Stop voice activity" }));
  await act(async () => grant({ captureId: "late-capture" }));
  expect(getMedia).not.toHaveBeenCalled();
  expect(api.cancelVoice).toHaveBeenCalledWith("late-capture");
});

it("unavailable local assets do not fall back to cloud or enable microphone capture", async () => {
  const { api, getMedia } = fixture();
  api.localVoiceStatus.mockResolvedValueOnce({
    available: false,
    assetsReady: false,
    voices: [],
    inputLanguages: [],
  });
  render(
    <VoiceSessionProvider>
      <VoiceControls report={vi.fn()} onTranscript={vi.fn()} />
    </VoiceSessionProvider>,
  );
  await screen.findByText(/Start the local voice service/);
  expect(
    (
      screen.getByRole("button", {
        name: "Start recording",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(api.voiceStatus).not.toHaveBeenCalled();
  expect(api.beginVoiceCapture).not.toHaveBeenCalled();
  expect(getMedia).not.toHaveBeenCalled();
});

it("interrupted local transcription cannot insert a late draft or conversation request", async () => {
  const { api } = fixture(),
    draft = vi.fn(),
    conversation = vi.fn();
  let finish!: (value: { status: string; text: string }) => void;
  api.transcribeVoice.mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  );
  render(
    <VoiceSessionProvider>
      <VoiceSessionStatus />
      <VoiceControls
        report={vi.fn()}
        onTranscript={draft}
        onConversationTranscript={conversation}
      />
    </VoiceSessionProvider>,
  );
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
  await screen.findByText("Listening · microphone active");
  fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
  await screen.findByRole("button", { name: "Transcribe recording" });
  fireEvent.click(screen.getByRole("button", { name: "Transcribe recording" }));
  await screen.findByRole("button", { name: "Cancel transcription" });
  fireEvent.click(screen.getByRole("button", { name: "Stop voice activity" }));
  await act(async () =>
    finish({ status: "completed", text: "Stale recognition" }),
  );
  expect(draft).not.toHaveBeenCalled();
  expect(conversation).not.toHaveBeenCalled();
});
