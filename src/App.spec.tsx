import { beforeEach, afterEach, describe, it, expect } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { App } from "./App";
beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);
function navigate(name: string) {
  fireEvent.click(
    within(screen.getByRole("navigation")).getByRole("button", { name }),
  );
}
describe("browser-preview honesty and real local interactions", () => {
  it("renders offline, disabled send, and selected Orbit", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "What shall we build?" });
    expect(
      (
        screen.getByRole("button", {
          name: "Send unavailable: AI not connected",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen
        .getByAltText("Sebby, your ice-blue Orbit companion")
        .getAttribute("src"),
    ).toBe("./orbit.png");
    expect(screen.getByText(/Browser preview/)).toBeTruthy();
  });
  it("adds actual skill instructions to a persistent draft", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "What shall we build?" });
    fireEvent.click(screen.getByRole("button", { name: "Plan an app" }));
    expect(
      (screen.getByLabelText("Your local chat draft") as HTMLTextAreaElement)
        .value,
    ).toContain("App planning playbook");
    await waitFor(() =>
      expect(localStorage.getItem("sebby.draft")).toContain(
        "App planning playbook",
      ),
    );
  });
  it("saves and reloads editable memory", async () => {
    const app = render(<App />);
    await screen.findByRole("heading", { name: "What shall we build?" });
    navigate("Memory");
    fireEvent.change(screen.getByLabelText("Your editable memory"), {
      target: { value: "Build a tiny app; never publish without approval." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save memory" }));
    await screen.findByRole("button", { name: "Saved" });
    app.unmount();
    render(<App />);
    await screen.findByRole("heading", { name: "What shall we build?" });
    navigate("Memory");
    expect(
      (screen.getByLabelText("Your editable memory") as HTMLTextAreaElement)
        .value,
    ).toContain("never publish");
  });
  it("persists personality without pretending it is generated", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "What shall we build?" });
    navigate("Personality");
    fireEvent.click(screen.getByLabelText("Direct", { exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Save personality" }));
    await screen.findByRole("button", { name: "Preferences saved" });
    expect(
      JSON.parse(localStorage.getItem("sebby.preview")!).personality.warmth,
    ).toBe("direct");
    expect(screen.getByText(/authored example, not AI/)).toBeTruthy();
  });
  it("does not fake file access, connectors, tasks, or reminders", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "What shall we build?" });
    fireEvent.click(screen.getByRole("button", { name: "Choose workspace" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain(
      "Browser preview cannot access your files",
    );
    navigate("Connections");
    expect(screen.getAllByText("Not connected", { exact: true })).toHaveLength(
      3,
    );
    navigate("Tasks");
    expect(
      screen.getByRole("heading", { name: "Available in the desktop app" }),
    ).toBeTruthy();
    navigate("Reminders");
    expect(
      screen.getByRole("heading", { name: "Available in the desktop app" }),
    ).toBeTruthy();
  });
});
