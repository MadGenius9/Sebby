import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import {
  KnowledgePanel,
  readKnowledge,
  searchKnowledge,
} from "../src/KnowledgePanel";
afterEach(() => {
  cleanup();
  localStorage.clear();
});
it("saves a real report, searches it and inserts exact reference into draft", () => {
  const draft = vi.fn();
  render(<KnowledgePanel useDraft={draft} />);
  fireEvent.change(screen.getByLabelText("Note title"), {
    target: { value: "REA notes" },
  });
  fireEvent.change(screen.getByLabelText("Note content"), {
    target: { value: "The renderer stores a scene document." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  fireEvent.change(screen.getByLabelText("Search knowledge"), {
    target: { value: "renderer scene" },
  });
  expect(screen.getByText("1 of 1 notes")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Use in chat draft" }));
  expect(draft.mock.calls[0][0]).toContain(
    "The renderer stores a scene document.",
  );
  fireEvent.change(screen.getByLabelText("Search knowledge"), {
    target: { value: "absent" },
  });
  expect(screen.getByText("0 of 1 notes")).toBeTruthy();
  expect(JSON.parse(localStorage.getItem("sebby.knowledge.v1")!)[0].title).toBe(
    "REA notes",
  );
});
it("rejects malformed documents and requires all search terms", () => {
  expect(() => readKnowledge("[{}]")).toThrow();
  expect(
    searchKnowledge(
      [{ id: "one", title: "Wall", text: "Floor plan", updated: 1 }],
      "wall missing",
    ),
  ).toEqual([]);
});
