import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Blob as NodeBlob } from "node:buffer";
import { HandsFreeVoice } from "../src/HandsFreeVoice";
import { VoiceSessionProvider } from "../src/VoiceSession";

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

async function setup({
  deferredMedia = false,
  fakeClock = false,
  transcribe = async () => ({ status: "completed", text: "Hello Sebby" }),
} = {}) {
  let failTrack = false,
    failContext = false,
    failInterrupt = false;
  let resolveMedia: (stream: unknown) => void = () => {};
  let volume = 0;
  const stopOther = vi.fn();
  const tracks = [
    {
      onended: null,
      stop: vi.fn(() => {
        if (failTrack) throw Error("Audio driver no longer available");
      }),
    },
    { onended: null, stop: stopOther },
  ];
  const stream = { getTracks: () => tracks };
  const closeContext = vi.fn(() => {
    if (failContext) throw Error("AudioContext backend disappeared");
    return Promise.resolve();
  });
  const api = {
    beginHandsFreeChat: vi.fn(async () => ({
      status: "ready",
      sessionId: "chat-session",
    })),
    endHandsFreeChat: vi.fn(async () => ({})),
    startHandsFree: vi.fn(async () => ({ sessionId: "voice-session" })),
    stopHandsFree: vi.fn(async () => ({})),
    transcribeHandsFree: vi.fn(transcribe),
    cancelLocalSpeech: vi.fn(async () => ({})),
  };
  Object.defineProperty(window, "sebby", { configurable: true, value: api });
  localStorage.setItem(
    "sebby.voice.preferences.v1",
    JSON.stringify({ provider: "neural", voice: "af_heart", speed: 1 }),
  );
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(() =>
        deferredMedia
          ? new Promise((resolve) => {
              resolveMedia = resolve;
            })
          : Promise.resolve(stream),
      ),
    },
  });
  class Recorder {
    static isTypeSupported() {
      return true;
    }
    state = "inactive";
    onstop: (() => void) | null = null;
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
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
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal(
    "AudioContext",
    class {
      createAnalyser() {
        return {
          fftSize: 512,
          getFloatTimeDomainData: (samples: Float32Array) =>
            samples.fill(volume),
        };
      }
      createMediaStreamSource() {
        return { connect() {} };
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        return closeContext();
      }
    },
  );
  const onActive = vi.fn();
  const onInterrupt = vi.fn(() => {
    if (failInterrupt) throw Error("Chat cancellation backend disappeared");
    return Promise.resolve();
  });
  const onTurn = vi.fn(async () => true);
  const ui = render(
    <VoiceSessionProvider>
      <HandsFreeVoice
        language="en"
        blocked={false}
        onActive={onActive}
        onInterrupt={onInterrupt}
        onTurn={onTurn}
      />
    </VoiceSessionProvider>,
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I am using headphones/ }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Enable hands-free listening" }),
  );
  if (fakeClock) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.startHandsFree).toHaveBeenCalledOnce();
  } else await waitFor(() => expect(api.startHandsFree).toHaveBeenCalledOnce());
  if (!deferredMedia && !fakeClock)
    await screen.findByText(/Listening locally for Hello Sebby/);
  return {
    ui,
    api,
    tracks,
    stopOther,
    closeContext,
    onActive,
    onInterrupt,
    onTurn,
    setVolume: (value: number) => {
      volume = value;
    },
    setFailures: (value: {
      track?: boolean;
      context?: boolean;
      interrupt?: boolean;
    }) => {
      failTrack = value.track || false;
      failContext = value.context || false;
      failInterrupt = value.interrupt || false;
    },
    releaseMedia: () => resolveMedia(stream),
  };
}

it("revokes hands-free sessions and releases other tracks even when a device stop throws", async () => {
  const state = await setup();
  state.setFailures({ track: true });
  expect(() => state.ui.unmount()).not.toThrow();
  expect(state.stopOther).toHaveBeenCalled();
  expect(state.api.stopHandsFree).toHaveBeenCalledWith("voice-session");
  expect(state.api.endHandsFreeChat).toHaveBeenCalledWith("chat-session");
  expect(state.onActive).toHaveBeenLastCalledWith(false);
});

it("new speech after recognition drains is accepted immediately rather than discarded with the old busy segment", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("Blob", NodeBlob);
  let first: (value: { status: string; text: string }) => void = () => {};
  let calls = 0;
  const state = await setup({
    fakeClock: true,
    transcribe: () => {
      calls++;
      if (calls === 1)
        return new Promise((resolve) => {
          first = resolve;
        });
      return Promise.resolve({
        status: "completed",
        text: "Tell me more about that.",
      });
    },
  });
  state.setVolume(0.05);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  state.setVolume(0);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  expect(state.api.transcribeHandsFree).toHaveBeenCalledTimes(1);
  await act(async () => {
    first({ status: "completed", text: "Hello Sebby, what time is it?" });
  });
  expect(state.onTurn).toHaveBeenCalledTimes(1);
  state.setVolume(0.05);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  state.setVolume(0);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  expect(state.api.transcribeHandsFree).toHaveBeenCalledTimes(2);
  expect(state.onTurn).toHaveBeenCalledTimes(2);
});

it("a synchronous AudioContext close error cannot retain a native listening/chat grant", async () => {
  const state = await setup();
  state.setFailures({ context: true });
  expect(() => state.ui.unmount()).not.toThrow();
  expect(state.stopOther).toHaveBeenCalled();
  expect(state.api.stopHandsFree).toHaveBeenCalledWith("voice-session");
  expect(state.api.endHandsFreeChat).toHaveBeenCalledWith("chat-session");
  expect(state.onActive).toHaveBeenLastCalledWith(false);
});

it("chat cancellation failure cannot interrupt microphone/session cleanup", async () => {
  const state = await setup();
  state.setFailures({ interrupt: true });
  expect(() => state.ui.unmount()).not.toThrow();
  expect(state.stopOther).toHaveBeenCalled();
  expect(state.api.stopHandsFree).toHaveBeenCalledWith("voice-session");
  expect(state.onActive).toHaveBeenLastCalledWith(false);
});

it("a late microphone permission result after disabling is released and never starts recognition", async () => {
  const state = await setup({ deferredMedia: true });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Disable hands-free and release microphone",
    }),
  );
  state.releaseMedia();
  await waitFor(() => expect(state.stopOther).toHaveBeenCalled());
  expect(state.api.transcribeHandsFree).not.toHaveBeenCalled();
  expect(state.api.stopHandsFree).toHaveBeenCalledWith("voice-session");
  expect(screen.queryByText(/MICROPHONE ACTIVE/)).toBeNull();
});
