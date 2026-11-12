import { useVoiceSession } from "./VoiceSession";
import { useEffect, useRef, useState } from "react";
import { LANGUAGES } from "./languages";
import { stopNeuralSpeech, type LocalVoiceStatus } from "./localSpeech";
type Result = { status: string; text?: string; error?: string };
type VoiceApi = {
  localVoiceStatus?(): Promise<LocalVoiceStatus>;
  onProviderChanged?(callback: () => void): () => void;
  voiceStatus(): Promise<{
    configured: boolean;
    provider: string;
    model?: string;
  }>;
  beginVoiceCapture(input: {
    model: string;
    provider?: string;
    language?: string;
  }): Promise<{ captureId: string }>;
  endVoiceCapture(id: string): Promise<unknown>;
  transcribeVoice(input: {
    captureId: string;
    bytes: Uint8Array;
    mimeType: string;
    durationMs: number;
  }): Promise<Result>;
  cancelVoice(id: string): Promise<unknown>;
};
export function VoiceControls({
  report,
  onTranscript,
  onConversationTranscript,
}: {
  report: (message: string) => void;
  onTranscript: (text: string) => void;
  onConversationTranscript?: (text: string) => void;
}) {
  const session = useVoiceSession();
  const api = (window as unknown as { sebby?: VoiceApi }).sebby;
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState(
    api?.localVoiceStatus ? "local" : "openai",
  );
  const [inputLanguage, setInputLanguage] = useState("auto");
  const [localStatus, setLocalStatus] = useState<LocalVoiceStatus | null>(null);
  const [conversationMode, setConversationMode] = useState(false);
  const autoTranscribe = useRef(false);
  const silenceTimer = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined,
  );
  const audioContext = useRef<AudioContext | null>(null);
  const availabilityEpoch = useRef(0);
  const [ready, setReady] = useState(false),
    [phase, setPhase] = useState("idle"),
    [note, setNote] = useState(
      "Select an OpenAI profile in Settings, then enter an audio model below.",
    );
  const capture = useRef(""),
    recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    chunks = useRef<Blob[]>([]),
    size = useRef(0),
    started = useRef(0),
    duration = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    alive = useRef(true),
    generation = useRef(0),
    phaseRef = useRef("idle");
  const change = (next: string) => {
    phaseRef.current = next;
    session.setCapture(next);
    if (alive.current) setPhase(next);
  };
  const release = () => {
    clearTimeout(timer.current);
    clearInterval(silenceTimer.current);
    const context = audioContext.current;
    audioContext.current = null;
    if (context) void context.close().catch(() => {});
    const current = stream.current;
    stream.current = null;
    try {
      current?.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* Release other tracks too. */
        }
      });
    } catch {
      /* No additional media is requested. */
    }
  };
  const discard = () => {
    generation.current++;
    const id = capture.current;
    capture.current = "";
    if (recorder.current) {
      recorder.current.onstop = null;
      recorder.current.ondataavailable = null;
      try {
        if (recorder.current.state !== "inactive") recorder.current.stop();
      } catch {
        /* Tracks still release below. */
      }
    }
    recorder.current = null;
    release();
    chunks.current = [];
    size.current = 0;
    if (id) void api?.cancelVoice(id).catch(() => {});
    change("idle");
  };
  useEffect(
    () => session.registerCapture(discard),
    [api, session.registerCapture],
  );
  async function refreshAvailability() {
    if (!api?.voiceStatus || phaseRef.current !== "idle") return;
    const checking = ++availabilityEpoch.current;
    try {
      if (provider === "local") {
        const s = await api.localVoiceStatus?.();
        if (
          alive.current &&
          phaseRef.current === "idle" &&
          checking === availabilityEpoch.current
        ) {
          setLocalStatus(s || null);
          setReady(!!s?.available);
          setNote(
            s?.available
              ? "Local Whisper-small is ready. Audio is processed on this PC; recordings are never saved."
              : "Start the local voice service. Model assets must be installed first.",
          );
        }
        return;
      }
      const s = await api.voiceStatus();
      if (
        alive.current &&
        phaseRef.current === "idle" &&
        checking === availabilityEpoch.current
      ) {
        setReady(s.configured && s.provider === "openai");
        setNote(
          s.configured && s.provider === "openai"
            ? "Enter an audio transcription model below. Recording stays in memory until you approve upload."
            : "OpenAI is unavailable or busy. Select a configured OpenAI profile in Settings, then refresh availability.",
        );
      }
    } catch {
      if (alive.current && checking === availabilityEpoch.current) {
        setReady(false);
        setNote("Voice availability could not be checked.");
      }
    }
  }
  useEffect(() => {
    alive.current = true;
    void refreshAvailability();
    const unsubscribe = api?.onProviderChanged?.(() => {
      void refreshAvailability();
    });
    return () => {
      alive.current = false;
      availabilityEpoch.current++;
      unsubscribe?.();
      discard();
    };
  }, [api, provider]);
  async function start() {
    if (!api || !ready || phaseRef.current !== "idle") return;
    // Interrupt before permission dialogs and pending device access.
    session.stop(true);
    window.dispatchEvent(new Event("sebby:voice-interrupt"));
    const stoppedSpeech = stopNeuralSpeech();
    change("starting");
    const epoch = ++generation.current;
    try {
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
        (t) => MediaRecorder.isTypeSupported(t),
      );
      if (!mime) throw Error("unsupported");
      await stoppedSpeech;
      if (!alive.current || epoch !== generation.current) return;
      const grant = await api.beginVoiceCapture(
        provider === "local"
          ? {
              model: "whisper-small",
              provider: "local",
              language: inputLanguage,
            }
          : { model },
      );
      if (!alive.current || epoch !== generation.current) {
        void api.cancelVoice(grant.captureId).catch(() => {});
        return;
      }
      capture.current = grant.captureId;
      window.speechSynthesis?.cancel();
      window.dispatchEvent(new Event("sebby:stop-local-speech"));
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (!alive.current || epoch !== generation.current) {
        try {
          media.getTracks().forEach((t) => {
            try {
              t.stop();
            } catch {
              /* Continue cleanup. */
            }
          });
        } catch {
          /* Stale stream is never used. */
        }
        return;
      }
      stream.current = media;
      const rec = new MediaRecorder(media, { mimeType: mime });
      recorder.current = rec;
      chunks.current = [];
      size.current = 0;
      started.current = performance.now();
      rec.ondataavailable = (e) => {
        if (!alive.current || epoch !== generation.current) return;
        size.current += e.data.size;
        if (size.current > 5 * 1024 * 1024) {
          discard();
          setNote("Recording exceeded 5 MiB and was discarded.");
          return;
        }
        chunks.current.push(e.data);
      };
      rec.onerror = () => {
        if (!alive.current || epoch !== generation.current) return;
        discard();
        setNote("Microphone recording failed. Nothing was uploaded.");
      };
      rec.onstop = () => {
        if (!alive.current || epoch !== generation.current) return;
        release();
        duration.current = Math.min(
          60000,
          Math.max(1, performance.now() - started.current),
        );
        void api
          .endVoiceCapture(capture.current)
          .then(() => {
            if (alive.current && epoch === generation.current) {
              change("recorded");
              if (autoTranscribe.current) void transcribe();
            }
          })
          .catch(() => {
            if (!alive.current || epoch !== generation.current) return;
            discard();
            setNote(
              "Recording permission could not be closed; recording discarded.",
            );
          });
      };
      rec.start(250);
      autoTranscribe.current = provider === "local" && conversationMode;
      if (autoTranscribe.current && typeof AudioContext !== "undefined") {
        try {
          const context = new AudioContext();
          audioContext.current = context;
          const source = context.createMediaStreamSource(media),
            analyser = context.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);
          const samples = new Float32Array(analyser.fftSize);
          let heard = false,
            lastSpeech = performance.now();
          silenceTimer.current = setInterval(() => {
            if (epoch !== generation.current || rec.state !== "recording")
              return;
            analyser.getFloatTimeDomainData(samples);
            const rms = Math.sqrt(
              samples.reduce((sum, n) => sum + n * n, 0) / samples.length,
            );
            if (rms > 0.015) {
              heard = true;
              lastSpeech = performance.now();
            }
            if (
              heard &&
              performance.now() - lastSpeech > 1200 &&
              performance.now() - started.current > 900
            ) {
              change("stopping");
              rec.stop();
            }
          }, 100);
          void context.resume().catch(() => {});
        } catch {
          setNote(
            "Automatic pause detection is unavailable. Press Stop recording to finish your turn.",
          );
        }
      }
      change("recording");
      timer.current = setTimeout(() => {
        if (rec.state === "recording") rec.stop();
      }, 60000);
    } catch {
      if (!alive.current || epoch !== generation.current) return;
      discard();
      setNote(
        "Recording unavailable or permission declined. Nothing was uploaded.",
      );
    }
  }
  async function transcribe() {
    if (!api || phaseRef.current !== "recorded") return;
    change("uploading");
    const epoch = generation.current;
    let bytes: Uint8Array | undefined;
    try {
      const blob = new Blob(chunks.current, {
        type: recorder.current?.mimeType || "audio/webm",
      });
      bytes = new Uint8Array(await blob.arrayBuffer());
      if (epoch !== generation.current) return;
      const result = await api.transcribeVoice({
        captureId: capture.current,
        bytes,
        mimeType: blob.type,
        durationMs: duration.current,
      });
      if (!alive.current || epoch !== generation.current) return;
      if (result.status === "completed" && result.text) {
        const conversational = autoTranscribe.current;
        discard();
        if (conversational && onConversationTranscript) {
          onConversationTranscript(result.text);
          setNote(
            "Local transcript prepared for chat review. Native approval is still required before sending.",
          );
        } else {
          onTranscript(result.text);
          session.setDraftReady(true);
          setNote("Transcript added to your draft. Review before sending.");
        }
      } else {
        setNote(
          result.status === "denied"
            ? "Upload declined. Recording remains in memory until discarded."
            : result.status === "cancelled"
              ? "Transcription cancelled."
              : "Transcription failed. Nothing was sent to chat.",
        );
        change("recorded");
      }
    } catch {
      if (alive.current && epoch === generation.current) {
        change("recorded");
        report("Voice transcription failed. No automatic retry.");
      }
    } finally {
      bytes?.fill(0);
    }
  }
  return (
    <section aria-label="Push-to-talk transcription">
      <h3>Talk with Sebby</h3>
      <p>
        Choose conversation mode for spoken replies. Start recording, speak,
        then pause or press Stop. In draft mode, press Transcribe and send the
        draft explicitly. “Hello Sebby” is not a wake word.
      </p>
      {api?.localVoiceStatus && (
        <label>
          Recognition provider
          <select
            aria-label="Recognition provider"
            value={provider}
            disabled={phase !== "idle"}
            onChange={(e) => {
              setReady(false);
              setProvider(e.target.value);
              setConversationMode(false);
            }}
          >
            <option value="local">Local / Whisper-small</option>
            <option value="openai">OpenAI / internet and API charges</option>
          </select>
        </label>
      )}
      <button
        disabled={!api?.voiceStatus || phase !== "idle"}
        onClick={() => void refreshAvailability()}
      >
        Refresh voice availability
      </button>
      {provider === "openai" ? (
        <label>
          Transcription model
          <input
            aria-label="Transcription model"
            value={model}
            disabled={phase !== "idle"}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Enter an OpenAI audio transcription model"
          />
        </label>
      ) : (
        <label>
          Input speech language
          <select
            aria-label="Input speech language"
            disabled={phase !== "idle"}
            value={inputLanguage}
            onChange={(e) => setInputLanguage(e.target.value)}
          >
            <option value="auto">Auto detect (recognition only)</option>
            {LANGUAGES.map(([id, label]) => (
              <option
                key={id}
                value={id}
                disabled={
                  !!localStatus && !localStatus.inputLanguages.includes(id)
                }
              >
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      {provider === "local" && onConversationTranscript && (
        <label className="check">
          <input
            type="checkbox"
            checked={conversationMode}
            disabled={phase !== "idle"}
            onChange={(e) => setConversationMode(e.target.checked)}
          />
          Conversation mode for this session: pause or Stop recording → local
          transcription → native-reviewed chat → read the completed reply using
          the selected local voice. No automatic next recording.
        </label>
      )}
      <p>{note}</p>
      <p>
        No wake word or background listening. Up to 60 seconds / 5 MiB.
        {provider === "local"
          ? " Local processing, no saved recordings. Input language is separate from Reply language. Multilingual recognition quality varies and requires testing."
          : " OpenAI upload requires separate native approval, internet and API charges; provider retention policies apply."}
      </p>
      <p className="muted">
        An unsent or failed recording stays in memory until Discard or leaving
        this page. No recording file is saved. A transcription draft and sent
        chat use normal local draft/history storage.
      </p>
      <button
        disabled={
          !ready || (provider === "openai" && !model.trim()) || phase !== "idle"
        }
        onClick={() => void start()}
      >
        Start recording
      </button>
      {phase === "recording" && (
        <button
          onClick={() => {
            change("stopping");
            recorder.current?.stop();
          }}
        >
          Stop recording
        </button>
      )}
      {phase === "recorded" && (
        <button onClick={() => void transcribe()}>Transcribe recording</button>
      )}
      {phase !== "idle" && (
        <button onClick={discard}>
          {phase === "uploading" ? "Cancel transcription" : "Discard recording"}
        </button>
      )}
      <span role="status" aria-live="polite">
        {phase === "recording" ? "Listening · microphone active" : phase}
      </span>
    </section>
  );
}
