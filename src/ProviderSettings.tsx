import { useCallback, useEffect, useMemo, useRef, useState } from "react";
export type ProviderName = "openai" | "anthropic" | "xai";
export type ProviderProfile = {
  id: string;
  name: string;
  provider: ProviderName;
  model: string;
  useEnvironment: boolean;
  options: { maxOutputTokens: number };
};
type CredentialStatus = {
  configured: boolean;
  source: string;
  secureStorageAvailable: boolean;
};
type Capability = {
  chat: boolean;
  tools: boolean;
  reasoningReplay: boolean;
  voice: boolean;
  modelDiscovery: boolean;
};
export type ProviderSnapshot = {
  profiles: ProviderProfile[];
  selectedProfileId: string | null;
  statuses: Record<string, CredentialStatus>;
  capabilities: Record<ProviderName, Capability>;
};
type TestResult = {
  status: string;
  responseId?: string | null;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } | null;
  error?: string | null;
  text?: string;
};
export interface ProviderSettingsAPI {
  listProviderProfiles(): Promise<ProviderSnapshot>;
  createProviderProfile(
    input: Omit<ProviderProfile, "id">,
  ): Promise<ProviderProfile>;
  updateProviderProfile(input: {
    id: string;
    patch: Omit<ProviderProfile, "id" | "provider">;
  }): Promise<ProviderProfile>;
  selectProviderProfile(id: string): Promise<unknown>;
  saveProviderKey(input: {
    profileId: string;
    key: string;
  }): Promise<{ saved: boolean }>;
  removeProviderKey(id: string): Promise<{ removed: boolean }>;
  removeProviderProfile(id: string): Promise<{ removed: boolean }>;
  testProviderProfile(id: string): Promise<TestResult>;
  cancelProviderTest(): Promise<{ cancelled: boolean }>;
  onProviderChanged(callback: () => void): () => void;
}
const labels: Record<ProviderName, string> = {
  openai: "GPT / OpenAI",
  anthropic: "Claude / Anthropic",
  xai: "Grok / xAI",
};
const variables: Record<ProviderName, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  xai: "XAI_API_KEY",
};
type Props = { report: (message: string) => void; onChanged?: () => void };
function bridge(): ProviderSettingsAPI | null {
  const candidate = window.sebby as unknown as ProviderSettingsAPI | undefined;
  return typeof candidate?.listProviderProfiles === "function"
    ? candidate
    : null;
}
function useProfiles(report: Props["report"]) {
  const api = useMemo(bridge, []),
    [data, setData] = useState<ProviderSnapshot | null>(null),
    reportRef = useRef(report);
  reportRef.current = report;
  const refresh = useCallback(async () => {
    if (!api) return null;
    const snapshot = await api.listProviderProfiles();
    setData(snapshot);
    return snapshot;
  }, [api]);
  useEffect(() => {
    if (!api) return;
    let active = true;
    const load = () =>
      api
        .listProviderProfiles()
        .then((snapshot) => {
          if (active) setData(snapshot);
        })
        .catch(() => {
          if (active)
            reportRef.current("Provider settings could not be loaded.");
        });
    void load();
    const unsubscribe = api.onProviderChanged(() => void load());
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);
  return { api, data, refresh };
}
export function ProviderPicker({
  report,
  onChanged,
  disabled = false,
}: Props & { disabled?: boolean }) {
  const { api, data, refresh } = useProfiles(report),
    [busy, setBusy] = useState(false);
  if (!api)
    return (
      <p className="muted">
        Choose an API provider in the desktop app’s Settings.
      </p>
    );
  const selected = data?.profiles.find((p) => p.id === data.selectedProfileId);
  return (
    <div className="scope">
      <label htmlFor="active-provider-profile">AI profile</label>
      <select
        id="active-provider-profile"
        value={data?.selectedProfileId || ""}
        disabled={disabled || busy || !data}
        onChange={async (e) => {
          setBusy(true);
          try {
            await api.selectProviderProfile(e.target.value);
            await refresh();
            onChanged?.();
          } catch {
            report(
              "Provider selection could not change. Finish active AI work first.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <option value="" disabled>
          {data?.profiles.length
            ? "Choose a profile"
            : "Create a profile in Settings"}
        </option>
        {data?.profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name} · {labels[profile.provider]} ·{" "}
            {profile.model || "model not set"}
          </option>
        ))}
      </select>
      {selected && (
        <small>
          {data?.statuses[selected.id]?.configured
            ? "Key available · API usage may be charged"
            : "No usable key configured"}
        </small>
      )}
    </div>
  );
}
const emptyForm = () => ({
  name: "",
  provider: "openai" as ProviderName,
  model: "",
  useEnvironment: false,
  options: { maxOutputTokens: 2048 },
});
export function ProviderSettings({ report, onChanged }: Props) {
  const { api, data, refresh } = useProfiles(report),
    [editId, setEditId] = useState<string | null>(null),
    [form, setForm] = useState(emptyForm),
    [busy, setBusy] = useState<"metadata" | "key" | "test" | null>(null),
    [notice, setNotice] = useState(""),
    [result, setResult] = useState<TestResult | null>(null);
  const keyInput = useRef<HTMLInputElement>(null),
    initialized = useRef(false);
  const selectEditor = useCallback((profile: ProviderProfile | null) => {
    if (keyInput.current) keyInput.current.value = "";
    setEditId(profile?.id || null);
    setForm(
      profile
        ? {
            name: profile.name,
            provider: profile.provider,
            model: profile.model,
            useEnvironment: profile.useEnvironment,
            options: { ...profile.options },
          }
        : emptyForm(),
    );
    setResult(null);
    setNotice("");
  }, []);
  useEffect(() => {
    if (data && !initialized.current) {
      initialized.current = true;
      selectEditor(
        data.profiles.find((p) => p.id === data.selectedProfileId) ||
          data.profiles[0] ||
          null,
      );
    }
  }, [data, selectEditor]);
  useEffect(() => {
    const field = keyInput.current;
    return () => {
      if (field) field.value = "";
    };
  }, [editId]);
  if (!api)
    return (
      <>
        <h2>Your models. Your choice.</h2>
        <p className="muted">
          Provider profiles and OS-protected key storage are available in the
          desktop app. Browser preview does not accept API keys.
        </p>
      </>
    );
  if (!data || !initialized.current)
    return <p role="status">Loading provider settings…</p>;
  const status = editId ? data.statuses[editId] : undefined,
    current = editId ? data.profiles.find((p) => p.id === editId) : undefined;
  const savedModels = [
    ...new Set(
      data.profiles
        .filter((p) => p.provider === form.provider && p.model)
        .map((p) => p.model),
    ),
  ];
  const changed = () => {
    onChanged?.();
  };
  return (
    <section aria-label="Provider settings">
      <h2>Your models. Your choice.</h2>
      <p className="muted">
        Use your own OpenAI, Anthropic, or xAI API account. ChatGPT, Claude, and
        Grok subscriptions are separate from API billing. Every paid request
        still needs approval.
      </p>
      <div className="button-row">
        <label htmlFor="edit-provider-profile">Edit profile</label>
        <select
          id="edit-provider-profile"
          value={editId || ""}
          disabled={!!busy}
          onChange={(e) =>
            selectEditor(
              data.profiles.find((p) => p.id === e.target.value) || null,
            )
          }
        >
          <option value="">New profile</option>
          {data.profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
              {profile.id === data.selectedProfileId ? " · selected" : ""}
            </option>
          ))}
        </select>
        <button
          className="secondary"
          disabled={!!busy}
          onClick={() => selectEditor(null)}
        >
          New profile
        </button>
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (
            !form.name.trim() ||
            !Number.isInteger(form.options.maxOutputTokens) ||
            form.options.maxOutputTokens < 256 ||
            form.options.maxOutputTokens > 8192
          ) {
            report(
              "Enter a profile name and output budget from 256 to 8192 tokens.",
            );
            return;
          }
          setBusy("metadata");
          try {
            const saved = editId
              ? await api.updateProviderProfile({
                  id: editId,
                  patch: {
                    name: form.name,
                    model: form.model,
                    useEnvironment: form.useEnvironment,
                    options: form.options,
                  },
                })
              : await api.createProviderProfile(form);
            await refresh();
            selectEditor(saved);
            setNotice("Profile saved. No API request was made.");
            changed();
          } catch {
            report(
              "Profile could not be saved. Check its name, model ID, and output budget; finish any active AI work.",
            );
          } finally {
            setBusy(null);
          }
        }}
      >
        <fieldset disabled={!!busy}>
          <legend>Provider and model</legend>
          <div className="form-grid">
            <label>
              Profile name
              <input
                aria-label="Profile name"
                value={form.name}
                maxLength={120}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                autoComplete="off"
              />
            </label>
            <label>
              Provider
              <select
                aria-label="Provider"
                value={form.provider}
                disabled={!!editId}
                onChange={(e) =>
                  setForm({
                    ...form,
                    provider: e.target.value as ProviderName,
                    model: "",
                    useEnvironment: false,
                  })
                }
              >
                {Object.entries(labels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field-label" htmlFor="provider-model">
            Model ID
          </label>
          <input
            id="provider-model"
            value={form.model}
            maxLength={100}
            list="saved-provider-models"
            onChange={(e) => setForm({ ...form, model: e.target.value })}
            placeholder="Enter the model ID from your provider"
            autoComplete="off"
          />
          <datalist id="saved-provider-models">
            {savedModels.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          <p className="muted">
            Suggestions contain only model IDs you saved. No model list is
            fetched automatically. A blank model can be saved, but cannot send
            requests.
          </p>
          <label className="field-label" htmlFor="provider-budget">
            Maximum output tokens
          </label>
          <input
            className="provider-input"
            id="provider-budget"
            type="number"
            min={256}
            max={8192}
            step={1}
            value={form.options.maxOutputTokens}
            onChange={(e) =>
              setForm({
                ...form,
                options: { maxOutputTokens: Number(e.target.value) },
              })
            }
          />
          <label className="check spaced">
            <input
              type="checkbox"
              checked={form.useEnvironment}
              onChange={(e) =>
                setForm({ ...form, useEnvironment: e.target.checked })
              }
            />
            Allow this profile to use existing {variables[form.provider]} when
            no stored key exists
          </label>
          <p className="muted">
            This reads only that fixed environment variable in the desktop main
            process. It does not copy its value into Settings or backups.
          </p>
          <button className="primary" type="submit">
            Save profile
          </button>
        </fieldset>
      </form>
      {current && (
        <>
          <div className="button-row spaced">
            <button
              className="secondary"
              disabled={!!busy || current.id === data.selectedProfileId}
              onClick={async () => {
                setBusy("metadata");
                try {
                  await api.selectProviderProfile(current.id);
                  await refresh();
                  setNotice("Profile selected. No API request was made.");
                  changed();
                } catch {
                  report(
                    "Profile could not be selected. Finish active AI work first.",
                  );
                } finally {
                  setBusy(null);
                }
              }}
            >
              {current.id === data.selectedProfileId
                ? "Selected for AI work"
                : "Use this profile"}
            </button>
            <button
              className="text-button"
              disabled={!!busy}
              onClick={async () => {
                setBusy("metadata");
                try {
                  const removed = await api.removeProviderProfile(current.id);
                  if (removed.removed) {
                    const next = await refresh();
                    selectEditor(
                      next?.profiles.find(
                        (p) => p.id === next.selectedProfileId,
                      ) || null,
                    );
                    setNotice(
                      "Profile and its locally stored key removed. Provider credentials were not revoked.",
                    );
                    changed();
                  } else setNotice("Profile removal cancelled.");
                } catch {
                  report("Profile could not be removed.");
                } finally {
                  setBusy(null);
                }
              }}
            >
              Remove profile and stored key…
            </button>
          </div>
          <h3 className="spaced">API key for {current.name}</h3>
          <p className="muted">
            {status?.configured
              ? status.source === "environment"
                ? `Existing ${variables[current.provider]} is available. Its value is never displayed.`
                : "OS-encrypted key is available. Its value is never displayed."
              : "No usable credential is configured."}{" "}
            Key availability is not a successful connection test.
          </p>
          {status?.secureStorageAvailable !== true ? (
            <p className="banner" role="status">
              OS-protected key storage is unavailable. Saving a key is disabled;
              no plaintext fallback is allowed. An explicitly enabled
              environment key can still be used.
            </p>
          ) : (
            <p className="muted">
              Saving encrypts the key using this operating system, after a
              native confirmation. Keys are excluded from backups.
            </p>
          )}
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const field = keyInput.current;
              if (!field) return;
              let key = field.value;
              if (key.length < 20 || key.length > 1024) {
                field.value = "";
                key = "";
                report(
                  "Enter an API key in the masked field. The field has been cleared.",
                );
                return;
              }
              setBusy("key");
              try {
                const operation = api.saveProviderKey({
                  profileId: current.id,
                  key,
                });
                field.value = "";
                key = "";
                const saved = await operation;
                await refresh();
                setNotice(
                  saved.saved
                    ? "Key stored using OS encryption. No API request was made."
                    : "Key storage cancelled. The input has been cleared.",
                );
                changed();
              } catch {
                report(
                  "The key was not saved. Check OS-protected storage and finish active AI work before trying again. The input has been cleared.",
                );
              } finally {
                field.value = "";
                key = "";
                setBusy(null);
              }
            }}
          >
            <label className="field-label" htmlFor="provider-api-key">
              New API key (masked, not retained in this form)
            </label>
            <input
              className="provider-input"
              id="provider-api-key"
              ref={keyInput}
              type="password"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={1024}
              disabled={!!busy || status?.secureStorageAvailable !== true}
            />
            <div className="button-row spaced">
              <button
                className="primary"
                type="submit"
                disabled={!!busy || status?.secureStorageAvailable !== true}
              >
                Store key securely…
              </button>
              <button
                className="text-button"
                type="button"
                disabled={!!busy}
                onClick={async () => {
                  if (keyInput.current) keyInput.current.value = "";
                  setBusy("key");
                  try {
                    const removed = await api.removeProviderKey(current.id);
                    await refresh();
                    setNotice(
                      removed.removed
                        ? "Stored key removed locally. This does not revoke it at the provider; an enabled environment key may remain available."
                        : "Key removal cancelled.",
                    );
                    changed();
                  } catch {
                    report("The stored key could not be removed.");
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Remove stored key…
              </button>
            </div>
          </form>
          <h3 className="spaced">Explicit connection test</h3>
          <p>
            Saved model for this test:{" "}
            <strong>{current.model || "not set"}</strong> ·{" "}
            {labels[current.provider]}
          </p>
          <p className="muted">
            Save any profile edits before testing; unsaved form changes are not
            used.
          </p>
          <p className="muted">
            A native confirmation sends only “Reply with OK.” to the saved
            model, with a maximum of 16 output tokens. This may incur API
            charges. No files, history, memory, or tools are included.
          </p>
          <div className="button-row">
            <button
              className="secondary"
              disabled={!!busy || !current.model || !status?.configured}
              onClick={async () => {
                setBusy("test");
                setResult(null);
                try {
                  setResult(await api.testProviderProfile(current.id));
                } catch {
                  report(
                    "Connection test could not run. Check the saved model and credential configuration.",
                  );
                } finally {
                  setBusy(null);
                }
              }}
            >
              Review paid connection test…
            </button>
            {busy === "test" && (
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    await api.cancelProviderTest();
                    setNotice(
                      "Cancellation requested. A dispatched request may still incur charges.",
                    );
                  } catch {
                    report("Cancellation could not be requested.");
                  }
                }}
              >
                Cancel connection test
              </button>
            )}
          </div>
          {result && (
            <div className="callout" role="status">
              <h3>Test: {result.status}</h3>
              {result.error && <p>{result.error}</p>}
              {result.text && <pre>{result.text}</pre>}
              <p>
                {result.usage
                  ? `Reported usage: ${result.usage.inputTokens} input + ${result.usage.outputTokens} output = ${result.usage.totalTokens} tokens.`
                  : "Token usage was not reported."}
              </p>
              <p className="muted">
                This reports one test, not a persistent connection or a
                guarantee of future access.
              </p>
            </div>
          )}
        </>
      )}
      <p className="muted" role="status">
        {notice}
      </p>
      <h3 className="spaced">Implemented adapter capabilities</h3>
      <p className="muted">
        These are software capabilities, not proof your account or chosen model
        supports them. Tool use still requires separate permissions.
      </p>
      <div className="file-preview">
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Chat</th>
              <th>Tools</th>
              <th>Reasoning replay</th>
              <th>Voice</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(labels) as ProviderName[]).map((provider) => (
              <tr key={provider}>
                <th>{labels[provider]}</th>
                {(["chat", "tools", "reasoningReplay", "voice"] as const).map(
                  (feature) => (
                    <td key={feature}>
                      {data.capabilities[provider]?.[feature]
                        ? "Supported"
                        : "Not implemented"}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
