import { afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { VoiceControls } from "../src/VoiceControls";
let stopped = vi.fn();
let instance: FakeRecorder;
class FakeRecorder {
  static isTypeSupported() {
    return true;
  }
  state = "inactive";
  mimeType = "audio/webm";
  onstop: (() => void) | null = null;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    instance = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({
      data: new Blob(["audio"], { type: "audio/webm" }),
    });
    this.onstop?.();
  }
}
function setup() {
  const api = {
    voiceStatus: vi.fn(async () => ({ configured: true, provider: "openai" })),
    beginVoiceCapture: vi.fn(async () => ({ captureId: "capture" })),
    endVoiceCapture: vi.fn(async () => ({ ended: true })),
    transcribeVoice: vi.fn(async () => ({
      status: "completed",
      text: "My transcript",
    })),
    cancelVoice: vi.fn(async () => ({ cancelled: true })),
  };
  Object.defineProperty(window, "sebby", { configurable: true, value: api });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: stopped }],
      })),
    },
  });
  return api;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(window, "sebby", {
    configurable: true,
    value: undefined,
  });
  stopped = vi.fn();
});
it("requires desktop configured OpenAI and explicit audio model; no automatic recording", async () => {
  const api = setup();
  render(<VoiceControls report={vi.fn()} onTranscript={vi.fn()} />);
  await waitFor(() => expect(api.voiceStatus).toHaveBeenCalled());
  expect(
    screen
      .getByRole("button", { name: "Start recording" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(api.beginVoiceCapture).not.toHaveBeenCalled();
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
});
it("stop releases all tracks, separate transcription action only produces draft", async () => {
  const api = setup();
  const transcript = vi.fn();
  render(<VoiceControls report={vi.fn()} onTranscript={transcript} />);
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
  expect(api.beginVoiceCapture).toHaveBeenCalledWith({
    model: "gpt-transcribe",
  });
  fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
  await screen.findByRole("button", { name: "Transcribe recording" });
  expect(stopped).toHaveBeenCalled();
  expect(api.endVoiceCapture).toHaveBeenCalledWith("capture");
  expect(api.transcribeVoice).not.toHaveBeenCalled();
  expect(transcript).not.toHaveBeenCalled();
});
it("unmount aborts session and releases microphone without upload", async () => {
  const api = setup();
  const view = render(
    <VoiceControls report={vi.fn()} onTranscript={vi.fn()} />,
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
  await screen.findByRole("button", { name: "Stop recording" });
  view.unmount();
  expect(stopped).toHaveBeenCalled();
  expect(api.cancelVoice).toHaveBeenCalledWith("capture");
  expect(api.transcribeVoice).not.toHaveBeenCalled();
});
it("oversize chunks discard locally, never upload", async () => {
  const api = setup();
  render(<VoiceControls report={vi.fn()} onTranscript={vi.fn()} />);
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
  act(() =>
    instance.ondataavailable?.({
      data: new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]),
    }),
  );
  expect(screen.getByText(/exceeded 5 MiB/)).toBeTruthy();
  expect(stopped).toHaveBeenCalled();
  expect(api.transcribeVoice).not.toHaveBeenCalled();
});
it("approved upload result inserts transcript only; denied result never inserts", async () => {
  const api = setup();
  const transcript = vi.fn();
  Object.defineProperty(Blob.prototype, "arrayBuffer", {
    configurable: true,
    value: async () => new Uint8Array([1, 2, 3]).buffer,
  });
  render(<VoiceControls report={vi.fn()} onTranscript={transcript} />);
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
  fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
  await screen.findByRole("button", { name: "Transcribe recording" });
  api.transcribeVoice.mockResolvedValueOnce({ status: "denied", text: "" });
  fireEvent.click(screen.getByRole("button", { name: "Transcribe recording" }));
  await screen.findByText(/Upload declined/);
  expect(transcript).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Transcribe recording" }));
  await waitFor(() => expect(transcript).toHaveBeenCalledWith("My transcript"));
  expect(screen.getByText(/Review before sending/)).toBeTruthy();
});
