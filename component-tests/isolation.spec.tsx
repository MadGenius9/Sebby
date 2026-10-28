import { afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { IsolationPanel } from "../src/IsolationPanel";
afterEach(() => {
  cleanup();
  delete (window as unknown as { sebby?: unknown }).sebby;
});
it("never implies an engine runs and performs no automatic preparation", () => {
  const api = { isolationStatus: vi.fn(), prepareIsolationSnapshot: vi.fn() };
  (window as unknown as { sebby: unknown }).sebby = api;
  render(<IsolationPanel report={() => {}} />);
  expect(
    (
      screen.getByRole("button", {
        name: /Run build\/test/,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(api.isolationStatus).not.toHaveBeenCalled();
  expect(api.prepareIsolationSnapshot).not.toHaveBeenCalled();
});
it("explicit local snapshot preparation, verification and discard never invokes a runner", async () => {
  const report = vi.fn();
  const snapshot = {
    id: "snapshot",
    files: [{ path: "package.json", bytes: 2, sha256: "a".repeat(64) }],
    totalBytes: 2,
    snapshotHash: "b".repeat(64),
    lockSha256: "c".repeat(64),
  };
  let rows: (typeof snapshot)[] = [];
  const api = {
    isolationStatus: vi.fn(async () => ({
      available: false,
      configuration: null,
      busy: false,
      snapshots: rows,
    })),
    prepareIsolationSnapshot: vi.fn(async () => {
      rows = [snapshot];
      return snapshot;
    }),
    verifyIsolationSnapshot: vi.fn(async () => ({ verified: true })),
    discardIsolationSnapshot: vi.fn(async () => {
      rows = [];
    }),
  };
  (window as unknown as { sebby: unknown }).sebby = api;
  render(<IsolationPanel report={report} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Review and prepare local snapshot" }),
  );
  await screen.findByText(/Local snapshot · 1 files/);
  expect(api.prepareIsolationSnapshot).toHaveBeenCalledWith({
    paths: ["package.json", "package-lock.json"],
  });
  expect(report).toHaveBeenCalledWith(
    "Local snapshot prepared. No build or test was executed.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Verify copied files" }));
  await waitFor(() =>
    expect(api.verifyIsolationSnapshot).toHaveBeenCalledWith("snapshot"),
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Discard local snapshot",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Discard local snapshot" }),
  );
  await waitFor(() =>
    expect(api.discardIsolationSnapshot).toHaveBeenCalledWith("snapshot"),
  );
});
