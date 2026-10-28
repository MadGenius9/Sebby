import { afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { GitHubPublishPanel } from "../src/GitHubPublishPanel";
const proposal = {
  id: "nonce",
  digest: "a".repeat(64),
  truncated: false,
  owner: "owner",
  repo: "repo",
  baseBranch: "main",
  baseSHA: "b".repeat(40),
  branch: "sebby/change",
  message: "Update",
  files: [
    {
      path: "index.html",
      before: "old",
      after: "<script>bad()</script>",
      sha256: "c".repeat(64),
      diff: "- old\n+ <script>bad()</script>",
    },
  ],
};
function setup() {
  const api = {
    publisherStatus: vi.fn(async () => ({
      publisher: { busy: false },
      authority: {
        repository: { owner: "owner", repo: "repo" },
        allowed: true,
      },
      history: [] as unknown[],
    })),
    grantGithubWrites: vi.fn(async () => ({})),
    revokeGithubWrites: vi.fn(async () => ({})),
    prepareGithubPublication: vi.fn(async () => ({
      status: "ready",
      proposal,
    })),
    publishGithubPublication: vi.fn(async () => ({
      status: "uncertain",
      message: "Verify remote branch before retrying.",
    })),
    discardGithubPublication: vi.fn(async () => ({})),
    cancelGithubPublication: vi.fn(async () => ({})),
    createGithubDraftPR: vi.fn(async () => ({ status: "published" })),
    checkGithubBuilds: vi.fn(async () => ({
      status: "ok",
      checks: [],
      truncated: false,
    })),
  };
  Object.defineProperty(window, "sebby", { configurable: true, value: api });
  return api;
}
async function prepare() {
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh publication status" }),
  );
  await screen.findByText(/owner\/repo. Write authority/);
  fireEvent.change(screen.getByLabelText("Workspace text paths"), {
    target: { value: "index.html" },
  });
  fireEvent.change(screen.getByLabelText("Base branch"), {
    target: { value: "main" },
  });
  fireEvent.change(screen.getByLabelText("New sebby branch"), {
    target: { value: "sebby/change" },
  });
  fireEvent.change(screen.getByLabelText("Commit message"), {
    target: { value: "Update" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Prepare full diff for review" }),
  );
}
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "sebby", {
    configurable: true,
    value: undefined,
  });
});
it("desktop gate and no automatic network or publication", () => {
  const api = setup();
  render(<GitHubPublishPanel report={vi.fn()} />);
  expect(api.publisherStatus).not.toHaveBeenCalled();
  expect(api.prepareGithubPublication).not.toHaveBeenCalled();
  expect(api.publishGithubPublication).not.toHaveBeenCalled();
});
it("browser fallback remains disabled", () => {
  render(<GitHubPublishPanel report={vi.fn()} />);
  expect(screen.getByText("Publishing requires the desktop app.")).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Prepare full diff for review" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
it("full immutable diff acknowledgment gates native publish and preserves uncertainty", async () => {
  const api = setup();
  render(<GitHubPublishPanel report={vi.fn()} />);
  await prepare();
  await screen.findByText("Immutable publication proposal");
  expect(document.querySelector("script")).toBeNull();
  const button = screen.getByRole("button", {
    name: "Publish reviewed proposal with native approval",
  });
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByLabelText(/I reviewed this full diff/));
  fireEvent.click(button);
  await waitFor(() =>
    expect(api.publishGithubPublication).toHaveBeenCalledWith({
      proposalId: "nonce",
      digest: "a".repeat(64),
    }),
  );
  await screen.findByText(/uncertain: Verify remote branch/);
  expect(api.publishGithubPublication).toHaveBeenCalledOnce();
  expect(screen.queryByText("Immutable publication proposal")).toBeNull();
});
it("truncated proposal cannot be published", async () => {
  const api = setup();
  api.prepareGithubPublication.mockResolvedValueOnce({
    status: "ready",
    proposal: { ...proposal, truncated: true },
  });
  render(<GitHubPublishPanel report={vi.fn()} />);
  await prepare();
  await screen.findByText(
    "Proposal is incomplete or truncated. Publishing is disabled.",
  );
  expect(
    screen.queryByRole("button", {
      name: "Publish reviewed proposal with native approval",
    }),
  ).toBeNull();
  expect(api.publishGithubPublication).not.toHaveBeenCalled();
});
it("invalid workspace paths never reach prepare", async () => {
  const api = setup();
  render(<GitHubPublishPanel report={vi.fn()} />);
  await prepare();
  await screen.findByText("Immutable publication proposal");
  fireEvent.change(screen.getByLabelText("Workspace text paths"), {
    target: { value: "../secret.txt" },
  });
  expect(
    screen
      .getByRole("button", { name: "Prepare full diff for review" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(api.prepareGithubPublication).toHaveBeenCalledOnce();
});
it("draft PR requires verified history and distinct reviewed text; checks explicit", async () => {
  const api = setup();
  api.publisherStatus.mockResolvedValue({
    publisher: { busy: false },
    authority: { repository: { owner: "owner", repo: "repo" }, allowed: true },
    history: [
      {
        id: "pub",
        owner: "owner",
        repo: "repo",
        newBranch: "sebby/change",
        commitSHA: "c".repeat(40),
        phase: "branch-created",
        outcome: "branch-created",
      },
    ],
  });
  render(<GitHubPublishPanel report={vi.fn()} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh publication status" }),
  );
  await screen.findByText(/owner\/repo. Write authority/);
  fireEvent.change(screen.getByLabelText("Publication history"), {
    target: { value: "pub" },
  });
  fireEvent.change(screen.getByLabelText("Draft pull request title"), {
    target: { value: "Review changes" },
  });
  const button = screen.getByRole("button", {
    name: "Create reviewed draft PR with native approval",
  });
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByLabelText(/I reviewed this draft pull request/));
  fireEvent.click(button);
  await waitFor(() =>
    expect(api.createGithubDraftPR).toHaveBeenCalledWith({
      publicationId: "pub",
      title: "Review changes",
      body: "",
    }),
  );
  expect(api.checkGithubBuilds).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Read check-run statuses" }),
  );
  await screen.findByText(
    "No check runs reported. This is not proof of a successful build.",
  );
});
