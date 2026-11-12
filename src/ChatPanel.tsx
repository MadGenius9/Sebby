import { LANGUAGES, replyLanguage } from "./languages";
import {
  VoiceSessionProvider,
  VoiceSessionStatus,
  useVoiceSession,
} from "./VoiceSession";
import { SpeechButton } from "./SpeechButton";
import { VoiceControls } from "./VoiceControls";
import { HandsFreeVoice } from "./HandsFreeVoice";
import { LocalVoiceSettings } from "./LocalVoiceSettings";
import {
  speakNeuralText,
  stopNeuralSpeech,
  voicePreferences,
} from "./localSpeech";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ShieldCheck,
  Code,
  FileText,
  ChevronRight,
} from "lucide-react";
import { PalView } from "./Appearance";
import { ProviderPicker } from "./ProviderSettings";
import { skills } from "./skills";
type Usage = { inputTokens: number; outputTokens: number; totalTokens: number };
type Message = { id: string; role: string; text: string; status: string };
type Conversation = {
  id: string;
  title: string;
  draft?: string;
  messages?: Message[];
  workspaceId?: string;
};
type Run = {
  status: string;
  runId?: string;
  conversationId?: string | null;
  dispatched?: boolean;
  usage?: Usage | null;
  error?: string;
};
type ChatEvent = Run & { type: string; delta?: string; notice?: string };
interface ChatApi {
  startHandsFreeChat?(input: {
    sessionId: string;
    voiceSessionId: string;
    text: string;
  }): Promise<{ runId: string; conversationId: string }>;
  providerStatus(): Promise<{
    configured: boolean;
    model?: string;
    provider?: string;
  }>;
  startChat(input: {
    conversationId?: string;
    text: string;
    includeMemory: boolean;
    skillIds: string[];
    filePaths: string[];
  }): Promise<{ runId: string; conversationId: string }>;
  chatStatus(id?: string): Promise<Run>;
  cancelChat(id: string): Promise<unknown>;
  onChatEvent(callback: (event: ChatEvent) => void): () => void;
  onProviderChanged?(callback: () => void): () => void;
  listConversations(): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation>;
  saveConversationDraft(input: {
    id?: string;
    title?: string;
    text: string;
  }): Promise<Conversation>;
  removeConversation(id: string): Promise<{ removed: boolean }>;
}
type Props = {
  draft: string;
  setDraft: (value: string) => void;
  useSkill: (prompt: string) => void;
  report: (message: string) => void;
};
const terminal = new Set([
  "idle",
  "completed",
  "interrupted",
  "cancelled",
  "error",
  "denied",
  "not-configured",
]);
export function ChatPanel(props: Props) {
  return (
    <VoiceSessionProvider>
      <ChatPanelContent {...props} />
    </VoiceSessionProvider>
  );
}
function ChatPanelContent({ draft, setDraft, useSkill, report }: Props) {
  const voiceSession = useVoiceSession();
  const api =
    typeof (window.sebby as unknown as ChatApi | undefined)?.startChat ===
    "function"
      ? (window.sebby as unknown as ChatApi)
      : null;
  const [language, setLanguage] = useState(replyLanguage);
  const [handsFreeActive, setHandsFreeActive] = useState(false);
  const [speechProvider, setSpeechProvider] = useState(
    () => voicePreferences().provider,
  );
  useEffect(() => {
    const update = () => setSpeechProvider(voicePreferences().provider);
    window.addEventListener("sebby:voice-preferences-changed", update);
    return () =>
      window.removeEventListener("sebby:voice-preferences-changed", update);
  }, []);
  const languageRef = useRef(language);
  languageRef.current = language;
  const [configured, setConfigured] = useState(false),
    [profileLabel, setProfileLabel] = useState(""),
    [items, setItems] = useState<Conversation[]>([]),
    [conversation, setConversation] = useState<Conversation | null>(null),
    [run, setRun] = useState<Run>({ status: "idle" }),
    [partial, setPartial] = useState(""),
    [starting, setStarting] = useState(false),
    [memory, setMemory] = useState(false),
    [files, setFiles] = useState(""),
    [skillIds, setSkillIds] = useState(""),
    [historyBusy, setHistoryBusy] = useState(false),
    [historyNotice, setHistoryNotice] = useState(""),
    [draftTitle, setDraftTitle] = useState("");
  const cancelPendingStart = useRef(false);
  const voiceReply = useRef(false),
    voiceEpoch = useRef(0);
  const handsFreeRun = useRef(false);
  const runId = useRef<string | null>(null),
    startingRef = useRef(false),
    alive = useRef(true),
    loadGeneration = useRef(0),
    reportRef = useRef(report);
  reportRef.current = report;
  const busy = starting || historyBusy || !terminal.has(run.status);
  useEffect(() => {
    if (!draft.trim()) voiceSession.setDraftReady(false);
  }, [draft, voiceSession.setDraftReady]);
  const refreshProfile = useCallback(async () => {
    if (!api) return;
    try {
      const state = await api.providerStatus();
      if (alive.current) {
        setConfigured(state.configured && !!state.model);
        setProfileLabel(
          `${state.provider || "Provider"} · ${state.model || "model not selected"}`,
        );
      }
    } catch {
      if (alive.current) setConfigured(false);
    }
  }, [api]);
  const refreshList = useCallback(async () => {
    if (!api) return;
    try {
      const value = await api.listConversations();
      if (alive.current) setItems(value);
    } catch {
      reportRef.current("Local conversation history could not be loaded.");
    }
  }, [api]);
  const load = useCallback(
    async (id: string, restoreDraft = false) => {
      if (!api) return;
      const generation = ++loadGeneration.current;
      try {
        const value = await api.getConversation(id);
        if (alive.current && generation === loadGeneration.current) {
          setConversation(value);
          if (restoreDraft) setDraft(value.draft || "");
        }
      } catch {
        reportRef.current(
          "That conversation could not be loaded. Select its original workspace before continuing it.",
        );
      }
    },
    [api, setDraft],
  );
  useEffect(() => {
    alive.current = true;
    if (!api)
      return () => {
        alive.current = false;
      };
    void refreshProfile();
    void refreshList();
    const handle = (event: ChatEvent) => {
      if (!alive.current || !event || typeof event.runId !== "string") return;
      if (runId.current && event.runId !== runId.current) return;
      if (!runId.current && !startingRef.current) return;
      runId.current = event.runId;
      if (cancelPendingStart.current) void cancel();
      if (event.conversationId && event.type === "dispatched")
        void load(event.conversationId);
      if (event.type === "delta" && typeof event.delta === "string") {
        setPartial((value) => (value + event.delta).slice(0, 262144));
      }
      if (event.type === "dispatched" && !handsFreeRun.current) {
        setDraft("");
        voiceSession.setDraftReady(false);
      }
      if (event.status) setRun((previous) => ({ ...previous, ...event }));
      if (event.status && terminal.has(event.status)) {
        void refreshList();
        if (event.conversationId) {
          const shouldRead = event.status === "completed" && voiceReply.current;
          const epoch = voiceEpoch.current;
          voiceReply.current = false;
          void load(event.conversationId).then(() => {
            if (alive.current) setPartial("");
          });
          if (shouldRead)
            void api
              .getConversation(event.conversationId)
              .then(async (value) => {
                if (!alive.current || epoch !== voiceEpoch.current) return;
                const message = [...(value.messages || [])]
                  .reverse()
                  .find(
                    (m) => m.role === "assistant" && m.status === "complete",
                  );
                if (!message) return;
                if (voicePreferences().provider !== "neural") {
                  reportRef.current(
                    "Voice turn completed. Select Local neural voice to enable automatic spoken replies; the saved reply is ready to read manually.",
                  );
                  return;
                }
                try {
                  await speakNeuralText(
                    message.text,
                    languageRef.current,
                    (state) => {
                      if (alive.current && epoch === voiceEpoch.current)
                        voiceSession.setSpeech(state);
                    },
                  );
                } catch {
                  if (alive.current && epoch === voiceEpoch.current)
                    reportRef.current(
                      "Reply saved, but local neural speech could not play. Check voice language, service and output device. No cloud fallback.",
                    );
                } finally {
                  if (alive.current && epoch === voiceEpoch.current)
                    voiceSession.setSpeech("idle");
                }
              })
              .catch(() =>
                reportRef.current("Completed voice reply could not be loaded."),
              );
        }
      }
    };
    const unsubscribe = api.onChatEvent(handle),
      unsubscribeProfiles = api.onProviderChanged?.(
        () => void refreshProfile(),
      );
    void api
      .chatStatus()
      .then((state) => {
        if (!alive.current || startingRef.current) return;
        if (state.runId) {
          runId.current = state.runId;
          setRun(state);
          if (state.conversationId) void load(state.conversationId);
        }
      })
      .catch(() => {});
    return () => {
      alive.current = false;
      unsubscribe();
      unsubscribeProfiles?.();
      loadGeneration.current++;
      voiceEpoch.current++;
      voiceReply.current = false;
      void stopNeuralSpeech();
    };
  }, [api, load, refreshList, refreshProfile, setDraft]);
  async function send(
    textOverride?: string,
    voiceTurn = false,
    handsFree?: { sessionId: string; voiceSessionId: string },
  ) {
    const text = textOverride ?? draft;
    if (
      !api ||
      !configured ||
      startingRef.current ||
      historyBusy ||
      (!terminal.has(run.status) && !voiceTurn) ||
      !text.trim()
    ) {
      if (voiceTurn) {
        setDraft(text);
        report(
          "Voice transcript kept as a draft. Wait for current work or configure a model before sending.",
        );
      }
      return false;
    }
    voiceReply.current = voiceTurn;
    handsFreeRun.current = !!handsFree;
    const selectedFiles = files
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean),
      selectedSkills = skillIds
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    if (
      !handsFree &&
      (selectedFiles.length > 5 ||
        selectedSkills.length > 5 ||
        new Set(selectedFiles).size !== selectedFiles.length ||
        new Set(selectedSkills).size !== selectedSkills.length)
    ) {
      report("Choose at most five distinct file paths and five skill IDs.");
      return;
    }
    cancelPendingStart.current = false;
    startingRef.current = true;
    setStarting(true);
    runId.current = null;
    setPartial("");
    setRun({ status: "preparing" });
    try {
      if (handsFree && !api.startHandsFreeChat)
        throw Error("Hands-free chat unavailable");
      const outgoingText =
        language === "en"
          ? text
          : `${text}\n\nPlease reply in ${LANGUAGES.find(([code]) => code === language)?.[1] || "English"}. I may speak or type in another language. Keep code and identifiers unchanged.`;
      const next =
        handsFree && api.startHandsFreeChat
          ? await api.startHandsFreeChat({ ...handsFree, text: outgoingText })
          : await api.startChat({
              ...(conversation ? { conversationId: conversation.id } : {}),
              text: outgoingText,
              includeMemory: memory,
              filePaths: selectedFiles,
              skillIds: selectedSkills,
            });
      runId.current = next.runId;
      if (cancelPendingStart.current) await cancel();
      const state = await api.chatStatus(next.runId);
      if (alive.current) {
        setRun(state);
        await load(next.conversationId);
        if (terminal.has(state.status)) await refreshList();
      }
      return true;
    } catch {
      voiceReply.current = false;
      if (alive.current)
        setRun({
          status: "error",
          error:
            "Chat status could not be confirmed. Check local history and the selected profile/workspace before retrying; an already dispatched request may incur charges.",
        });
      report(
        "Chat could not start. Review the selected profile, original workspace and context. No automatic retry was made.",
      );
      return false;
    } finally {
      startingRef.current = false;
      if (alive.current) setStarting(false);
    }
  }
  async function cancel() {
    voiceReply.current = false;
    voiceEpoch.current++;
    void stopNeuralSpeech();
    if (!api) return;
    if (startingRef.current) cancelPendingStart.current = true;
    if (!runId.current) return;
    const ownedRunId = runId.current;
    cancelPendingStart.current = false;
    try {
      await api.cancelChat(ownedRunId);
      const state = await api.chatStatus(ownedRunId);
      if (alive.current) setRun(state);
    } catch {
      report(
        "Cancellation could not be confirmed. Check the task status; do not send a duplicate request.",
      );
    }
  }
  useEffect(() => {
    const interrupt = () => {
      voiceEpoch.current++;
      voiceReply.current = false;
      void stopNeuralSpeech();
    };
    window.addEventListener("sebby:voice-interrupt", interrupt);
    window.addEventListener("sebby:stop-local-speech", interrupt);
    return () => {
      window.removeEventListener("sebby:voice-interrupt", interrupt);
      window.removeEventListener("sebby:stop-local-speech", interrupt);
    };
  }, []);
  useEffect(
    () => voiceSession.registerChat(cancel),
    [api, voiceSession.registerChat],
  );
  useEffect(() => {
    voiceSession.setChat(
      terminal.has(run.status)
        ? "idle"
        : run.dispatched || run.status === "streaming"
          ? "waiting for response"
          : "preparing or awaiting approval",
    );
  }, [run.status, run.dispatched, voiceSession.setChat]);
  async function saveDraftLocally() {
    if (!api?.saveConversationDraft || busy || !draft.trim()) return;
    setHistoryBusy(true);
    setHistoryNotice("");
    try {
      const saved = await api.saveConversationDraft({
        ...(conversation
          ? { id: conversation.id }
          : {
              title:
                draftTitle.trim() || draft.trim().split("\n")[0].slice(0, 100),
            }),
        text: draft,
      });
      if (alive.current) {
        setConversation(saved);
        setHistoryNotice("Draft saved locally. No message sent.");
      }
      await refreshList();
    } catch {
      report("The local draft could not be saved. Keep a copy before closing.");
    } finally {
      if (alive.current) setHistoryBusy(false);
    }
  }
  async function deleteConversation() {
    if (!api?.removeConversation || busy || !conversation) return;
    const selectedId = conversation.id;
    setHistoryBusy(true);
    setHistoryNotice("");
    try {
      const result = await api.removeConversation(selectedId);
      if (result.removed && alive.current) {
        loadGeneration.current++;
        setConversation(null);
        runId.current = null;
        setRun({ status: "idle" });
        setPartial("");
        setHistoryNotice(
          "Conversation deleted. The current unsent draft is retained locally.",
        );
        await refreshList();
      } else if (alive.current)
        setHistoryNotice("Deletion cancelled. Conversation retained.");
    } catch {
      report(
        "Conversation deletion could not be confirmed. Refresh local history before trying again.",
      );
    } finally {
      if (alive.current) setHistoryBusy(false);
    }
  }
  function newConversation() {
    if (busy) return;
    loadGeneration.current++;
    setConversation(null);
    runId.current = null;
    setRun({ status: "idle" });
    setPartial("");
  }
  return (
    <div className="chat">
      {!conversation?.messages?.length && !partial && (
        <div className="welcome">
          <PalView />
          <h2>
            What shall we <em>build?</em>
          </h2>
          <p>A fresh project. A tricky bug. A little less busywork.</p>
          <div className="suggestions">
            {skills.map((skill, index) => (
              <button
                key={skill.id}
                disabled={busy}
                onClick={() => useSkill(skill.prompt)}
              >
                {index === 1 ? <Code size={21} /> : <FileText size={21} />}
                <span>{skill.name}</span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </div>
      )}
      {api && (
        <>
          <ProviderPicker
            report={report}
            onChanged={() => void refreshProfile()}
            disabled={busy || handsFreeActive}
          />
          <details className="saved-drafts">
            <summary>Conversation history · all projects</summary>
            <label className="field-label" htmlFor="chat-history">
              Saved conversation
            </label>
            <select
              id="chat-history"
              disabled={busy}
              value={conversation?.id || ""}
              onChange={(event) => {
                if (event.target.value) {
                  runId.current = null;
                  setRun({ status: "idle" });
                  setPartial("");
                  void load(event.target.value, true);
                } else newConversation();
              }}
            >
              <option value="">New conversation</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            <button
              className="text-button"
              disabled={busy}
              onClick={newConversation}
            >
              New conversation
            </button>
            {!conversation && (
              <>
                <label className="field-label" htmlFor="chat-draft-title">
                  New draft title (optional)
                </label>
                <input
                  id="chat-draft-title"
                  value={draftTitle}
                  maxLength={100}
                  disabled={busy}
                  onChange={(event) => setDraftTitle(event.target.value)}
                />
              </>
            )}
            <button
              className="text-button"
              disabled={busy || !draft.trim() || !api.saveConversationDraft}
              onClick={saveDraftLocally}
            >
              Save draft locally
            </button>
            <button
              className="text-button"
              disabled={busy || !conversation || !api.removeConversation}
              onClick={deleteConversation}
            >
              Delete selected conversation
            </button>
            {historyNotice && <p role="status">{historyNotice}</p>}
            <p className="muted">
              History is local. Continue a saved conversation only in its
              original workspace. Sent history may be included in the next
              approved request.
            </p>
          </details>
        </>
      )}
      {conversation?.messages?.map((message) => (
        <article className="skill" key={message.id}>
          <h3>
            {message.role === "assistant" ? "Sebby" : "You"}{" "}
            <small>
              {message.status === "interrupted"
                ? "Interrupted · partial response"
                : message.status === "unsent"
                  ? "Unsent"
                  : message.role === "user"
                    ? "Dispatched · receipt not guaranteed"
                    : "Saved response"}
            </small>
          </h3>
          <pre className="file-preview">{message.text}</pre>
          {message.role === "assistant" && (
            <SpeechButton text={message.text} language={language} />
          )}
        </article>
      ))}
      {partial && (
        <article aria-label="Provisional streaming response">
          <h3>Sebby · streaming, not yet saved</h3>
          <pre className="file-preview">{partial}</pre>
        </article>
      )}
      {run.status !== "idle" && (
        <div role="status" className="scope">
          <span>
            Chat: {run.status}
            {run.error ? ` · ${run.error}` : ""}
          </span>
        </div>
      )}
      {run.usage && (
        <p className="muted">
          Provider-reported usage: {run.usage.inputTokens} input +{" "}
          {run.usage.outputTokens} output = {run.usage.totalTokens} tokens. Not
          a price.
        </p>
      )}
      {api && (
        <details>
          <summary>Choose outgoing context · optional</summary>
          <fieldset disabled={busy}>
            <legend>Nothing extra is included unless selected</legend>
            <div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={memory}
                  onChange={(event) => setMemory(event.target.checked)}
                />
                Include workspace memory
              </label>
              <label className="field-label" htmlFor="chat-files">
                Workspace file paths (up to five, one per line)
              </label>
              <textarea
                id="chat-files"
                className="note"
                value={files}
                onChange={(event) => setFiles(event.target.value)}
              />
              <label className="field-label" htmlFor="chat-skills">
                Skill IDs (up to five, comma-separated)
              </label>
              <input
                id="chat-skills"
                value={skillIds}
                onChange={(event) => setSkillIds(event.target.value)}
              />
              <p className="muted">
                Native approval lists the outgoing context and potential API
                charges. This chat cannot execute tools or change files.
              </p>
            </div>
          </fieldset>
        </details>
      )}
      <label className="field-label">
        Reply language
        <select
          aria-label="Reply language"
          value={language}
          disabled={busy}
          onChange={(e) => {
            setLanguage(e.target.value);
            try {
              localStorage.setItem("sebby.reply-language", e.target.value);
            } catch {
              report("Language preference could not be saved.");
            }
          }}
        >
          {LANGUAGES.map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        You can speak or type in a different language. Local reading needs an
        installed voice for the selected reply language.
      </p>
      <VoiceSessionStatus />
      <LocalVoiceSettings language={language} />
      <HandsFreeVoice
        language={language}
        blocked={busy || !!draft.trim() || speechProvider !== "neural"}
        onActive={setHandsFreeActive}
        onInterrupt={async () => {
          await cancel();
          voiceSession.setSpeech("idle");
        }}
        onTurn={async (text, sessionId, voiceSessionId) => {
          if (draft.trim()) {
            report(
              "Disable hands-free and review your existing draft before continuing.",
            );
            return false;
          }
          return !!(await send(text, true, { sessionId, voiceSessionId }));
        }}
      />
      <VoiceControls
        disabled={handsFreeActive}
        report={report}
        onTranscript={(text) => setDraft(draft ? `${draft}\n${text}` : text)}
        onConversationTranscript={(text) => {
          if (draft.trim()) {
            setDraft(`${draft}\n${text}`);
            report(
              "Spoken text appended to your existing draft. Review and send it explicitly; your unsent work was preserved.",
            );
            return;
          }
          setDraft(text);
          void send(text, true);
        }}
      />
      <button
        className="secondary"
        disabled={
          busy || !configured || !draft.trim() || speechProvider !== "neural"
        }
        onClick={() => void send(draft, true)}
      >
        Review, send and speak reply
      </button>
      <div className="composer">
        <label className="sr-only" htmlFor="draft">
          Your local chat draft
        </label>
        <textarea
          id="draft"
          disabled={busy}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Describe what you want to make…"
        />
        <div className="composer-bottom">
          <small>
            <ShieldCheck size={14} />
            {configured
              ? `${profileLabel}. API usage requires approval.`
              : "AI is not connected. Your drafts stay on this device."}
          </small>
          {starting || !terminal.has(run.status) ? (
            <button
              className="secondary"
              onClick={cancel}
              disabled={!runId.current}
            >
              Cancel response
            </button>
          ) : (
            <button
              className="send"
              onClick={() => void send()}
              disabled={busy || !configured || !draft.trim()}
              aria-label={
                configured
                  ? "Review and send chat"
                  : "Send unavailable: AI not connected"
              }
              title={
                configured
                  ? "Review context and API usage before sending"
                  : "Configure a provider profile in Settings"
              }
            >
              <ArrowUp size={22} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
