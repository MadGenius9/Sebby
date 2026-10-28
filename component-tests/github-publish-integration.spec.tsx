import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { GitHubPublishPanel } from "../src/GitHubPublishPanel";
import { installGitHubPublishing } from "../electron/github-publish-ipc.mjs";
import { GitHubConfig } from "../electron/github-storage.mjs";
import { Workspace } from "../electron/services.mjs";
import { validatePublicationRequest } from "../electron/github-publish-transport.mjs";
const BASE = "a".repeat(40),
  TREE = "b".repeat(40),
  NEW_TREE = "c".repeat(40),
  COMMIT = "d".repeat(40);
const before = "<!doctype html><p>Previous version</p>\n",
  after = "<!doctype html><p>Reviewed local change</p>\n";
const blob = (content: string | Buffer) =>
  createHash("sha1")
    .update(`blob ${Buffer.byteLength(content)}\0`)
    .update(content)
    .digest("hex");
const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  cleanup();
  Object.defineProperty(window, "sebby", {
    configurable: true,
    value: undefined,
  });
  for (const dispose of disposers.splice(0)) await dispose();
});
async function fixture(allowPublish: boolean) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "sebby-dom-publish-"),
  );
  const workspaceDirectory = path.join(directory, "workspace");
  await fs.mkdir(workspaceDirectory);
  await fs.writeFile(path.join(workspaceDirectory, "app.html"), after);
  const workspace = new Workspace();
  await workspace.select(workspaceDirectory);
  const config = new GitHubConfig(path.join(directory, "config"));
  await config.load();
  await config.save({
    owner: "owner",
    repo: "repo",
    ref: "HEAD",
    useToken: true,
  });
  const handlers = new Map<string, (input?: unknown) => unknown>();
  const calls: { method: string; apiPath: string; body?: any }[] = [];
  const prompts: string[] = [];
  const transport = vi.fn(async (req: any) => {
    validatePublicationRequest(req);
    calls.push({ method: req.method, apiPath: req.apiPath, body: req.body });
    const p = req.apiPath;
    let value: any;
    if (req.method === "GET") {
      if (p.includes("/git/ref/heads/")) {
        const name = p.split("/git/ref/heads/")[1];
        value = {
          ref: `refs/heads/${name}`,
          object: { type: "commit", sha: name === "main" ? BASE : COMMIT },
        };
      } else if (p.endsWith(`/git/commits/${BASE}`))
        value = { sha: BASE, tree: { sha: TREE } };
      else if (p.includes("/git/trees/"))
        value = {
          sha: TREE,
          truncated: false,
          tree: [
            {
              path: "app.html",
              type: "blob",
              mode: "100644",
              sha: blob(before),
              size: Buffer.byteLength(before),
            },
          ],
        };
      else if (p.includes("/git/blobs/"))
        value = {
          sha: blob(before),
          encoding: "base64",
          size: Buffer.byteLength(before),
          content: Buffer.from(before).toString("base64"),
        };
      else if (p.includes("/check-runs"))
        value = {
          total_count: 1,
          check_runs: [
            {
              head_sha: COMMIT,
              name: "mock check",
              status: "completed",
              conclusion: "success",
            },
          ],
        };
    } else if (p.endsWith("/git/blobs"))
      value = { sha: blob(Buffer.from(req.body.content, "base64")) };
    else if (p.endsWith("/git/trees")) value = { sha: NEW_TREE };
    else if (p.endsWith("/git/commits"))
      value = {
        sha: COMMIT,
        tree: { sha: NEW_TREE },
        parents: [{ sha: BASE }],
      };
    else if (p.endsWith("/git/refs"))
      value = { ref: req.body.ref, object: { sha: COMMIT, type: "commit" } };
    else if (p.endsWith("/pulls"))
      value = {
        number: 42,
        draft: true,
        head: { sha: COMMIT, ref: "sebby/dom-review" },
        base: { ref: "main" },
      };
    if (!value) throw Error("Unexpected test transport request");
    return {
      status: req.method === "POST" ? 201 : 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    };
  });
  const service = await installGitHubPublishing({
    directory: path.join(directory, "publishing"),
    workspace,
    github: {
      config,
      vault: { getToken: async () => "SYNTHETIC_TEST_CREDENTIAL_NOT_REAL" },
      isBusy: () => false,
    },
    register: (name: string, fn: (input?: unknown) => unknown) =>
      handlers.set(name, fn),
    confirm: async (title: string) => {
      prompts.push(title);
      return !title.startsWith("Publish the exact") || allowPublish;
    },
    publisherOptions: {
      transport,
      resolve: async () => [{ address: "140.82.112.6", family: 4 }],
    },
  });
  disposers.push(async () => {
    await service.shutdown();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const names = {
    publisherStatus: "publisher-status",
    grantGithubWrites: "grant-github-writes",
    revokeGithubWrites: "revoke-github-writes",
    prepareGithubPublication: "prepare-github-publication",
    publishGithubPublication: "publish-github-publication",
    discardGithubPublication: "discard-github-publication",
    cancelGithubPublication: "cancel-github-publication",
    createGithubDraftPR: "create-github-draft-pr",
    checkGithubBuilds: "check-github-builds",
  };
  Object.defineProperty(window, "sebby", {
    configurable: true,
    value: Object.fromEntries(
      Object.entries(names).map(([api, handler]) => [
        api,
        async (input?: unknown) =>
          structuredClone(await handlers.get(handler)!(structuredClone(input))),
      ]),
    ),
  });
  return { service, calls, prompts, transport, directory };
}
async function prepareThroughDOM() {
  render(<GitHubPublishPanel report={vi.fn()} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh publication status" }),
  );
  await screen.findByText(/Write authority: Not granted/);
  fireEvent.click(
    screen.getByRole("button", { name: "Grant writes with native approval" }),
  );
  await screen.findByText(/Write authority: Granted/);
  fireEvent.change(screen.getByLabelText("Workspace text paths"), {
    target: { value: "app.html" },
  });
  fireEvent.change(screen.getByLabelText("Base branch"), {
    target: { value: "main" },
  });
  fireEvent.change(screen.getByLabelText("New sebby branch"), {
    target: { value: "sebby/dom-review" },
  });
  fireEvent.change(screen.getByLabelText("Commit message"), {
    target: { value: "DOM reviewed update" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Prepare full diff for review" }),
  );
  await screen.findByText("Immutable publication proposal");
}
it("real workspace, stores and handlers prepare full diff; denied native publication performs no remote mutation", async () => {
  const f = await fixture(false);
  await prepareThroughDOM();
  expect(screen.getByText(before.trim())).toBeTruthy();
  expect(screen.getByText(after.trim())).toBeTruthy();
  expect(f.calls.every((c) => c.method === "GET")).toBe(true);
  const button = screen.getByRole("button", {
    name: "Publish reviewed proposal with native approval",
  });
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByLabelText(/I reviewed this full diff/));
  fireEvent.click(button);
  await screen.findByText(/^denied/);
  expect(f.calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  expect(f.prompts.some((p) => p.startsWith("Publish the exact"))).toBe(true);
  expect(f.service.history.list()).toHaveLength(0);
  expect(f.service.permissions.list()).toHaveLength(1);
});
it("real reviewed publishing creates only new branch then separately reviewed draft PR, with metadata evidence", async () => {
  const f = await fixture(true);
  await prepareThroughDOM();
  fireEvent.click(screen.getByLabelText(/I reviewed this full diff/));
  fireEvent.click(
    screen.getByRole("button", {
      name: "Publish reviewed proposal with native approval",
    }),
  );
  await screen.findByText(/^branch-created/);
  const writes = f.calls.filter((c) => c.method === "POST");
  expect(writes.map((c) => c.apiPath.split("/").at(-1))).toEqual([
    "blobs",
    "trees",
    "commits",
    "refs",
  ]);
  expect(Buffer.from(writes[0].body.content, "base64").toString()).toBe(after);
  expect(writes[3].body).toEqual({
    ref: "refs/heads/sebby/dom-review",
    sha: COMMIT,
  });
  expect(f.service.history.list()[0].commitSHA).toBe(COMMIT);
  fireEvent.change(screen.getByLabelText("Draft pull request title"), {
    target: { value: "Review the prepared change" },
  });
  fireEvent.change(screen.getByLabelText("Draft pull request body"), {
    target: { value: "Explicitly reviewed test body." },
  });
  expect(
    screen
      .getByRole("button", {
        name: "Create reviewed draft PR with native approval",
      })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByLabelText(/I reviewed this draft pull request/));
  fireEvent.click(
    screen.getByRole("button", {
      name: "Create reviewed draft PR with native approval",
    }),
  );
  await waitFor(() =>
    expect(f.service.history.list()[0].outcome).toBe("published"),
  );
  expect(f.calls.find((c) => c.apiPath.endsWith("/pulls"))?.body).toMatchObject(
    {
      draft: true,
      title: "Review the prepared change",
      head: "sebby/dom-review",
      base: "main",
    },
  );
  await screen.findByText(/^published/);
  expect(f.service.history.list()[0].prNumber).toBe(42);
  const journal = JSON.stringify(f.service.history.list());
  expect(journal).not.toContain(after);
  expect(journal).not.toContain("SYNTHETIC_TEST_CREDENTIAL");
});
