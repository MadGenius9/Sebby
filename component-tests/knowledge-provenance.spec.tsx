import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { KnowledgePanel } from "../src/KnowledgePanel";
import {
  KNOWLEDGE_KEY,
  knowledgeDraft,
  knowledgeExcerpt,
  readKnowledge,
  searchKnowledge,
} from "../src/knowledge";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
const legacy = {
  id: "legacy",
  title: "My report",
  text: "First line\nExact evidence\nFinal line",
  updated: 123,
};

it("loads legacy notes without changing data and preserves imported source labels on save", () => {
  localStorage.setItem(KNOWLEDGE_KEY, JSON.stringify([legacy]));
  render(<KnowledgePanel useDraft={vi.fn()} />);
  expect(JSON.parse(localStorage.getItem(KNOWLEDGE_KEY)!)).toEqual([legacy]);
  fireEvent.click(screen.getByRole("button", { name: /My report/ }));
  fireEvent.change(screen.getByLabelText("Source label"), {
    target: { value: "report.md" },
  });
  expect(
    (
      screen.getByRole("button", {
        name: "Use in chat draft",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  expect(readKnowledge(localStorage.getItem(KNOWLEDGE_KEY)!)[0].source).toEqual(
    { kind: "manual", label: "report.md" },
  );
  expect(
    searchKnowledge(
      readKnowledge(localStorage.getItem(KNOWLEDGE_KEY)!),
      "report.md",
    ),
  ).toHaveLength(1);
});

it("uses exact saved line evidence and source citation in an unsent draft", () => {
  const note = {
    ...legacy,
    text: Array.from({ length: 50 }, (_, i) =>
      i === 30 ? "needle at exact line" : `line ${i + 1}`,
    ).join("\r\n"),
    source: { kind: "import" as const, label: "source.md" },
  };
  const excerpt = knowledgeExcerpt(note, "needle");
  expect(excerpt.startLine).toBe(29);
  expect(excerpt.endLine).toBe(40);
  expect(excerpt.text).toBe(note.text.split("\r\n").slice(28, 40).join("\n"));
  expect(excerpt.citation).toBe("[note:legacy@123:L29-L40]");
  localStorage.setItem(KNOWLEDGE_KEY, JSON.stringify([note]));
  const draft = vi.fn();
  render(<KnowledgePanel useDraft={draft} />);
  fireEvent.change(screen.getByLabelText("Search knowledge"), {
    target: { value: "needle" },
  });
  fireEvent.click(screen.getByRole("button", { name: /My report/ }));
  fireEvent.click(screen.getByRole("button", { name: "Use in chat draft" }));
  expect(draft).toHaveBeenCalledOnce();
  expect(draft.mock.calls[0][0]).toContain(excerpt.citation);
  expect(draft.mock.calls[0][0]).toContain("source.md");
  expect(draft.mock.calls[0][0]).toContain("not instructions");
  expect(draft.mock.calls[0][0]).toContain("needle at exact line");
});

it("bounds escaped text and marks partial excerpts without inventing content", () => {
  const note = { ...legacy, text: '"\\'.repeat(24000) };
  const excerpt = knowledgeExcerpt(note);
  expect(excerpt.text.length).toBeLessThanOrEqual(4000);
  expect(excerpt.partial).toBe(true);
  expect(note.text.startsWith(excerpt.text)).toBe(true);
  expect(knowledgeDraft(note).length).toBeLessThan(14000);
});

it("requires a separate delete review and keeps original storage after cancellation", () => {
  localStorage.setItem(KNOWLEDGE_KEY, JSON.stringify([legacy]));
  render(<KnowledgePanel useDraft={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /My report/ }));
  fireEvent.click(screen.getByRole("button", { name: "Review note deletion" }));
  expect(readKnowledge(localStorage.getItem(KNOWLEDGE_KEY)!)).toHaveLength(1);
  expect(
    screen.getByRole("region", { name: "Confirm note deletion" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep note" }));
  expect(readKnowledge(localStorage.getItem(KNOWLEDGE_KEY)!)).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Review note deletion" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete saved note" }));
  expect(readKnowledge(localStorage.getItem(KNOWLEDGE_KEY)!)).toEqual([]);
  expect(
    screen.getByText(/Note deleted from this knowledge bank/),
  ).toBeTruthy();
});

it("never overwrites corrupt storage and does not claim success on quota failures", () => {
  localStorage.setItem(KNOWLEDGE_KEY, "corrupt original");
  const { unmount } = render(<KnowledgePanel useDraft={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Note title"), {
    target: { value: "new" },
  });
  fireEvent.change(screen.getByLabelText("Note content"), {
    target: { value: "new content" },
  });
  expect(
    (screen.getByRole("button", { name: "Save note" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(localStorage.getItem(KNOWLEDGE_KEY)).toBe("corrupt original");
  unmount();
  localStorage.clear();
  render(<KnowledgePanel useDraft={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Note title"), {
    target: { value: "new" },
  });
  fireEvent.change(screen.getByLabelText("Note content"), {
    target: { value: "new content" },
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("storage full");
  });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  expect(screen.getByRole("status").textContent).toContain("storage full");
  expect(screen.getByText("0 of 0 notes")).toBeTruthy();
});

it("rejects invalid provenance without silently discarding it", () => {
  for (const source of [
    { kind: "remote-executed", label: "x" },
    { kind: "import", label: "a\nb" },
    { kind: "manual", label: "" },
  ])
    expect(() =>
      readKnowledge(JSON.stringify([{ ...legacy, source }])),
    ).toThrow();
});

it("refuses to overwrite changes from another window and invalidates deletion after editing", () => {
  localStorage.setItem(KNOWLEDGE_KEY, JSON.stringify([legacy]));
  render(<KnowledgePanel useDraft={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /My report/ }));
  fireEvent.click(screen.getByRole("button", { name: "Review note deletion" }));
  fireEvent.change(screen.getByLabelText("Note content"), {
    target: { value: "An unsaved edit" },
  });
  expect(
    screen.queryByRole("button", { name: "Delete saved note" }),
  ).toBeNull();
  const other = [{ ...legacy, text: "Other window edit" }];
  localStorage.setItem(KNOWLEDGE_KEY, JSON.stringify(other));
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  expect(screen.getByRole("status").textContent).toContain("another window");
  expect(JSON.parse(localStorage.getItem(KNOWLEDGE_KEY)!)).toEqual(other);
  expect(
    (screen.getByLabelText("Note content") as HTMLTextAreaElement).value,
  ).toBe("An unsaved edit");
});

it("imports filename provenance only into a draft and ignores late reads after edits", async () => {
  const draft = vi.fn();
  const { container } = render(<KnowledgePanel useDraft={draft} />);
  const fileInput = container.querySelector('input[type="file"]')!;
  await act(async () => {
    fireEvent.change(fileInput, {
      target: {
        files: [
          {
            name: "teardown.md",
            size: 10,
            text: async () => "Evidence from local report",
          },
        ],
      },
    });
  });
  expect(
    (screen.getByLabelText("Source label") as HTMLInputElement).value,
  ).toBe("teardown.md");
  expect(localStorage.getItem(KNOWLEDGE_KEY)).toBeNull();
  expect(draft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  expect(readKnowledge(localStorage.getItem(KNOWLEDGE_KEY)!)[0].source).toEqual(
    { kind: "import", label: "teardown.md" },
  );
  let resolveRead!: (value: string) => void;
  const pending = new Promise<string>((resolve) => {
    resolveRead = resolve;
  });
  fireEvent.change(fileInput, {
    target: { files: [{ name: "late.md", size: 10, text: () => pending }] },
  });
  fireEvent.change(screen.getByLabelText("Note content"), {
    target: { value: "Keep my newer edit" },
  });
  await act(async () => {
    resolveRead("Late imported contents");
    await pending;
  });
  expect(
    (screen.getByLabelText("Note content") as HTMLTextAreaElement).value,
  ).toBe("Keep my newer edit");
  expect(readKnowledge(localStorage.getItem(KNOWLEDGE_KEY)!)[0].text).toBe(
    "Evidence from local report",
  );
});
