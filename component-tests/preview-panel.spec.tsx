import { afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { PreviewPanel } from "../src/PreviewPanel";
function setup() {
  const api = {
    previewStatus: vi.fn(async () => ({
      status: "closed",
      path: undefined as string | undefined,
      hash: undefined as string | undefined,
    })),
    openPreview: vi.fn(async (_input: { path: string }) => ({})),
    closePreview: vi.fn(async () => ({})),
  };
  Object.defineProperty(window, "sebby", { configurable: true, value: api });
  return api;
}
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "sebby", {
    configurable: true,
    value: undefined,
  });
});
it("desktop-only and never opens or queries on mount", () => {
  const api = setup();
  render(<PreviewPanel report={vi.fn()} />);
  expect(api.openPreview).not.toHaveBeenCalled();
  expect(api.previewStatus).not.toHaveBeenCalled();
  expect(
    screen
      .getByRole("button", { name: "Open static preview" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
it("missing bridge leaves safe unavailable controls", () => {
  render(<PreviewPanel report={vi.fn()} />);
  expect(screen.getByText("Preview requires the desktop app.")).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Refresh preview status" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
it("rejects absolute, traversal, URL and non-HTML paths before IPC", () => {
  const api = setup();
  render(<PreviewPanel report={vi.fn()} />);
  for (const path of [
    "../x.html",
    "/x.html",
    "C:\\x.html",
    "https://x/a.html",
    "x.html?x=1",
    "a/../b.html",
    "x.js",
  ]) {
    fireEvent.change(screen.getByLabelText("Relative HTML path"), {
      target: { value: path },
    });
    expect(
      screen
        .getByRole("button", { name: "Open static preview" })
        .hasAttribute("disabled"),
    ).toBe(true);
  }
  expect(api.openPreview).not.toHaveBeenCalled();
});
it("explicit open uses path only and displays status as safe text, not HTML", async () => {
  const api = setup();
  api.previewStatus.mockResolvedValue({
    status: "open",
    path: "<img src=x onerror=alert(1)>.html",
    hash: "abc123",
  });
  render(<PreviewPanel report={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Relative HTML path"), {
    target: { value: "demo/index.html" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open static preview" }));
  await screen.findByText("Preview: open");
  expect(api.openPreview).toHaveBeenCalledWith({ path: "demo/index.html" });
  expect(document.querySelector("img")).toBeNull();
  expect(screen.getByText(/<img src=x/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
  await waitFor(() => expect(api.closePreview).toHaveBeenCalledOnce());
});
it("declined open never claims success and errors are generic", async () => {
  const api = setup();
  const report = vi.fn();
  render(<PreviewPanel report={report} />);
  fireEvent.change(screen.getByLabelText("Relative HTML path"), {
    target: { value: "index.html" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open static preview" }));
  await screen.findByText(/Preview was not opened/);
  api.previewStatus.mockRejectedValueOnce(Error("sensitive internal path"));
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh preview status" }),
  );
  await waitFor(() =>
    expect(report).toHaveBeenCalledWith(
      "Preview action failed. No automatic retry.",
    ),
  );
  expect(screen.queryByText(/sensitive internal path/)).toBeNull();
});

it("clearly discloses static-only limitations", () => {
  setup();
  render(<PreviewPanel report={vi.fn()} />);
  expect(
    screen.getByRole("heading", { name: "Static HTML/CSS preview" }),
  ).toBeTruthy();
  expect(screen.getByText(/JavaScript is disabled/)).toBeTruthy();
  expect(
    screen.getByText(/not evidence of a successful app build or test/),
  ).toBeTruthy();
});
