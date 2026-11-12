import { useEffect, useRef, useState } from "react";
import { ProviderPicker } from "../ProviderSettings";
import { VoiceControls } from "../VoiceControls";
import { VoiceSessionProvider } from "../VoiceSession";
import { parseScene, scenePrompt, type SceneDocument } from "./model";
type Api = {
  providerStatus(): Promise<{ configured: boolean; model: string }>;
  startChat(input: {
    text: string;
    includeMemory: boolean;
    filePaths: string[];
    skillIds: string[];
  }): Promise<{ runId: string; conversationId: string }>;
  chatStatus(id: string): Promise<{ status: string; error?: string }>;
  cancelChat(id: string): Promise<unknown>;
  getConversation(
    id: string,
  ): Promise<{ messages: { role: string; status: string; text: string }[] }>;
};
export function Assistant({
  scene,
  apply,
}: {
  scene: SceneDocument;
  apply: (doc: SceneDocument) => void;
}) {
  const api = window.sebby as unknown as Api | undefined;
  const [request, setRequest] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [proposal, setProposal] = useState<{
      scene: SceneDocument;
      base: string;
    } | null>(null);
  const owned = useRef(""),
    epoch = useRef(0),
    busyRef = useRef(false),
    alive = useRef(true),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    latest = useRef(scene);
  latest.current = scene;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      epoch.current++;
      clearTimeout(timer.current);
      if (owned.current) void api?.cancelChat(owned.current).catch(() => {});
    };
  }, [api]);
  async function generate() {
    if (!api?.startChat || busyRef.current || !request.trim()) return;
    busyRef.current = true;
    setBusy(true);
    setProposal(null);
    setStatus("Preparing scene request…");
    const generation = ++epoch.current,
      base = JSON.stringify(scene);
    try {
      const prompt = scenePrompt(scene, request),
        provider = await api.providerStatus();
      if (!alive.current || generation !== epoch.current) return;
      if (!provider.configured || !provider.model)
        throw Error("Choose a configured AI profile in Settings first.");
      const run = await api.startChat({
        text: prompt,
        includeMemory: false,
        filePaths: [],
        skillIds: [],
      });
      if (!alive.current || generation !== epoch.current) {
        await api.cancelChat(run.runId);
        return;
      }
      owned.current = run.runId;
      const deadline = Date.now() + 240000;
      const poll = async () => {
        try {
          if (!alive.current || generation !== epoch.current) return;
          const result = await api.chatStatus(run.runId);
          if (!alive.current || generation !== epoch.current) return;
          if (result.status === "completed") {
            const conversation = await api.getConversation(run.conversationId);
            if (!alive.current || generation !== epoch.current) return;
            const message = [...conversation.messages]
              .reverse()
              .find((m) => m.role === "assistant" && m.status === "complete");
            if (!message)
              throw Error("No complete scene proposal was returned.");
            const next = parseScene(message.text);
            setProposal({ scene: next, base });
            setStatus(
              "Scene proposal ready. Review the object list before applying.",
            );
            owned.current = "";
            busyRef.current = false;
            setBusy(false);
            return;
          }
          if (
            [
              "error",
              "cancelled",
              "denied",
              "not-configured",
              "interrupted",
              "idle",
            ].includes(result.status)
          )
            throw Error(
              result.error ||
                `Scene request: ${result.status}. No changes applied.`,
            );
          if (Date.now() > deadline) {
            await api.cancelChat(run.runId);
            throw Error("Scene request timed out. No changes applied.");
          }
          setStatus(`Sebby: ${result.status}`);
          timer.current = setTimeout(() => void poll(), 600);
        } catch (e) {
          if (alive.current && generation === epoch.current) {
            setStatus((e as Error).message);
            busyRef.current = false;
            setBusy(false);
            if (owned.current)
              void api.cancelChat(owned.current).catch(() => {});
            owned.current = "";
          }
        }
      };
      void poll();
    } catch (e) {
      if (alive.current && generation === epoch.current) {
        setStatus((e as Error).message);
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section className="studio-assistant">
      <h3>Build with Sebby</h3>
      <p>
        Describe a model or a change. Your selected AI receives the scene and
        this request, then returns a proposal you can apply.
      </p>
      <ProviderPicker report={setStatus} disabled={busy} />
      <label htmlFor="studio-request">Scene instruction</label>
      <textarea
        id="studio-request"
        value={request}
        disabled={busy}
        maxLength={3000}
        onChange={(e) => setRequest(e.target.value)}
        placeholder="Give the robot copper armor and larger shoulders…"
      />
      <div className="button-row">
        <button
          className="primary"
          disabled={busy || !api?.startChat || !request.trim()}
          onClick={() => void generate()}
        >
          Generate scene proposal
        </button>
        {busy && (
          <button
            onClick={() => {
              epoch.current++;
              clearTimeout(timer.current);
              if (owned.current)
                void api?.cancelChat(owned.current).catch(() => {});
              owned.current = "";
              busyRef.current = false;
              setBusy(false);
              setStatus("Cancellation requested. No scene changes applied.");
            }}
          >
            Cancel generation
          </button>
        )}
      </div>
      {!api?.startChat && (
        <p>
          AI generation is available in the desktop app. Local editing works
          here.
        </p>
      )}
      <p role="status">{status}</p>
      {proposal && (
        <div className="studio-proposal">
          <h4>
            {proposal.scene.name} · {proposal.scene.parts.length} objects
          </h4>
          <p>
            {proposal.scene.parts.map((p) => p.name).join(", ") ||
              "Empty scene"}
          </p>
          <details>
            <summary>Review full scene data</summary>
            <pre>{JSON.stringify(proposal.scene, null, 2)}</pre>
          </details>
          <button
            className="primary"
            onClick={() => {
              if (proposal.base !== JSON.stringify(latest.current)) {
                setStatus(
                  "The scene changed after generation started. Generate a new proposal to preserve your edits.",
                );
                return;
              }
              apply(proposal.scene);
              setProposal(null);
              setStatus("AI proposal applied to the scene. Undo is available.");
            }}
          >
            Apply scene proposal
          </button>
          <button onClick={() => setProposal(null)}>Discard proposal</button>
        </div>
      )}
      <details>
        <summary>Dictate a scene instruction</summary>
        <VoiceSessionProvider>
          <VoiceControls
            report={setStatus}
            onTranscript={(text) => {
              if (!busyRef.current) setRequest(text);
            }}
          />
        </VoiceSessionProvider>
      </details>
    </section>
  );
}
