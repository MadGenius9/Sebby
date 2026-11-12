import { afterEach, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { SpeechButton } from "../src/SpeechButton";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function fixture(local: boolean) {
  const speak = vi.fn(),
    cancel = vi.fn();
  class Utterance {
    voice: unknown;
    lang = "";
    onend: unknown;
    onerror: unknown;
    constructor(public text: string) {}
  }
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("speechSynthesis", {
    speak,
    cancel,
    getVoices: () => [{ localService: local, lang: "en-US" }],
  });
  return { speak, cancel };
}
it("reads only actual text after explicit click and stops on unmount", () => {
  const f = fixture(true),
    view = render(
      <SpeechButton text="Actual response, not a generated voice sample." />,
    );
  expect(f.speak).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button"));
  expect(f.speak.mock.calls[0][0].text).toBe(
    "Actual response, not a generated voice sample.",
  );
  expect(screen.getByRole("button").textContent).toBe("Stop reading");
  view.unmount();
  expect(f.cancel).toHaveBeenCalledTimes(2);
});
it("refuses remote voice substitution and excessive text", () => {
  const f = fixture(false);
  const view = render(<SpeechButton text="Hello" />);
  fireEvent.click(screen.getByRole("button"));
  expect(f.speak).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toContain(
    "Remote voices are not used",
  );
  view.rerender(<SpeechButton text={"x".repeat(6001)} />);
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
});

it("selects a device-local voice for the requested language", () => {
  const f = fixture(true);
  vi.stubGlobal("speechSynthesis", {
    speak: f.speak,
    cancel: f.cancel,
    getVoices: () => [
      { localService: true, lang: "en-US" },
      { localService: true, lang: "es-MX" },
    ],
  });
  render(<SpeechButton text="Hola Chuck" language="es" />);
  fireEvent.click(screen.getByRole("button"));
  expect(f.speak.mock.calls[0][0].lang).toBe("es-MX");
});
