import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  ProviderSettings,
  ProviderPicker,
  type ProviderSnapshot,
  type ProviderSettingsAPI,
  type ProviderProfile,
} from "../src/ProviderSettings";
const id = "11111111-1111-4111-8111-111111111111",
  id2 = "22222222-2222-4222-8222-222222222222";
function setup({ secure = true, configured = true } = {}) {
  const profile: ProviderProfile = {
    id,
    name: "Existing OpenAI key",
    provider: "openai",
    model: "my-saved-model",
    useEnvironment: true,
    options: { maxOutputTokens: 2048 },
  };
  let snapshot: ProviderSnapshot = {
    profiles: [profile],
    selectedProfileId: id,
    statuses: {
      [id]: {
        configured,
        source: configured ? "environment" : "none",
        secureStorageAvailable: secure,
      },
    },
    capabilities: {
      openai: {
        chat: true,
        tools: true,
        reasoningReplay: true,
        voice: false,
        modelDiscovery: false,
      },
      anthropic: {
        chat: true,
        tools: true,
        reasoningReplay: false,
        voice: false,
        modelDiscovery: false,
      },
      xai: {
        chat: true,
        tools: true,
        reasoningReplay: true,
        voice: false,
        modelDiscovery: false,
      },
    },
  };
  const unsubscribe = vi.fn();
  let changed = () => {};
  const api = {
    listProviderProfiles: vi.fn(async () => structuredClone(snapshot)),
    createProviderProfile: vi.fn(async (input: Omit<ProviderProfile, "id">) => {
      const added = { ...input, id: id2 };
      snapshot.profiles.push(added);
      snapshot.statuses[id2] = {
        configured: false,
        source: "none",
        secureStorageAvailable: secure,
      };
      return added;
    }),
    updateProviderProfile: vi.fn(
      async ({
        id: target,
        patch,
      }: {
        id: string;
        patch: Omit<ProviderProfile, "id" | "provider">;
      }) => {
        const index = snapshot.profiles.findIndex((p) => p.id === target);
        snapshot.profiles[index] = { ...snapshot.profiles[index], ...patch };
        return snapshot.profiles[index];
      },
    ),
    selectProviderProfile: vi.fn(async (target: string) => {
      snapshot.selectedProfileId = target;
      return { selectedProfileId: target };
    }),
    saveProviderKey: vi.fn(
      async (_input: { profileId: string; key: string }) => ({ saved: true }),
    ),
    removeProviderKey: vi.fn(async () => ({ removed: true })),
    removeProviderProfile: vi.fn(async () => ({ removed: false })),
    testProviderProfile: vi.fn(async () => ({
      status: "completed",
      usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 },
      text: "OK",
    })),
    cancelProviderTest: vi.fn(async () => ({ cancelled: true })),
    onProviderChanged: vi.fn((callback: () => void) => {
      changed = callback;
      return unsubscribe;
    }),
  };
  Object.defineProperty(window, "sebby", { configurable: true, value: api });
  return {
    api,
    unsubscribe,
    emit: () => changed(),
    setSnapshot: (value: ProviderSnapshot) => {
      snapshot = value;
    },
    snapshot,
  };
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
describe("provider settings", () => {
  it("loads local profiles without automatically testing, saving keys, or making model requests", async () => {
    const { api, unsubscribe } = setup();
    const { unmount } = render(<ProviderSettings report={vi.fn()} />);
    await screen.findByLabelText("Model ID");
    expect(api.listProviderProfiles).toHaveBeenCalledTimes(1);
    expect(api.testProviderProfile).not.toHaveBeenCalled();
    expect(api.saveProviderKey).not.toHaveBeenCalled();
    expect(
      screen.getByText(/subscriptions are separate from API billing/),
    ).toBeTruthy();
    expect((screen.getByLabelText("Model ID") as HTMLInputElement).value).toBe(
      "my-saved-model",
    );
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
  it("keeps key uncontrolled and masked, clears immediately while native save is pending, and never persists it to browser storage", async () => {
    const { api } = setup();
    let finish!: (result: { saved: boolean }) => void;
    api.saveProviderKey.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const storage = vi.spyOn(Storage.prototype, "setItem");
    render(<ProviderSettings report={vi.fn()} />);
    const key = (await screen.findByLabelText(
      "New API key (masked, not retained in this form)",
    )) as HTMLInputElement;
    const sentinel = "TEST_SENTINEL_NOT_A_REAL_KEY";
    fireEvent.change(key, { target: { value: sentinel } });
    expect(key.type).toBe("password");
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Store key securely…" })
        .closest("form")!,
    );
    expect(api.saveProviderKey).toHaveBeenCalledWith({
      profileId: id,
      key: sentinel,
    });
    expect(key.value).toBe("");
    expect(key.hasAttribute("value")).toBe(false);
    expect(document.body.textContent).not.toContain(sentinel);
    expect(storage).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /show key/i })).toBeNull();
    finish({ saved: false });
    await screen.findByText(
      "Key storage cancelled. The input has been cleared.",
    );
    expect(api.testProviderProfile).not.toHaveBeenCalled();
  });
  it("does not echo backend key-save errors and leaves field cleared on failure", async () => {
    const { api } = setup();
    const sentinel = "TEST_SENTINEL_SECRET_ERROR";
    api.saveProviderKey.mockRejectedValue(Error(sentinel));
    const report = vi.fn();
    render(<ProviderSettings report={report} />);
    const key = (await screen.findByLabelText(
      "New API key (masked, not retained in this form)",
    )) as HTMLInputElement;
    fireEvent.change(key, { target: { value: sentinel } });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Store key securely…" })
        .closest("form")!,
    );
    await waitFor(() => expect(report).toHaveBeenCalled());
    expect(JSON.stringify(report.mock.calls)).not.toContain(sentinel);
    expect(key.value).toBe("");
    expect(document.body.textContent).not.toContain(sentinel);
  });
  it("saves metadata with explicit model/output budget and fixed provider environment opt-in only", async () => {
    const { api } = setup();
    render(<ProviderSettings report={vi.fn()} />);
    await screen.findByLabelText("Model ID");
    fireEvent.click(screen.getByRole("button", { name: "New profile" }));
    fireEvent.change(screen.getByLabelText("Profile name"), {
      target: { value: "My Claude" },
    });
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "anthropic" },
    });
    fireEvent.change(screen.getByLabelText("Model ID"), {
      target: { value: "my-explicit-model" },
    });
    fireEvent.change(screen.getByLabelText("Maximum output tokens"), {
      target: { value: "4096" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /ANTHROPIC_API_KEY/ }),
    );
    fireEvent.submit(
      screen.getByRole("button", { name: "Save profile" }).closest("form")!,
    );
    await screen.findByText("Profile saved. No API request was made.");
    expect(api.createProviderProfile).toHaveBeenCalledWith({
      name: "My Claude",
      provider: "anthropic",
      model: "my-explicit-model",
      useEnvironment: true,
      options: { maxOutputTokens: 4096 },
    });
    expect(api.testProviderProfile).not.toHaveBeenCalled();
    expect(api.saveProviderKey).not.toHaveBeenCalled();
  });
  it("unavailable secure storage disables masked save and does not claim encryption is available", async () => {
    setup({ secure: false });
    render(<ProviderSettings report={vi.fn()} />);
    await screen.findByText(/OS-protected key storage is unavailable/);
    expect(
      (
        screen.getByRole("button", {
          name: "Store key securely…",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByLabelText(
          "New API key (masked, not retained in this form)",
        ) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    expect(screen.queryByText(/OS-encrypted key is available/)).toBeNull();
    expect(
      screen.getByText(/Existing OPENAI_API_KEY is available/),
    ).toBeTruthy();
  });
  it("connection test requires an explicit click, permits cancellation, and reports safe observed usage", async () => {
    const { api } = setup();
    let finish!: (value: any) => void;
    api.testProviderProfile.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<ProviderSettings report={vi.fn()} />);
    const button = await screen.findByRole("button", {
      name: "Review paid connection test…",
    });
    expect(api.testProviderProfile).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(api.testProviderProfile).toHaveBeenCalledWith(id);
    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel connection test" }),
    );
    await waitFor(() =>
      expect(api.cancelProviderTest).toHaveBeenCalledTimes(1),
    );
    finish({ status: "cancelled", usage: null });
    await screen.findByText("Test: cancelled");
    expect(screen.getByText("Token usage was not reported.")).toBeTruthy();
    expect(api.testProviderProfile).toHaveBeenCalledTimes(1);
  });
  it("profile picker selects saved profile without automatically contacting its provider and respects disabled state", async () => {
    const f = setup();
    const second = {
      ...f.snapshot.profiles[0],
      id: id2,
      name: "My Grok",
      provider: "xai" as const,
    };
    f.snapshot.profiles.push(second);
    const changed = vi.fn();
    const { rerender } = render(
      <ProviderPicker report={vi.fn()} onChanged={changed} />,
    );
    const picker = await screen.findByLabelText("AI profile");
    await waitFor(() =>
      expect((picker as HTMLSelectElement).disabled).toBe(false),
    );
    fireEvent.change(picker, { target: { value: id2 } });
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(f.api.selectProviderProfile).toHaveBeenCalledWith(id2);
    expect(f.api.testProviderProfile).not.toHaveBeenCalled();
    rerender(<ProviderPicker report={vi.fn()} disabled />);
    expect((picker as HTMLSelectElement).disabled).toBe(true);
  });
  it("browser preview does not offer a key field", () => {
    Object.defineProperty(window, "sebby", {
      configurable: true,
      value: undefined,
    });
    render(<ProviderSettings report={vi.fn()} />);
    expect(
      screen.getByText(/Browser preview does not accept API keys/),
    ).toBeTruthy();
    expect(document.querySelector("input[type=password]")).toBeNull();
  });
});

it("shows installed-model discovery and hides key inputs for local profiles", async () => {
  const f = setup();
  const p = {
    ...f.snapshot.profiles[0],
    provider: "ollama" as const,
    model: "local:latest",
    useEnvironment: false,
  };
  f.setSnapshot({ ...f.snapshot, profiles: [p] });
  const discover = vi.fn(async () => [{ name: "local:latest", size: 1000 }]);
  Object.assign(f.api, { listLocalModels: discover });
  render(<ProviderSettings report={vi.fn()} />);
  await screen.findByRole("button", { name: "Refresh installed models" });
  expect(screen.queryByLabelText(/New API key/)).toBeNull();
  expect(discover).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh installed models" }),
  );
  await waitFor(() => expect(discover).toHaveBeenCalledOnce());
  expect(
    screen.getByRole("button", { name: "Test local model…" }),
  ).toBeTruthy();
});
