import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { HandsFreeVoice } from "../src/HandsFreeVoice";
import {
  VoiceSessionProvider,
  VoiceSessionStatus,
  useVoiceSession,
} from "../src/VoiceSession";
import { TurnDetector, wakeTurn } from "../src/handsFree";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  Object.defineProperty(window, "sebby", {
    configurable: true,
    value: undefined,
  });
});
it("requires an anchored wake phrase, handles proper-name ASR spelling and bounded commands", () => {
  expect(wakeTurn("background hello sebby", false).kind).toBe("ignore");
  expect(wakeTurn("hello somebody", false).kind).toBe("ignore");
  expect(wakeTurn("Hello, Sebby", false).kind).toBe("turn");
  expect(wakeTurn("Hello Sebi, what time is it?", false)).toEqual({
    kind: "turn",
    text: "what time is it?",
  });
  expect(wakeTurn("Hello Sebby", false).kind).toBe("turn");
  expect(wakeTurn("stop listening", true).kind).toBe("disable");
  expect(wakeTurn("go to sleep", true).kind).toBe("sleep");
  expect(wakeTurn("cancel", true).kind).toBe("interrupt");
  expect(wakeTurn("follow up", true).kind).toBe("turn");
});
it("requires sustained speech, finishes after silence and bounds silent/speaking segments", () => {
  const d = new TurnDetector();
  d.reset(0);
  expect(d.sample(0.1, 100).interrupt).toBe(false);
  expect(d.sample(0.1, 200).interrupt).toBe(false);
  expect(d.sample(0.1, 300).interrupt).toBe(true);
  expect(d.sample(0, 1100).finish).toBe(false);
  expect(d.sample(0, 1300).finish).toBe(true);
  d.reset(0);
  expect(d.sample(0, 4100).finish).toBe(true);
  d.reset(0);
  d.sample(0.1, 1);
  d.sample(0.1, 2);
  d.sample(0.1, 3);
  expect(d.sample(0.1, 15100).finish).toBe(true);
});
function fixture({ pending = false } = {}) {
  vi.useFakeTimers();
  let level = 0;
  const track = { stop: vi.fn(), onended: null as null | (() => void) };
  const close = vi.fn(async () => {});
  const recordings: any[] = [];
  class Recorder {
    static isTypeSupported() {
      return true;
    }
    state = "inactive";
    onstop: any;
    ondataavailable: any;
    onerror: any;
    constructor() {
      recordings.push(this);
    }
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["fixture"]) });
      this.onstop?.();
    }
  }
  class Context {
    close = close;
    resume = async () => {};
    createAnalyser() {
      return {
        fftSize: 512,
        getFloatTimeDomainData: (b: Float32Array) => b.fill(level),
      };
    }
    createMediaStreamSource() {
      return { connect: () => {} };
    }
  }
  let resolve!: (v: { status: string; sessionId: string }) => void;
  const api = {
    beginHandsFreeChat: vi.fn(() =>
      pending
        ? new Promise<{ status: string; sessionId: string }>(
            (r) => (resolve = r),
          )
        : Promise.resolve({ status: "ready", sessionId: "chat" }),
    ),
    endHandsFreeChat: vi.fn(async () => {}),
    startHandsFree: vi.fn(async () => ({ sessionId: "voice" })),
    stopHandsFree: vi.fn(async () => {}),
    transcribeHandsFree: vi.fn(async () => ({
      status: "completed",
      text: "Hello Sebby, tell me a joke",
    })),
    cancelLocalSpeech: vi.fn(async () => {}),
  };
  Object.defineProperty(window, "sebby", { configurable: true, value: api });
  localStorage.setItem(
    "sebby.voice.preferences.v1",
    JSON.stringify({ provider: "neural", voice: "af_heart", speed: 1 }),
  );
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal("AudioContext", Context);
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  Object.defineProperty(Blob.prototype, "arrayBuffer", {
    configurable: true,
    value: async () => new Uint8Array([1, 2, 3]).buffer,
  });
  const turn = vi.fn(async () => true),
    interrupt = vi.fn(async () => {}),
    active = vi.fn();
  const view = render(
    <VoiceSessionProvider>
      <MarkReading />
      <VoiceSessionStatus />
      <HandsFreeVoice
        language="en"
        blocked={false}
        onTurn={turn}
        onInterrupt={interrupt}
        onActive={active}
      />
    </VoiceSessionProvider>,
  );
  return {
    ...view,
    api,
    track,
    close,
    getUserMedia,
    turn,
    interrupt,
    active,
    recordings,
    setLevel: (n: number) => (level = n),
    resolve: (v: { status: string; sessionId: string }) => resolve(v),
  };
}
function MarkReading() {
  const session = useVoiceSession();
  return (
    <button onClick={() => session.setSpeech("reading")}>
      Mark speech reading
    </button>
  );
}
async function enable() {
  fireEvent.click(screen.getByRole("checkbox"));
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Enable hands-free listening" }),
    );
  });
}
async function tick(n: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(n);
  });
}
it("is off by default and requires opt-in before any device request", async () => {
  const f = fixture();
  expect(f.getUserMedia).not.toHaveBeenCalled();
  expect(
    (
      screen.getByRole("button", {
        name: "Enable hands-free listening",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await enable();
  expect(f.getUserMedia).toHaveBeenCalledOnce();
  expect(screen.getByText(/MICROPHONE ACTIVE/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Disable hands-free and release microphone",
    }),
  );
  expect(f.track.stop).toHaveBeenCalledOnce();
  expect(f.api.stopHandsFree).toHaveBeenCalledWith("voice");
  expect(f.api.endHandsFreeChat).toHaveBeenCalledWith("chat");
});
it("rearms without requesting the microphone again, ignores silence, and sends a wake turn locally", async () => {
  const f = fixture();
  await enable();
  await tick(4500);
  expect(f.api.transcribeHandsFree).not.toHaveBeenCalled();
  f.setLevel(0.1);
  await tick(400);
  f.setLevel(0);
  await tick(1400);
  expect(f.api.transcribeHandsFree).toHaveBeenCalledOnce();
  expect(f.turn).toHaveBeenCalledWith("tell me a joke", "chat", "voice");
  expect(f.getUserMedia).toHaveBeenCalledOnce();
  expect(f.recordings.length).toBeGreaterThan(2);
  f.api.transcribeHandsFree.mockResolvedValueOnce({
    status: "completed",
    text: "and another one",
  });
  f.setLevel(0.1);
  await tick(400);
  f.setLevel(0);
  await tick(1400);
  expect(f.turn).toHaveBeenLastCalledWith("and another one", "chat", "voice");
});
it("global Stop releases continuous capture and unmount closes audio resources", async () => {
  const f = fixture();
  await enable();
  fireEvent.click(screen.getByRole("button", { name: "Stop voice activity" }));
  expect(f.track.stop).toHaveBeenCalledOnce();
  expect(f.close).toHaveBeenCalledOnce();
  f.unmount();
  expect(f.getUserMedia).toHaveBeenCalledOnce();
});
it("ignores late session approval after disabling and never opens the microphone", async () => {
  const f = fixture({ pending: true });
  await enable();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Disable hands-free and release microphone",
    }),
  );
  await act(async () => {
    f.resolve({ status: "ready", sessionId: "late" });
  });
  expect(f.api.endHandsFreeChat).toHaveBeenCalledWith("late");
  expect(f.getUserMedia).not.toHaveBeenCalled();
});
it("device loss releases the lease and never retries capture", async () => {
  const f = fixture();
  await enable();
  act(() => f.track.onended?.());
  expect(f.api.stopHandsFree).toHaveBeenCalledWith("voice");
  await tick(10000);
  expect(f.getUserMedia).toHaveBeenCalledOnce();
});
it("stops active playback on sustained speech before transcription finishes", async () => {
  const f = fixture();
  await enable();
  fireEvent.click(screen.getByRole("button", { name: "Mark speech reading" }));
  const previous = f.interrupt.mock.calls.length;
  f.setLevel(0.1);
  await tick(400);
  expect(f.interrupt.mock.calls.length).toBeGreaterThan(previous);
  expect(f.api.transcribeHandsFree).not.toHaveBeenCalled();
});
it("does not send ordinary background speech before waking", async () => {
  const f = fixture();
  f.api.transcribeHandsFree.mockResolvedValueOnce({
    status: "completed",
    text: "an unrelated background conversation",
  });
  await enable();
  f.setLevel(0.1);
  await tick(400);
  f.setLevel(0);
  await tick(1400);
  expect(f.turn).not.toHaveBeenCalled();
});
it("denied chat setup never asks for microphone permission", async () => {
  const f = fixture();
  f.api.beginHandsFreeChat.mockResolvedValueOnce({
    status: "denied",
    sessionId: "",
  });
  await enable();
  expect(f.api.startHandsFree).not.toHaveBeenCalled();
  expect(f.getUserMedia).not.toHaveBeenCalled();
});
it("suppresses late recognition after global Stop", async () => {
  const f = fixture();
  let resolve!: (v: { status: string; text: string }) => void;
  f.api.transcribeHandsFree.mockImplementationOnce(
    () => new Promise((r) => (resolve = r)),
  );
  await enable();
  f.setLevel(0.1);
  await tick(400);
  f.setLevel(0);
  await tick(1400);
  expect(f.api.transcribeHandsFree).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Stop voice activity" }));
  await act(async () =>
    resolve({ status: "completed", text: "Hello Sebby tell me a secret" }),
  );
  expect(f.turn).not.toHaveBeenCalled();
});
it("retries only an explicitly busy local speech engine and sends the turn once", async () => {
  const f = fixture();
  f.api.transcribeHandsFree.mockResolvedValueOnce({
    status: "error",
    text: "",
    code: "LOCAL_VOICE_BUSY",
  } as any);
  await enable();
  f.setLevel(0.1);
  await tick(400);
  f.setLevel(0);
  await tick(2200);
  expect(f.api.transcribeHandsFree).toHaveBeenCalledTimes(2);
  expect(f.turn).toHaveBeenCalledOnce();
});
it("Stop during a busy-engine wait prevents another recognition request", async () => {
  const f = fixture();
  f.api.transcribeHandsFree.mockResolvedValue({
    status: "error",
    text: "",
    code: "LOCAL_VOICE_BUSY",
  } as any);
  await enable();
  f.setLevel(0.1);
  await tick(400);
  f.setLevel(0);
  await tick(1100);
  expect(f.api.transcribeHandsFree).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Stop voice activity" }));
  await tick(2500);
  expect(f.api.transcribeHandsFree).toHaveBeenCalledOnce();
  expect(f.turn).not.toHaveBeenCalled();
});
it("busy-engine wait has a hard cap and never retries the model", async () => {
  const f = fixture();
  f.api.transcribeHandsFree.mockResolvedValue({
    status: "error",
    text: "",
    code: "LOCAL_VOICE_BUSY",
  } as any);
  await enable();
  f.setLevel(0.1);
  await tick(400);
  f.setLevel(0);
  await tick(12500);
  expect(f.api.transcribeHandsFree).toHaveBeenCalledTimes(21);
  expect(f.turn).not.toHaveBeenCalled();
  expect(f.track.stop).toHaveBeenCalledOnce();
});
