import { useEffect, useRef, useState } from "react";
import { useVoiceSession } from "./VoiceSession";
import { speakNeuralText, stopNeuralSpeech } from "./localSpeech";
export function NeuralSpeechButton({
  text,
  language,
}: {
  text: string;
  language: string;
}) {
  const session = useVoiceSession();
  const [busy, setBusy] = useState(false),
    [note, setNote] = useState("");
  const epoch = useRef(0);
  useEffect(() => {
    const stop = () => {
      epoch.current++;
      void stopNeuralSpeech();
      setBusy(false);
      session.setSpeech("idle");
    };
    window.addEventListener("sebby:stop-local-speech", stop);
    return () => {
      window.removeEventListener("sebby:stop-local-speech", stop);
      stop();
    };
  }, [session.setSpeech]);
  const micBusy = ["starting", "recording", "stopping", "uploading"].includes(
    session.capture,
  );
  return (
    <div className="button-row">
      <button
        className="text-button"
        disabled={micBusy || !text.trim() || text.length > 6000}
        onClick={async () => {
          if (busy) {
            epoch.current++;
            await stopNeuralSpeech();
            setBusy(false);
            session.setSpeech("idle");
            return;
          }
          window.dispatchEvent(new Event("sebby:stop-local-speech"));
          window.speechSynthesis?.cancel();
          const current = ++epoch.current;
          setBusy(true);
          setNote("Preparing local neural voice…");
          try {
            await speakNeuralText(text, language, (state) => {
              if (current === epoch.current) {
                session.setSpeech(state);
                setNote(
                  state === "idle"
                    ? "Finished local playback."
                    : `Local voice: ${state}`,
                );
              }
            });
          } catch {
            if (current === epoch.current)
              setNote(
                "Neural speech could not play. Check the service, selected voice/language and audio device. No cloud fallback.",
              );
          } finally {
            if (current === epoch.current) {
              setBusy(false);
              session.setSpeech("idle");
            }
          }
        }}
      >
        {busy ? "Stop reading" : "Read response aloud locally"}
      </button>
      <small role="status">{note}</small>
    </div>
  );
}
