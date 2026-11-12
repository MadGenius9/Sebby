import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { EvidenceWorkflowPanel } from "../src/EvidenceWorkflowPanel";

afterEach(() => {
  cleanup();
  delete window.sebby;
});
const proposal = {
  id: "proposal",
  source: { path: "target.html", sha256: "a".repeat(64), bytes: 123 },
  observations: {
    elements: { h1: 1 },
    headings: [{ tag: "h1", line: 1 }],
    scripts: 1,
    resourceReferences: 1,
  },
  blueprint: {
    name: "Original static study",
    recipe: "original-static-v1",
    sectionCount: 1,
    explanation: "Use a fixed original template, not target assets.",
  },
  limitations: ["Static HTML structure only."],
};
const artifact = {
  id: "build",
  directory: "scratch/build",
  path: "index.html",
  sha256: "b".repeat(64),
  tests: [{ name: "No script elements", passed: true }],
};
function fixture(overrides = {}) {
  const api = {
    prepareEvidence: vi.fn(async () => ({ status: "prepared", proposal })),
    buildEvidence: vi.fn(async () => ({ status: "built", artifact })),
    previewEvidence: vi.fn(async () => ({ status: "previewed" })),
    ...overrides,
  };
  window.sebby = api as unknown as NonNullable<Window["sebby"]>;
  const report = vi.fn();
  render(<EvidenceWorkflowPanel report={report} />);
  return { api, report };
}
async function prepare() {
  fireEvent.change(screen.getByLabelText("Authorized local HTML path"), {
    target: { value: "target.html" },
  });
  fireEvent.click(
    screen.getByLabelText("I own this target or have permission to analyze it"),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Inspect authorized HTML" }),
  );
  await screen.findByText("Observed evidence");
}

it("requires scoped authorization, then shows evidence, actual checks and explicit preview result", async () => {
  const { api } = fixture();
  expect(api.prepareEvidence).not.toHaveBeenCalled();
  expect(
    (
      screen.getByRole("button", {
        name: "Inspect authorized HTML",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await prepare();
  expect(api.prepareEvidence).toHaveBeenCalledWith({
    path: "target.html",
    authorized: true,
  });
  expect(api.buildEvidence).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Review and build static prototype" }),
  );
  await screen.findByText("Built artifact and actual checks");
  expect(api.buildEvidence).toHaveBeenCalledWith({ proposalId: "proposal" });
  expect(screen.getByText("PASS: No script elements")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Preview original static prototype" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain(
      "opened in a restricted",
    ),
  );
  expect(api.previewEvidence).toHaveBeenCalledWith({ buildId: "build" });
});

it("path changes clear reviewed state and require fresh authorization", async () => {
  fixture();
  await prepare();
  fireEvent.change(screen.getByLabelText("Authorized local HTML path"), {
    target: { value: "other.html" },
  });
  expect(screen.queryByText("Observed evidence")).toBeNull();
  expect(
    (
      screen.getByRole("button", {
        name: "Inspect authorized HTML",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

it("denied builds or errors never claim successful build and preview denial never claims open", async () => {
  const f = fixture({
    buildEvidence: vi.fn(async () => ({ status: "denied" })),
  });
  await prepare();
  fireEvent.click(
    screen.getByRole("button", { name: "Review and build static prototype" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("not approved"),
  );
  expect(screen.queryByText("Built artifact and actual checks")).toBeNull();
  f.api.buildEvidence.mockRejectedValueOnce(Error("Source changed"));
  fireEvent.click(
    screen.getByRole("button", { name: "Review and build static prototype" }),
  );
  await waitFor(() => expect(f.report).toHaveBeenCalledWith("Source changed"));
});

it("reports browser preview limitation and rejects external URLs without dispatch", () => {
  render(<EvidenceWorkflowPanel report={vi.fn()} />);
  expect(
    screen.getByText("Evidence inspection and build require the desktop app."),
  ).toBeTruthy();
  cleanup();
  const { api } = fixture();
  fireEvent.change(screen.getByLabelText("Authorized local HTML path"), {
    target: { value: "https://example.com" },
  });
  fireEvent.click(
    screen.getByLabelText("I own this target or have permission to analyze it"),
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Inspect authorized HTML",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(api.prepareEvidence).not.toHaveBeenCalled();
});
