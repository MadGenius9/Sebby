import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  localStorage.clear();
  Object.defineProperty(window, "sebby", {
    configurable: true,
    value: undefined,
  });
});

async function fixture() {
  const module = await import("../src/localSpeech");
  const instances: FakeAudio[] = [];
  class FakeAudio {
    onplaying: (() => void) | null = null;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    pause = vi.fn();
    removeAttribute = vi.fn();
    load = vi.fn();
    play = vi.fn(async () => this.onplaying?.());
    constructor(public src: string) {
      instances.push(this);
    }
  }
  vi.stubGlobal("Audio", FakeAudio);
  const create = vi.fn(() => "blob:synthetic-local-audio");
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    Object.assign(class extends URL {}, {
      createObjectURL: create,
      revokeObjectURL: revoke,
    }),
  );
  const api = {
    cancelLocalSpeech: vi.fn(async () => ({})),
    synthesizeLocalSpeech: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
  Object.defineProperty(window, "sebby", { configurable: true, value: api });
  return { ...module, instances, create, revoke, api };
}

it("stop while initial cancellation awaits IPC prevents a stale synthesis from starting", async () => {
  const f = await fixture();
  let release!: (value: object) => void;
  f.api.cancelLocalSpeech.mockImplementationOnce(
    () => new Promise((resolve) => (release = resolve)),
  );
  f.api.synthesizeLocalSpeech.mockRejectedValue(Error("Should not dispatch"));
  const pending = f.speakNeuralText("Do not speak after Stop.", "en", vi.fn());
  await f.stopNeuralSpeech();
  release({});
  await pending.catch(() => {});
  expect(f.api.synthesizeLocalSpeech).not.toHaveBeenCalled();
  expect(f.create).not.toHaveBeenCalled();
});

it("interrupting playback pauses immediately, revokes audio and never requests the next chunk", async () => {
  const f = await fixture();
  const report = vi.fn();
  const pending = f.speakNeuralText(
    "A complete short sentence. ".repeat(45),
    "en",
    report,
  );
  await vi.waitFor(() => expect(f.instances.length).toBe(1));
  expect(report).toHaveBeenCalledWith("reading");
  const stopped = f.stopNeuralSpeech();
  expect(f.instances[0].pause).toHaveBeenCalledOnce();
  expect(f.revoke).toHaveBeenCalledWith("blob:synthetic-local-audio");
  await stopped;
  await pending;
  expect(f.api.synthesizeLocalSpeech).toHaveBeenCalledOnce();
});

it("late synthesis after interruption never creates or plays an audio element", async () => {
  const f = await fixture();
  let release!: (value: Uint8Array) => void;
  f.api.synthesizeLocalSpeech.mockImplementationOnce(
    () => new Promise((resolve) => (release = resolve)),
  );
  const pending = f.speakNeuralText("Late response.", "en", vi.fn());
  await vi.waitFor(() =>
    expect(f.api.synthesizeLocalSpeech).toHaveBeenCalledOnce(),
  );
  await f.stopNeuralSpeech();
  release(new Uint8Array([1, 2, 3]));
  await pending;
  expect(f.create).not.toHaveBeenCalled();
  expect(f.instances.length).toBe(0);
});

it("output device errors release the Blob URL and reject without claiming playback finished", async () => {
  const f = await fixture();
  const report = vi.fn();
  const pending = f.speakNeuralText("A sample response.", "en", report);
  const rejected = expect(pending).rejects.toThrow("Audio output failed");
  await vi.waitFor(() => expect(f.instances.length).toBe(1));
  f.instances[0].onerror?.();
  await rejected;
  expect(f.revoke).toHaveBeenCalledOnce();
  expect(report).not.toHaveBeenCalledWith("idle");
});

it("pacing chunks omit fenced code and links and stay within backend text bounds", async () => {
  const { speechChunks } = await fixture();
  const chunks = speechChunks(
    "Opening. ```secret code``` https://example.invalid/path " +
      "longword".repeat(150),
  );
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 550)).toBe(
    true,
  );
  expect(chunks.join(" ")).not.toContain("secret code");
  expect(chunks.join(" ")).not.toContain("https://");
});
