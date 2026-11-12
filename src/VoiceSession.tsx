import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { stopNeuralSpeech } from "./localSpeech";
type Session = {
  capture: string;
  speech: string;
  chat: string;
  draftReady: boolean;
  stopped: boolean;
  setCapture: (value: string) => void;
  setSpeech: (value: string) => void;
  setChat: (value: string) => void;
  setDraftReady: (value: boolean) => void;
  registerCapture: (stop: () => void) => () => void;
  registerChat: (stop: () => void | Promise<void>) => () => void;
  stop: (includeChat: boolean) => void;
};
const noop = () => {};
const fallback: Session = {
  capture: "idle",
  speech: "idle",
  chat: "idle",
  draftReady: false,
  stopped: false,
  setCapture: noop,
  setSpeech: noop,
  setChat: noop,
  setDraftReady: noop,
  registerCapture: () => noop,
  registerChat: () => noop,
  stop: noop,
};
const Context = createContext<Session>(fallback);
export const useVoiceSession = () => useContext(Context);
export function VoiceSessionProvider({ children }: { children: ReactNode }) {
  const [capture, updateCapture] = useState("idle"),
    [speech, updateSpeech] = useState("idle"),
    [chat, updateChat] = useState("idle"),
    [draftReady, setDraftReady] = useState(false),
    [stopped, setStopped] = useState(false);
  const stopCapture = useRef(new Set<() => void>()),
    stopChat = useRef<() => void | Promise<void>>(noop);
  const setCapture = useCallback((v: string) => {
    updateCapture(v);
    if (v !== "idle") setStopped(false);
  }, []);
  const setSpeech = useCallback((v: string) => {
    updateSpeech(v);
    if (v !== "idle") setStopped(false);
  }, []);
  const setChat = useCallback((v: string) => {
    updateChat(v);
    if (v !== "idle") setStopped(false);
  }, []);
  const registerCapture = useCallback((fn: () => void) => {
    stopCapture.current.add(fn);
    return () => {
      stopCapture.current.delete(fn);
    };
  }, []);
  const registerChat = useCallback((fn: () => void | Promise<void>) => {
    stopChat.current = fn;
    return () => {
      if (stopChat.current === fn) stopChat.current = noop;
    };
  }, []);
  const stop = useCallback((includeChat: boolean) => {
    void stopNeuralSpeech();
    try {
      for (const stop of stopCapture.current) {
        try {
          stop();
        } catch {
          /* Continue releasing every registered capture. */
        }
      }
    } catch {
      /* Other activities must still stop. */
    }
    try {
      window.dispatchEvent(new Event("sebby:stop-local-speech"));
    } catch {
      /* Continue cleanup. */
    }
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* Device engine unavailable. */
    }
    updateSpeech("idle");
    setStopped(true);
    if (includeChat) {
      try {
        void Promise.resolve(stopChat.current()).catch(() => {});
      } catch {
        /* Continue after synchronous cancellation failure. */
      }
    }
  }, []);
  return (
    <Context.Provider
      value={{
        capture,
        speech,
        chat,
        draftReady,
        stopped,
        setCapture,
        setSpeech,
        setChat,
        setDraftReady,
        registerCapture,
        registerChat,
        stop,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function VoiceSessionStatus() {
  const s = useVoiceSession();
  const labels: Record<string, string> = {
    idle: "Idle",
    starting: "Requesting microphone permission",
    recording: "Recording",
    stopping: "Stopping recording",
    recorded: "Recording ready for review",
    uploading: "Awaiting upload approval or transcribing",
  };
  return (
    <section aria-label="Turn-based voice session">
      <h3>Turn-based voice session</h3>
      <p role="status" aria-live="polite" aria-atomic="true">
        {s.stopped
          ? "Stop requested for local voice activity; remote processing may continue. "
          : ""}
        Microphone: {labels[s.capture] || s.capture}.{" "}
        {s.draftReady ? "Transcript draft ready for review. " : ""}Chat:{" "}
        {s.chat}. Local speech: {s.speech}.
      </p>
      <p>
        By default you use push-to-talk and review a transcription draft before
        sending and choose read-aloud explicitly. Optional conversation mode
        transcribes locally after Stop, prepares a native-reviewed chat request,
        and reads its completed reply with the selected neural voice. The
        separate opt-in hands-free mode keeps the microphone active for local
        wake-phrase recognition and follow-up turns until disabled or expired.
        Cancelling cannot undo provider charges or dispatched processing.
      </p>
      <button onClick={() => s.stop(false)}>Stop voice activity</button>
      <button disabled={s.chat === "idle"} onClick={() => s.stop(true)}>
        Stop voice and current chat
      </button>
    </section>
  );
}
