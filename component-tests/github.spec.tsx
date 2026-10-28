import { afterEach, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { GitHubPanel } from "../src/GitHubPanel";
function setup() {
  let configuration = {
    owner: "owner",
    repo: "repo",
    ref: "HEAD",
    useToken: false,
  };
  const api = {
    githubStatus: vi.fn(async () => ({
      configuration,
      credential: { configured: true, secureStorageAvailable: true },
      busy: false,
      lastRead: null,
    })),
    saveGithubConfig: vi.fn(async (value) => {
      configuration = value;
      return value;
    }),
    saveGithubToken: vi.fn(async (_input) => ({ saved: false })),
    removeGithubToken: vi.fn(async () => ({ removed: true })),
    readGithubMetadata: vi.fn(async () => ({
      status: "ok",
      repository: {
        fullName: "owner/repo",
        description: "<script>untrusted</script>",
        private: false,
        defaultBranch: "main",
        archived: false,
      },
      provenance: { observedAt: "2026-01-01", requestId: "test" },
    })),
    readGithubTree: vi.fn(async () => ({
      status: "ok",
      treeId: "tree-id",
      treeSha: "a".repeat(40),
      entries: [{ path: "README.md", size: 24, sha: "b".repeat(40) }],
      truncated: true,
    })),
    readGithubFile: vi.fn(async (_input) => ({
      status: "ok",
      file: {
        path: "README.md",
        sha: "b".repeat(40),
        content: "<img src=x onerror=alert(1)>",
        untrusted: true,
      },
    })),
    cancelGithubRead: vi.fn(async () => ({ cancelled: true })),
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
  localStorage.clear();
  vi.restoreAllMocks();
});
describe("read-only GitHub panel", () => {
  it("loads only local status and saves explicit selection without network reads", async () => {
    const api = setup();
    render(<GitHubPanel report={vi.fn()} />);
    await screen.findByLabelText("GitHub owner");
    expect(api.readGithubMetadata).not.toHaveBeenCalled();
    expect(api.readGithubTree).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("GitHub repository"), {
      target: { value: "another" },
    });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Save repository settings" })
        .closest("form")!,
    );
    await screen.findByText(/Repository settings saved locally/);
    expect(api.saveGithubConfig).toHaveBeenCalledWith({
      owner: "owner",
      repo: "another",
      ref: "HEAD",
      useToken: false,
    });
    expect(api.readGithubTree).not.toHaveBeenCalled();
  });
  it("clears uncontrolled masked token before native confirmation settles and does not use localStorage", async () => {
    const api = setup();
    let finish!: (value: { saved: boolean }) => void;
    api.saveGithubToken.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const storage = vi.spyOn(Storage.prototype, "setItem");
    render(<GitHubPanel report={vi.fn()} />);
    const field = (await screen.findByLabelText(
      "GitHub token (masked)",
    )) as HTMLInputElement;
    const token = "TEST_ONLY_GITHUB_TOKEN_SENTINEL";
    fireEvent.change(field, { target: { value: token } });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Store GitHub token…" })
        .closest("form")!,
    );
    expect(field.value).toBe("");
    expect(field.type).toBe("password");
    expect(field.hasAttribute("value")).toBe(false);
    expect(api.saveGithubToken).toHaveBeenCalledWith({ token });
    expect(storage).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(token);
    finish({ saved: false });
    await screen.findByText(/Token save cancelled/);
    expect(api.readGithubMetadata).not.toHaveBeenCalled();
  });
  it("fetches only after distinct actions and renders file content as inert text without AI attachment", async () => {
    const api = setup();
    render(<GitHubPanel report={vi.fn()} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Review tree read…" }),
    );
    const fileButton = await screen.findByRole("button", {
      name: "README.md · 24 bytes",
    });
    expect(api.readGithubFile).not.toHaveBeenCalled();
    fireEvent.click(fileButton);
    await screen.findByText("<img src=x onerror=alert(1)>");
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(api.readGithubFile).toHaveBeenCalledWith({
      treeId: "tree-id",
      path: "README.md",
    });
    expect(api.readGithubTree).toHaveBeenCalledTimes(1);
    expect(api.readGithubMetadata).not.toHaveBeenCalled();
  });
  it("permits explicit cancellation while a read is pending", async () => {
    const api = setup();
    let finish!: (value: any) => void;
    api.readGithubMetadata.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<GitHubPanel report={vi.fn()} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Review metadata read…" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel GitHub read" }),
    );
    await waitFor(() => expect(api.cancelGithubRead).toHaveBeenCalledTimes(1));
    finish({ status: "cancelled" });
    await screen.findByText(/Read cancelled/);
    expect(api.readGithubMetadata).toHaveBeenCalledTimes(1);
  });
});
