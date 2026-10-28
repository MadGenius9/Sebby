import { describe, it, expect, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import {
  AppearanceProvider,
  AppearancePanel,
  PalView,
  PALETTES,
  PAL_IDS,
  PAL_ASSETS,
} from "../src/Appearance";
afterEach(() => {
  cleanup();
  localStorage.clear();
  Object.defineProperty(window, "sebby", {
    configurable: true,
    value: undefined,
  });
  vi.restoreAllMocks();
});
describe("appearance controls", () => {
  it("retains original Orbit fallback and stores chosen real pal/palette in browser preview", async () => {
    Object.defineProperty(window, "sebby", {
      configurable: true,
      value: undefined,
    });
    render(
      <AppearanceProvider>
        <AppearancePanel report={vi.fn()} />
      </AppearanceProvider>,
    );
    const image = screen.getByAltText("Sebby, your ice-blue Orbit companion");
    expect(image.getAttribute("src")).toBe("./orbit.png");
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Save appearance",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("radio", { name: "Scout" }));
    fireEvent.change(screen.getByLabelText("Palette"), {
      target: { value: "mint" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save appearance" }));
    await screen.findByText("Appearance saved.");
    expect(
      screen.getByAltText("Sebby, your Scout companion").getAttribute("src"),
    ).toBe("./pals/scout.png");
    expect(
      JSON.parse(localStorage.getItem("sebby.appearance")!).colors,
    ).toEqual(PALETTES.mint);
  });
  it("color change selects custom and persists complete hex colors with motion disabled", async () => {
    Object.defineProperty(window, "sebby", {
      configurable: true,
      value: undefined,
    });
    render(
      <AppearanceProvider>
        <AppearancePanel report={vi.fn()} />
      </AppearanceProvider>,
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Body color") as HTMLInputElement).disabled,
      ).toBe(false),
    );
    fireEvent.change(screen.getByLabelText("Body color"), {
      target: { value: "#123456" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Gentle idle motion/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save appearance" }));
    await screen.findByText("Appearance saved.");
    const saved = JSON.parse(localStorage.getItem("sebby.appearance")!);
    expect(saved.palettePreset).toBe("custom");
    expect(saved.colors.body).toBe("#123456");
    expect(saved.motion).toBe(false);
  });
  it("uses desktop bridge and reports errors without silently writing browser storage", async () => {
    const report = vi.fn(),
      saveAppearance = vi.fn().mockRejectedValue(Error("Disk unavailable"));
    Object.defineProperty(window, "sebby", {
      configurable: true,
      value: {
        getAppearance: async () => ({
          pal: "wisp",
          palettePreset: "ice",
          colors: PALETTES.ice,
          motion: false,
        }),
        saveAppearance,
      },
    });
    render(
      <AppearanceProvider>
        <AppearancePanel report={report} />
      </AppearanceProvider>,
    );
    await screen.findByAltText("Sebby, your Wisp companion");
    fireEvent.click(screen.getByRole("button", { name: "Save appearance" }));
    await waitFor(() =>
      expect(report).toHaveBeenCalledWith("Disk unavailable"),
    );
    expect(localStorage.getItem("sebby.appearance")).toBeNull();
  });
  it("rejects corrupted browser data and does not overwrite it while showing safe original asset", async () => {
    Object.defineProperty(window, "sebby", {
      configurable: true,
      value: undefined,
    });
    localStorage.setItem(
      "sebby.appearance",
      JSON.stringify({ pal: "https://evil/model.glb" }),
    );
    render(
      <AppearanceProvider>
        <AppearancePanel report={vi.fn()} />
      </AppearanceProvider>,
    );
    await screen.findByRole("alert");
    expect(
      screen
        .getByAltText("Sebby, your ice-blue Orbit companion")
        .getAttribute("src"),
    ).toBe("./orbit.png");
    expect(localStorage.getItem("sebby.appearance")).toContain("https://evil");
  });
  it("PalView outside provider remains safe original static fallback", () => {
    render(<PalView />);
    expect(
      screen
        .getByAltText("Sebby, your ice-blue Orbit companion")
        .getAttribute("src"),
    ).toBe("./orbit.png");
    expect(document.querySelector("canvas")).toBeNull();
  });
});

describe("expanded bundled pal catalog", () => {
  it("exposes all nine choices, persists every ID, and uses its fixed local fallback", async () => {
    Object.defineProperty(window, "sebby", {
      configurable: true,
      value: undefined,
    });
    render(
      <AppearanceProvider>
        <AppearancePanel report={vi.fn()} />
      </AppearanceProvider>,
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Save appearance",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(screen.getAllByRole("radio").length).toBe(9);
    for (const pal of PAL_IDS) {
      fireEvent.click(
        screen.getByRole("radio", {
          name: pal[0].toUpperCase() + pal.slice(1),
        }),
      );
      expect(screen.getByAltText(PAL_ASSETS[pal].alt).getAttribute("src")).toBe(
        PAL_ASSETS[pal].png,
      );
      expect(PAL_ASSETS[pal].glb).toBe(`./pals/${pal}.glb`);
      fireEvent.click(screen.getByRole("button", { name: "Save appearance" }));
      await waitFor(() =>
        expect(JSON.parse(localStorage.getItem("sebby.appearance")!).pal).toBe(
          pal,
        ),
      );
    }
    expect(document.querySelector("canvas")).toBeNull();
  });
  it("rejects unknown pal IDs even with otherwise valid persisted settings", async () => {
    Object.defineProperty(window, "sebby", {
      configurable: true,
      value: undefined,
    });
    localStorage.setItem(
      "sebby.appearance",
      JSON.stringify({
        pal: "luma/../remote",
        palettePreset: "ice",
        colors: PALETTES.ice,
        motion: true,
      }),
    );
    render(
      <AppearanceProvider>
        <AppearancePanel report={vi.fn()} />
      </AppearanceProvider>,
    );
    await screen.findByRole("alert");
    expect(screen.getByAltText(PAL_ASSETS.orbit.alt).getAttribute("src")).toBe(
      "./orbit.png",
    );
    expect(localStorage.getItem("sebby.appearance")).toContain(
      "luma/../remote",
    );
  });
});
