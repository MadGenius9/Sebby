import { afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { ReviewedMcpPanel } from "../src/ReviewedMcpPanel";
const url = "https://tools.public-domain.org/mcp",
  digest = "a".repeat(64);
function setup() {
  const state = {
    credential: { configured: true, generation: "g" },
    catalog: {
      id: "catalog",
      url,
      tools: [
        {
          name: "search",
          description: "<img src=x onerror=bad()>",
          schemaDigest: digest,
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        },
      ],
    },
    grants: [{ toolName: "search", schemaDigest: digest }],
    busy: false,
    history: [],
  };
  const api = {
    listConnectors: vi.fn(async () => [
      { id: "endpoint", name: "Test", type: "mcp", url },
    ]),
    reviewedMcpStatus: vi.fn(async () => state),
    saveMcpToken: vi.fn(
      async (_input: { connectorId: string; token: string }) => ({
        saved: true,
      }),
    ),
    removeMcpToken: vi.fn(async () => ({ removed: true })),
    discoverReviewedMcp: vi.fn(async () => ({ status: "ready" })),
    grantMcpTool: vi.fn(async () => ({ approved: true })),
    revokeMcpTool: vi.fn(async () => ({ revoked: true })),
    prepareMcpTool: vi.fn(async () => ({
      status: "ready",
      proposal: {
        id: "proposal",
        digest,
        connectorId: "endpoint",
        url,
        toolName: "search",
        schemaDigest: digest,
        argumentsJson: '{"query":"reviewed"}',
        createdAt: 1,
      },
    })),
    invokeMcpTool: vi.fn(
      async (_input: { proposalId: string; digest: string }) => ({
        status: "denied",
        output: undefined as undefined | { text: string[]; untrusted: true },
      }),
    ),
    discardMcpTool: vi.fn(async () => ({ discarded: true })),
    cancelMcpTool: vi.fn(async () => ({ cancelled: true })),
  };
  Object.defineProperty(window, "sebby", { configurable: true, value: api });
  return api;
}
async function select() {
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh saved MCP endpoints" }),
  );
  await screen.findByRole("option", { name: `Test · ${url}` });
  fireEvent.change(screen.getByLabelText("Saved endpoint"), {
    target: { value: "endpoint" },
  });
}
async function prepare() {
  await select();
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh local MCP status" }),
  );
  await screen.findByLabelText("Discovered tool");
  fireEvent.change(screen.getByLabelText("Discovered tool"), {
    target: { value: "search" },
  });
  fireEvent.change(
    screen.getByLabelText("Complete tool arguments (JSON, no secrets)"),
    { target: { value: '{"query":"reviewed"}' } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Prepare exact tool input review" }),
  );
  await screen.findByRole("region", { name: "Exact MCP call review" });
}
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "sebby", {
    configurable: true,
    value: undefined,
  });
});
it("no automatic endpoint access or tool requests; desktop fallback", () => {
  const api = setup();
  render(<ReviewedMcpPanel report={vi.fn()} />);
  expect(api.listConnectors).not.toHaveBeenCalled();
  expect(api.discoverReviewedMcp).not.toHaveBeenCalled();
  expect(api.invokeMcpTool).not.toHaveBeenCalled();
});
it("token is cleared immediately while dedicated save awaits approval", async () => {
  const api = setup();
  let done!: (value: { saved: boolean }) => void;
  api.saveMcpToken.mockImplementation(() => new Promise((r) => (done = r)));
  render(<ReviewedMcpPanel report={vi.fn()} />);
  await select();
  const input = screen.getByLabelText(
    "Endpoint-specific bearer token",
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "SYNTHETIC_TEST_TOKEN_ONLY" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Store or replace MCP token" }),
  );
  expect(input.value).toBe("");
  expect(api.saveMcpToken).toHaveBeenCalledOnce();
  expect(api.invokeMcpTool).not.toHaveBeenCalled();
  done({ saved: false });
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Store or replace MCP token" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
});
it("full review requires acknowledgment; native denial consumes UI proposal without tool retry", async () => {
  const api = setup();
  render(<ReviewedMcpPanel report={vi.fn()} />);
  await prepare();
  expect(document.querySelector("img")).toBeNull();
  expect(
    screen.getByText('{"query":"reviewed"}', { selector: "pre" }),
  ).toBeTruthy();
  const call = screen.getByRole("button", {
    name: "Request native confirmation and call once",
  });
  expect(call.hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByLabelText(/I reviewed this exact destination/));
  fireEvent.click(call);
  await screen.findByText("Observed outcome: denied");
  expect(api.invokeMcpTool).toHaveBeenCalledWith({
    proposalId: "proposal",
    digest,
  });
  expect(api.invokeMcpTool).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole("region", { name: "Exact MCP call review" }),
  ).toBeNull();
});
it("endpoint result remains inert text and never becomes model instructions", async () => {
  const api = setup();
  api.invokeMcpTool.mockResolvedValue({
    status: "completed",
    output: { text: ["<script>window.pwned=true</script>"], untrusted: true },
  });
  render(<ReviewedMcpPanel report={vi.fn()} />);
  await prepare();
  fireEvent.click(screen.getByLabelText(/I reviewed this exact destination/));
  fireEvent.click(
    screen.getByRole("button", {
      name: "Request native confirmation and call once",
    }),
  );
  await screen.findByText("<script>window.pwned=true</script>");
  expect(document.querySelector("script")).toBeNull();
  expect(screen.getByText(/Untrusted endpoint output/)).toBeTruthy();
});
it("malformed proposal digest is refused before acknowledgment or invoke", async () => {
  const api = setup();
  api.prepareMcpTool.mockResolvedValue({
    status: "ready",
    proposal: {
      id: "proposal",
      digest: "invalid",
      connectorId: "endpoint",
      url,
      toolName: "search",
      schemaDigest: digest,
      argumentsJson: "{}",
      createdAt: 1,
    },
  });
  const report = vi.fn();
  render(<ReviewedMcpPanel report={report} />);
  await select();
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh local MCP status" }),
  );
  await screen.findByLabelText("Discovered tool");
  fireEvent.change(screen.getByLabelText("Discovered tool"), {
    target: { value: "search" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Prepare exact tool input review" }),
  );
  await waitFor(() => expect(report).toHaveBeenCalled());
  expect(
    screen.queryByRole("region", { name: "Exact MCP call review" }),
  ).toBeNull();
  expect(api.invokeMcpTool).not.toHaveBeenCalled();
});
