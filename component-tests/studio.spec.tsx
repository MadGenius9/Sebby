import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import {
  preset,
  parseScene,
  validateScene,
  wallsToScene,
  scenePrompt,
} from "../src/studio/model";
import { buildGroup, disposeGroup } from "../src/studio/scene";
import { StudioPanel } from "../src/studio/StudioPanel";
vi.mock("../src/studio/Viewport", () => ({
  Viewport: () => <div>Viewport fixture</div>,
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  delete window.sebby;
  vi.restoreAllMocks();
});
it("round-trips scenes and creates actual editable meshes; explode never mutates document", () => {
  const doc = preset("robot");
  expect(parseScene(JSON.stringify(doc))).toEqual(doc);
  const before = JSON.stringify(doc),
    a = buildGroup(doc),
    b = buildGroup(doc, 2);
  expect(a.children).toHaveLength(doc.parts.length);
  expect(a.children[0].position.equals(b.children[0].position)).toBe(false);
  expect(JSON.stringify(doc)).toBe(before);
  disposeGroup(a);
  disposeGroup(b);
});
it("rejects executable fields, duplicates, non-finite or oversized scene data", () => {
  const base = preset("robot");
  expect(() => validateScene({ ...base, script: "alert(1)" })).toThrow();
  expect(() =>
    validateScene({ ...base, parts: [base.parts[0], base.parts[0]] }),
  ).toThrow();
  expect(() =>
    validateScene({
      ...base,
      parts: [{ ...base.parts[0], size: [Infinity, 1, 1] }],
    }),
  ).toThrow();
  expect(() => parseScene("x".repeat(65537))).toThrow();
  expect(() => scenePrompt(base, "x".repeat(16000))).toThrow();
});
it("floor-plan conversion retains real dimensions and rotation", () => {
  const doc = wallsToScene(
    [
      { a: [0, 0], b: [1, 0] },
      { a: [1, 0], b: [1, 1] },
    ],
    12,
    3,
  );
  expect(doc.parts[1].size).toEqual([12, 3, 0.15]);
  expect(doc.parts[2].size[0]).toBe(8);
  expect(doc.parts[2].rotation[1]).toBe(-90);
});
it("edits, undo, redo and workspace autosave restore without losing objects", () => {
  const view = render(<StudioPanel workspace="one" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Empty scene", exact: true }),
  );
  expect(screen.getByText("0 objects")).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "Add object" }), {
    target: { value: "box" },
  });
  fireEvent.change(screen.getByLabelText("Object name"), {
    target: { value: "Copper housing" },
  });
  fireEvent.change(screen.getByLabelText("Object color"), {
    target: { value: "#aa7744" },
  });
  expect(
    JSON.parse(localStorage.getItem("sebby.studio.v1:one")!).parts[0].color,
  ).toBe("#aa7744");
  fireEvent.click(
    screen.getByRole("button", { name: "Delete object", exact: true }),
  );
  expect(screen.getByText("0 objects")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Undo", exact: true }));
  expect(screen.getByDisplayValue("Copper housing")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Redo", exact: true }));
  expect(screen.getByText("0 objects")).toBeTruthy();
  view.unmount();
  render(<StudioPanel workspace="one" />);
  expect(screen.getByText("0 objects")).toBeTruthy();
});
it("invalid stored scene is preserved until an explicit edit", () => {
  localStorage.setItem("sebby.studio.v1:one", "broken");
  render(<StudioPanel workspace="one" />);
  expect(screen.getByText(/Saved scene could not be loaded/)).toBeTruthy();
  expect(localStorage.getItem("sebby.studio.v1:one")).toBe("broken");
});
it("AI proposal uses the real bridge and applies only a complete valid scene", async () => {
  const proposal = preset("room");
  const api = {
    providerStatus: vi.fn(async () => ({ configured: true, model: "local" })),
    startChat: vi.fn(async () => ({
      runId: "run",
      conversationId: "conversation",
    })),
    chatStatus: vi.fn(async () => ({ status: "completed" })),
    getConversation: vi.fn(async () => ({
      messages: [
        {
          role: "assistant",
          status: "complete",
          text: JSON.stringify(proposal),
        },
      ],
    })),
    cancelChat: vi.fn(async () => ({})),
    listProviderProfiles: vi.fn(async () => ({
      profiles: [],
      selectedProfileId: null,
      statuses: {},
      capabilities: {},
    })),
    onProviderChanged: () => () => {},
  };
  window.sebby = api as unknown as typeof window.sebby;
  render(<StudioPanel workspace="one" />);
  fireEvent.click(screen.getByRole("tab", { name: "Build with Sebby" }));
  fireEvent.change(screen.getByLabelText("Scene instruction"), {
    target: { value: "Make a creative studio" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Generate scene proposal" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Apply scene proposal" }),
    ).toBeTruthy(),
  );
  expect(screen.getByText("12 objects")).toBeTruthy();
  expect(api.startChat.mock.calls.length).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Apply scene proposal" }));
  expect(screen.getByText("11 objects")).toBeTruthy();
  expect(JSON.parse(localStorage.getItem("sebby.studio.v1:one")!).name).toBe(
    "Creative studio",
  );
});
it("late cancelled AI starts are cancelled and never applied", async () => {
  let resolveStart!: (value: { runId: string; conversationId: string }) => void;
  const api = {
    providerStatus: vi.fn(async () => ({ configured: true, model: "local" })),
    startChat: vi.fn(
      () =>
        new Promise<{ runId: string; conversationId: string }>((r) => {
          resolveStart = r;
        }),
    ),
    cancelChat: vi.fn(async () => ({})),
    listProviderProfiles: vi.fn(async () => ({
      profiles: [],
      selectedProfileId: null,
      statuses: {},
      capabilities: {},
    })),
    onProviderChanged: () => () => {},
  };
  window.sebby = api as unknown as typeof window.sebby;
  render(<StudioPanel workspace="one" />);
  fireEvent.click(screen.getByRole("tab", { name: "Build with Sebby" }));
  fireEvent.change(screen.getByLabelText("Scene instruction"), {
    target: { value: "Create a room" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Generate scene proposal" }),
  );
  await waitFor(() => expect(api.startChat).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Cancel generation" }));
  resolveStart({ runId: "late-run", conversationId: "late-conversation" });
  await waitFor(() => expect(api.cancelChat).toHaveBeenCalledWith("late-run"));
  expect(screen.getByText("12 objects")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Apply scene proposal" }),
  ).toBeNull();
});
it("stale AI proposal cannot overwrite a scene edited while waiting", async () => {
  let resolveStatus!: (value: { status: string }) => void;
  const api = {
    providerStatus: async () => ({ configured: true, model: "local" }),
    startChat: async () => ({ runId: "run", conversationId: "conversation" }),
    chatStatus: vi.fn(
      () =>
        new Promise<{ status: string }>((r) => {
          resolveStatus = r;
        }),
    ),
    getConversation: async () => ({
      messages: [
        {
          role: "assistant",
          status: "complete",
          text: JSON.stringify(preset("robot")),
        },
      ],
    }),
    cancelChat: async () => ({}),
    listProviderProfiles: async () => ({
      profiles: [],
      selectedProfileId: null,
      statuses: {},
      capabilities: {},
    }),
    onProviderChanged: () => () => {},
  };
  window.sebby = api as unknown as typeof window.sebby;
  render(<StudioPanel workspace="one" />);
  fireEvent.click(screen.getByRole("tab", { name: "Build with Sebby" }));
  fireEvent.change(screen.getByLabelText("Scene instruction"), {
    target: { value: "Edit robot" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Generate scene proposal" }),
  );
  await waitFor(() => expect(api.chatStatus).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Room", exact: true }));
  resolveStatus({ status: "completed" });
  await screen.findByRole("button", { name: "Apply scene proposal" });
  fireEvent.click(screen.getByRole("button", { name: "Apply scene proposal" }));
  expect(
    screen.getByText(/scene changed after generation started/),
  ).toBeTruthy();
  expect(screen.getByText("11 objects")).toBeTruthy();
});
