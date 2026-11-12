import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { LocalVoiceSettings } from "../src/LocalVoiceSettings";
import { VoiceSessionProvider } from "../src/VoiceSession";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  Object.defineProperty(window, "sebby", {
    configurable: true,
    value: undefined,
  });
});
function fixture(language = "en") {
  localStorage.setItem(
    "sebby.voice.preferences.v1",
    JSON.stringify({ provider: "neural", voice: "af_heart", speed: 1 }),
  );
  const api = {
    localVoiceStatus: vi.fn(async () => ({
      available: true,
      assetsReady: true,
      voices: [{ id: "af_heart", name: "Heart", language: "en" }],
      inputLanguages: ["en"],
    })),
    cancelLocalSpeech: vi.fn(async () => ({})),
    synthesizeLocalSpeech: vi.fn<() => Promise<Uint8Array>>(),
  };
  const Audio = vi.fn();
  vi.stubGlobal("Audio", Audio);
  Object.defineProperty(window, "sebby", { configurable: true, value: api });
  const view = render(
    <VoiceSessionProvider>
      <LocalVoiceSettings language={language} />
    </VoiceSessionProvider>,
  );
  return { api, Audio, ...view };
}

it("unmount during pending voice preview prevents late audio playback", async () => {
  const f = fixture();
  let release!: (value: Uint8Array) => void;
  f.api.synthesizeLocalSpeech.mockImplementation(
    () => new Promise((resolve) => (release = resolve)),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Check local voice service" }),
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Preview selected voice",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Preview selected voice" }),
  );
  await waitFor(() =>
    expect(f.api.synthesizeLocalSpeech).toHaveBeenCalledOnce(),
  );
  f.unmount();
  await act(async () => release(new Uint8Array([1, 2, 3])));
  expect(f.Audio).not.toHaveBeenCalled();
  expect(f.api.cancelLocalSpeech).toHaveBeenCalled();
});

it("unsupported selected voice and output language is explicit and never requests a preview", async () => {
  const f = fixture("ja");
  fireEvent.click(
    screen.getByRole("button", { name: "Check local voice service" }),
  );
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toContain(
    "does not support reply language ja",
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Preview selected voice",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(f.api.synthesizeLocalSpeech).not.toHaveBeenCalled();
  expect(
    JSON.parse(localStorage.getItem("sebby.voice.preferences.v1")!).voice,
  ).toBe("af_heart");
});
