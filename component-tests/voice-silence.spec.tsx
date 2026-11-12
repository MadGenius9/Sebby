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
import { VoiceSessionProvider } from "../src/VoiceSession";

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(window, "sebby", {
    configurable: true,
    value: undefined,
  });
});

function fixture() {
  const trackStop = vi.fn(),
    close = vi.fn(async () => {}),
    sampleRead = vi.fn();
  let level = 0;
  const analyser = {
    fftSize: 512,
    getFloatTimeDomainData: (buffer: Float32Array) => {
      sampleRead();
      buffer.fill(level);
    },
  };
  class Context {
    close = close;
    resume = vi.fn(async () => {});
    createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
    createAnalyser = vi.fn(() => analyser);
  }
  const stopRecording = vi.fn();
  class Recorder {
    static isTypeSupported() {
      return true;
    }
    state = "inactive";
    mimeType = "audio/webm";
    ondataavailable: ((value: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() {
      this.state = "recording";
    }
    stop() {
      stopRecording();
      this.state = "inactive";
      this.ondataavailable?.({
        data: new Blob(["synthetic speech fixture"], { type: this.mimeType }),
      });
      this.onstop?.();
    }
  }
  const api = {
    localVoiceStatus: vi.fn(async () => ({
      available: true,
      assetsReady: true,
      voices: [],
      inputLanguages: ["auto", "en"],
    })),
    voiceStatus: vi.fn(async () => ({ configured: false, provider: "ollama" })),
    beginVoiceCapture: vi.fn(async () => ({ captureId: "silence-fixture" })),
    endVoiceCapture: vi.fn(async () => ({})),
    transcribeVoice: vi.fn(async () => ({
      status: "completed",
      text: "Synthetic spoken turn",
    })),
    cancelVoice: vi.fn(async () => ({})),
    cancelLocalSpeech: vi.fn(async () => ({})),
  };
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal("MediaRecorder", Recorder);
  Object.defineProperty(window, "sebby", { configurable: true, value: api });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: trackStop }],
      })),
    },
  });
  Object.defineProperty(Blob.prototype, "arrayBuffer", {
    configurable: true,
    value: async () => new Uint8Array([1, 2, 3]).buffer,
  });
  const conversation = vi.fn();
  const view = render(
    <VoiceSessionProvider>
      <VoiceControls
        report={vi.fn()}
        onTranscript={vi.fn()}
        onConversationTranscript={conversation}
      />
    </VoiceSessionProvider>,
  );
  return {
    api,
    conversation,
    close,
    sampleRead,
    trackStop,
    stopRecording,
    setLevel: (value: number) => {
      level = value;
    },
    ...view,
  };
}
async function start(f: ReturnType<typeof fixture>, conversational = true) {
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Start recording",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  if (conversational)
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Conversation mode for this session/,
      }),
    );
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
  await act(async () => {});
  expect(screen.getByText("Listening · microphone active")).toBeTruthy();
  expect(f.api.beginVoiceCapture).toHaveBeenCalledOnce();
}
async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

it("conversation mode waits for audible input then ends after sustained silence and transcribes once", async () => {
  const f = fixture();
  await start(f);
  await advance(3000);
  expect(f.stopRecording).not.toHaveBeenCalled();
  expect(f.api.transcribeVoice).not.toHaveBeenCalled();
  f.setLevel(0.05);
  await advance(500);
  f.setLevel(0);
  await advance(1000);
  expect(f.stopRecording).not.toHaveBeenCalled();
  await advance(400);
  expect(f.stopRecording).toHaveBeenCalledOnce();
  expect(f.close).toHaveBeenCalledOnce();
  expect(f.trackStop).toHaveBeenCalledOnce();
  expect(f.api.transcribeVoice).toHaveBeenCalledOnce();
  expect(f.conversation).toHaveBeenCalledWith("Synthetic spoken turn");
  const reads = f.sampleRead.mock.calls.length;
  await advance(10000);
  expect(f.sampleRead).toHaveBeenCalledTimes(reads);
  expect(f.api.beginVoiceCapture).toHaveBeenCalledOnce();
});

it("initial silence never triggers the speech-pause detector and unmount releases it without a request", async () => {
  const f = fixture();
  await start(f);
  await advance(10000);
  expect(f.stopRecording).not.toHaveBeenCalled();
  expect(f.api.transcribeVoice).not.toHaveBeenCalled();
  expect(f.conversation).not.toHaveBeenCalled();
  f.unmount();
  expect(f.close).toHaveBeenCalledOnce();
  expect(f.trackStop).toHaveBeenCalledOnce();
  const reads = f.sampleRead.mock.calls.length;
  await advance(70000);
  expect(f.sampleRead).toHaveBeenCalledTimes(reads);
  expect(f.api.transcribeVoice).not.toHaveBeenCalled();
});

it("manual Stop clears pause detection before transcription and cannot queue a second recognition", async () => {
  const f = fixture();
  await start(f);
  f.setLevel(0.05);
  await advance(300);
  fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
  await act(async () => {});
  expect(f.api.transcribeVoice).toHaveBeenCalledOnce();
  expect(f.close).toHaveBeenCalledOnce();
  expect(f.trackStop).toHaveBeenCalledOnce();
  const reads = f.sampleRead.mock.calls.length;
  await advance(70000);
  expect(f.sampleRead).toHaveBeenCalledTimes(reads);
  expect(f.stopRecording).toHaveBeenCalledOnce();
  expect(f.api.transcribeVoice).toHaveBeenCalledOnce();
});

it("draft mode never starts automatic pause detection or automatic transcription", async () => {
  const f = fixture();
  await start(f, false);
  f.setLevel(0.1);
  await advance(500);
  f.setLevel(0);
  await advance(3000);
  expect(f.sampleRead).not.toHaveBeenCalled();
  expect(f.close).not.toHaveBeenCalled();
  expect(f.stopRecording).not.toHaveBeenCalled();
  expect(f.api.transcribeVoice).not.toHaveBeenCalled();
});
