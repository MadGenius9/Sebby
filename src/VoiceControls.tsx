import { useEffect, useRef, useState } from "react";
type Result = { status: string; text?: string; error?: string };
type VoiceApi = {
  onProviderChanged?(callback: () => void): () => void;
  voiceStatus(): Promise<{
    configured: boolean;
    provider: string;
    model?: string;
  }>;
  beginVoiceCapture(input: { model: string }): Promise<{ captureId: string }>;
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
}: {
  report: (message: string) => void;
  onTranscript: (text: string) => void;
}) {
  const api = (window as unknown as { sebby?: VoiceApi }).sebby;
  const [model, setModel] = useState("");
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
    if (alive.current) setPhase(next);
  };
  const release = () => {
    clearTimeout(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  const discard = () => {
    generation.current++;
    const id = capture.current;
    capture.current = "";
    if (recorder.current) {
      recorder.current.onstop = null;
      recorder.current.ondataavailable = null;
      if (recorder.current.state !== "inactive") recorder.current.stop();
    }
    recorder.current = null;
    release();
    chunks.current = [];
    size.current = 0;
    if (id) void api?.cancelVoice(id).catch(() => {});
    change("idle");
  };
  async function refreshAvailability() {
    if (!api?.voiceStatus || phaseRef.current !== "idle") return;
    try {
      const s = await api.voiceStatus();
      if (alive.current && phaseRef.current === "idle") {
        setReady(s.configured && s.provider === "openai");
        setNote(
          s.configured && s.provider === "openai"
            ? "Enter an audio transcription model below. Recording stays in memory until you approve upload."
            : "OpenAI is unavailable or busy. Select a configured OpenAI profile in Settings, then refresh availability.",
        );
      }
    } catch {
      if (alive.current) {
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
      unsubscribe?.();
      discard();
    };
  }, [api]);
  async function start() {
    if (!api || !ready || phaseRef.current !== "idle") return;
    change("starting");
    const epoch = ++generation.current;
    try {
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
        (t) => MediaRecorder.isTypeSupported(t),
      );
      if (!mime) throw Error("unsupported");
      const grant = await api.beginVoiceCapture({ model });
      if (!alive.current || epoch !== generation.current) {
        void api.cancelVoice(grant.captureId).catch(() => {});
        return;
      }
      capture.current = grant.captureId;
      window.speechSynthesis?.cancel();
      window.dispatchEvent(new Event("sebby:stop-local-speech"));
      const media = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      if (!alive.current || epoch !== generation.current) {
        media.getTracks().forEach((t) => t.stop());
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
            if (alive.current && epoch === generation.current)
              change("recorded");
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
        onTranscript(result.text);
        setNote("Transcript added to your draft. Review before sending.");
        discard();
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
      <h3>Voice draft</h3>
      <button
        disabled={!api?.voiceStatus || phase !== "idle"}
        onClick={() => void refreshAvailability()}
      >
        Refresh voice availability
      </button>
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
      <p>{note}</p>
      <p>
        No wake word or background listening. Up to 60 seconds / 5 MiB. OpenAI
        only; paid upload requires a separate native confirmation.
      </p>
      <button
        disabled={!ready || !model.trim() || phase !== "idle"}
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
      <span role="status">{phase}</span>
    </section>
  );
}
