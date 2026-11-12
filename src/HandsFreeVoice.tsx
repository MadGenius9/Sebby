import { useEffect, useRef, useState } from "react";
import { useVoiceSession } from "./VoiceSession";
import { stopNeuralSpeech, voicePreferences } from "./localSpeech";
import { TurnDetector, wakeTurn } from "./handsFree";

type API = {
  startHandsFree(input: { language: string }): Promise<{ sessionId: string }>;
  stopHandsFree(id: string): Promise<unknown>;
  transcribeHandsFree(input: {
    sessionId: string;
    bytes: Uint8Array;
    mimeType: string;
    durationMs: number;
  }): Promise<{ status: string; text?: string; code?: string }>;
  beginHandsFreeChat(): Promise<{ status: string; sessionId?: string }>;
  endHandsFreeChat(id: string): Promise<unknown>;
  onProviderChanged?(fn: () => void): () => void;
  onHandsFreeExpired?(fn: () => void): () => void;
};
export function HandsFreeVoice({
  onTurn,
  onInterrupt,
  onActive,
  blocked,
  language,
}: {
  onTurn(
    text: string,
    chatSessionId: string,
    voiceSessionId: string,
  ): Promise<boolean>;
  onInterrupt(): Promise<void>;
  onActive(active: boolean): void;
  blocked: boolean;
  language: string;
}) {
  const api = (window.sebby || {}) as unknown as Partial<API>;
  const session = useVoiceSession();
  const [active, setActive] = useState(false);
  const [micLive, setMicLive] = useState(false);
  const [headphones, setHeadphones] = useState(false);
  const [note, setNote] = useState("Off · microphone released");
  const enabled = useRef(false),
    epoch = useRef(0),
    alive = useRef(true);
  const media = useRef<MediaStream | null>(null),
    context = useRef<AudioContext | null>(null);
  const rec = useRef<MediaRecorder | null>(null),
    timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const lease = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const voiceId = useRef(""),
    chatId = useRef(""),
    processing = useRef(false),
    awakeUntil = useRef(0);
  const callbacks = useRef({ onTurn, onInterrupt, onActive });
  callbacks.current = { onTurn, onInterrupt, onActive };
  const state = useRef({ speech: session.speech, chat: session.chat });
  state.current = { speech: session.speech, chat: session.chat };
  const stop = () => {
    const wasEnabled = enabled.current;
    enabled.current = false;
    epoch.current++;
    processing.current = false;
    clearInterval(timer.current);
    clearTimeout(lease.current);
    if (rec.current) {
      rec.current.onstop = null;
      rec.current.ondataavailable = null;
      try {
        if (rec.current.state !== "inactive") rec.current.stop();
      } catch {
        /* tracks below */
      }
    }
    rec.current = null;
    try {
      media.current?.getTracks().forEach((t) => {
        try {
          t.onended = null;
          t.stop();
        } catch {
          /* Release other tracks and revoke native authority. */
        }
      });
    } catch {
      /* Native sessions must still be revoked. */
    }
    media.current = null;
    try {
      void context.current?.close().catch(() => {});
    } catch {
      /* Continue revoking permissions. */
    }
    context.current = null;
    const v = voiceId.current,
      c = chatId.current;
    voiceId.current = "";
    chatId.current = "";
    if (v || wasEnabled) void api.stopHandsFree?.(v).catch(() => {});
    if (c || wasEnabled) void api.endHandsFreeChat?.(c).catch(() => {});
    if (wasEnabled || v || c) {
      try {
        void Promise.resolve(callbacks.current.onInterrupt()).catch(() => {});
      } catch {
        /* Device release and UI state must still finish. */
      }
    }
    try {
      callbacks.current.onActive(false);
    } catch {
      /* Capture is already released. */
    }
    session.setCapture("idle");
    if (alive.current) {
      setActive(false);
      setMicLive(false);
      setNote("Off · microphone released");
    }
  };
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(
    () => session.registerCapture(() => stopRef.current()),
    [session.registerCapture],
  );
  useEffect(() => {
    alive.current = true;
    const unsubscribe = api.onProviderChanged?.(() => {
      if (enabled.current) stopRef.current();
    });
    const expired = api.onHandsFreeExpired?.(() => {
      if (enabled.current) {
        stopRef.current();
        setNote("Session expired · microphone released");
      }
    });
    const preferences = () => {
      if (enabled.current) stopRef.current();
    };
    window.addEventListener("sebby:voice-preferences-changed", preferences);
    return () => {
      alive.current = false;
      unsubscribe?.();
      expired?.();
      window.removeEventListener(
        "sebby:voice-preferences-changed",
        preferences,
      );
      stopRef.current();
    };
  }, []);
  useEffect(() => {
    if (enabled.current) stopRef.current();
  }, [language]);
  async function start() {
    if (
      enabled.current ||
      blocked ||
      !headphones ||
      voicePreferences().provider !== "neural"
    )
      return;
    session.stop(true);
    const generation = ++epoch.current;
    enabled.current = true;
    setActive(true);
    callbacks.current.onActive(true);
    setNote("Requesting session approval · microphone not yet active");
    session.setCapture("starting");
    const valid = () =>
      enabled.current && alive.current && epoch.current === generation;
    try {
      if (
        !api.beginHandsFreeChat ||
        !api.startHandsFree ||
        !api.transcribeHandsFree
      )
        throw Error("Hands-free APIs unavailable");
      const chat = await api.beginHandsFreeChat();
      if (!valid()) {
        void api.endHandsFreeChat?.(chat.sessionId || "").catch(() => {});
        return;
      }
      if (chat.status !== "ready" || !chat.sessionId)
        throw Error("Local chat session declined");
      chatId.current = chat.sessionId;
      const voice = await api.startHandsFree({ language: "en" });
      if (!valid()) {
        void api.stopHandsFree?.(voice.sessionId);
        return;
      }
      voiceId.current = voice.sessionId;
      const mime = ["audio/webm;codecs=opus", "audio/webm"].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      if (!mime) throw Error("Recording format unavailable");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (!valid()) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      media.current = stream;
      setMicLive(true);
      stream.getTracks().forEach((t) => {
        t.onended = () => {
          stopRef.current();
          setNote("Microphone disconnected · hands-free disabled");
        };
      });
      const ac = new AudioContext();
      context.current = ac;
      const analyser = ac.createAnalyser();
      analyser.fftSize = 512;
      ac.createMediaStreamSource(stream).connect(analyser);
      await ac.resume();
      if (!valid()) return;
      awakeUntil.current = 0;
      let interrupted = false;
      const detector = new TurnDetector();
      const samples = new Float32Array(analyser.fftSize);
      const segment = () => {
        if (!valid()) return;
        detector.reset(performance.now());
        interrupted = false;
        const recorder = new MediaRecorder(stream, { mimeType: mime });
        rec.current = recorder;
        const eligible = !processing.current;
        const chunks: Blob[] = [];
        let size = 0;
        recorder.ondataavailable = (event) => {
          if (!valid()) return;
          size += event.data.size;
          if (size > 5 * 1024 * 1024) {
            stopRef.current();
            setNote("Audio limit reached · hands-free disabled");
            return;
          }
          chunks.push(event.data);
        };
        recorder.onerror = () => {
          stopRef.current();
          setNote("Recording device error · hands-free disabled");
        };
        recorder.onstop = () => {
          const heard = detector.heard,
            durationMs = Math.min(
              30000,
              Math.max(1, performance.now() - detector.start),
            );
          if (!valid()) return;
          // No backlog: ignore audio recorded while a previous local recognition drains.
          if (heard && eligible && !processing.current) {
            processing.current = true;
            setNote("Recognizing locally · microphone active");
            void (async () => {
              let bytes: Uint8Array | undefined;
              try {
                bytes = new Uint8Array(
                  await new Blob(chunks, { type: mime }).arrayBuffer(),
                );
                if (!valid()) return;
                let result = await api.transcribeHandsFree!({
                  sessionId: voiceId.current,
                  bytes,
                  mimeType: mime,
                  durationMs,
                });
                for (
                  let retry = 0;
                  valid() && result.code === "LOCAL_VOICE_BUSY" && retry < 20;
                  retry++
                ) {
                  setNote(
                    "Previous local speech is finishing · waiting briefly before recognition",
                  );
                  await new Promise((resolve) => setTimeout(resolve, 500));
                  if (!valid()) return;
                  result = await api.transcribeHandsFree!({
                    sessionId: voiceId.current,
                    bytes,
                    mimeType: mime,
                    durationMs,
                  });
                }
                if (!valid()) return;
                if (result.status !== "completed")
                  throw Error("Local recognition unavailable");
                const turn = wakeTurn(
                  result.text || "",
                  Date.now() < awakeUntil.current,
                );
                if (turn.kind === "disable") {
                  stopRef.current();
                  return;
                }
                if (turn.kind === "sleep") {
                  awakeUntil.current = 0;
                  await callbacks.current.onInterrupt();
                }
                if (turn.kind === "interrupt")
                  await callbacks.current.onInterrupt();
                if (turn.kind === "turn") {
                  await callbacks.current.onInterrupt();
                  if (!valid()) return;
                  awakeUntil.current = Date.now() + 45000;
                  const sent = await callbacks.current.onTurn(
                    turn.text,
                    chatId.current,
                    voiceId.current,
                  );
                  if (!valid()) return;
                  if (!sent)
                    throw Error(
                      "Local chat not available; check the draft and model",
                    );
                }
                if (valid())
                  setNote(
                    Date.now() < awakeUntil.current
                      ? "Conversation active · speak to continue or interrupt"
                      : "Listening locally for Hello Sebby",
                  );
              } catch {
                if (valid()) {
                  stopRef.current();
                  setNote(
                    "Local recognition or chat failed · hands-free disabled. No cloud fallback or chat retry.",
                  );
                }
              } finally {
                bytes?.fill(0);
                if (valid()) {
                  processing.current = false;
                  if (rec.current?.state === "recording" && !detector.heard)
                    rec.current.stop();
                }
              }
            })();
          }
          segment();
        };
        recorder.start(250);
      };
      segment();
      session.setCapture("hands-free listening");
      setNote("Listening locally for Hello Sebby");
      timer.current = setInterval(() => {
        if (!valid() || rec.current?.state !== "recording") return;
        if (awakeUntil.current > 0) {
          if (state.current.chat !== "idle" || state.current.speech !== "idle")
            awakeUntil.current = Date.now() + 45000;
          else if (Date.now() >= awakeUntil.current) {
            awakeUntil.current = 0;
            if (!processing.current)
              setNote("Listening locally for Hello Sebby");
          }
        }
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(
          samples.reduce((sum, n) => sum + n * n, 0) / samples.length,
        );
        const detection = detector.sample(rms, performance.now());
        if (
          detection.interrupt &&
          !interrupted &&
          !processing.current &&
          (state.current.speech !== "idle" || state.current.chat !== "idle")
        ) {
          interrupted = true;
          void stopNeuralSpeech();
          void callbacks.current.onInterrupt();
          session.setSpeech("idle");
        }
        if (detection.finish) rec.current.stop();
      }, 100);
      lease.current = setTimeout(
        () => {
          stopRef.current();
          setNote("30-minute session ended · microphone released");
        },
        30 * 60 * 1000,
      );
    } catch {
      if (valid()) {
        stopRef.current();
        setNote(
          "Hands-free unavailable or permission declined · microphone released. Select local Ollama, local neural speech and a working microphone.",
        );
      }
    }
  }
  return (
    <section aria-label="Hands-free local conversation" className="scope">
      <h3>Hands-free · Hello Sebby</h3>
      <p>
        Off by default. Enable once, approve local chat and microphone access,
        then say “Hello Sebby”. Follow-up turns stay active for 45 seconds; say
        “go to sleep” to require the wake phrase again, or “stop listening” to
        release the microphone.
      </p>
      <p>
        English recognition in this first version. Local Whisper recognizes
        speech segments, so waking takes several seconds. Audio stays in bounded
        memory and is discarded; accepted turns and replies are saved in a
        separate local chat. No tools, extra memory/files or cloud fallback.
        Session ends after 30 minutes, navigation or Stop.
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={headphones}
          disabled={active}
          onChange={(e) => setHeadphones(e.target.checked)}
        />
        I am using headphones/headset. Speaker playback is unsupported for
        hands-free interruption because it can trigger the microphone.
      </label>
      <button
        disabled={
          active ||
          blocked ||
          !headphones ||
          !api.startHandsFree ||
          voicePreferences().provider !== "neural"
        }
        onClick={() => void start()}
      >
        Enable hands-free listening
      </button>
      {active && (
        <button onClick={() => stopRef.current()}>
          Disable hands-free and release microphone
        </button>
      )}
      <p role="status" aria-live="polite">
        {micLive ? "MICROPHONE ACTIVE · " : active ? "SESSION ENABLING · " : ""}
        {note}
      </p>
    </section>
  );
}
