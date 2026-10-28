import { useEffect, useRef, useState } from "react";
/** Explicit device-local speech only. Never silently substitute a remote voice. */
export function SpeechButton({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false),
    [note, setNote] = useState("");
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  useEffect(() => {
    const stop = () => {
      if (!utterance.current) return;
      utterance.current = null;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      setSpeaking(false);
    };
    window.addEventListener("sebby:stop-local-speech", stop);
    return () => {
      window.removeEventListener("sebby:stop-local-speech", stop);
      stop();
    };
  }, []);
  return (
    <div className="button-row">
      <button
        className="text-button"
        disabled={!text.trim() || text.length > 6000}
        onClick={() => {
          if (
            !("speechSynthesis" in window) ||
            !("SpeechSynthesisUtterance" in window)
          ) {
            setNote("Device-local speech is unavailable.");
            return;
          }
          if (speaking) {
            window.speechSynthesis.cancel();
            utterance.current = null;
            setSpeaking(false);
            return;
          }
          const voice = window.speechSynthesis
            .getVoices()
            .find(
              (v) => v.localService && v.lang.toLowerCase().startsWith("en"),
            );
          if (!voice) {
            setNote(
              "No device-local English voice is available. Remote voices are not used.",
            );
            return;
          }
          window.dispatchEvent(new Event("sebby:stop-local-speech"));
          window.speechSynthesis.cancel();
          const value = new SpeechSynthesisUtterance(text);
          value.voice = voice;
          value.lang = voice.lang;
          utterance.current = value;
          const finish = () => {
            if (utterance.current === value) {
              utterance.current = null;
              setSpeaking(false);
            }
          };
          value.onend = finish;
          value.onerror = () => {
            if (utterance.current !== value) return;
            finish();
            setNote("Local speech could not finish.");
          };
          setNote("Device-local voice · no cloud audio request");
          setSpeaking(true);
          window.speechSynthesis.speak(value);
        }}
      >
        {speaking ? "Stop reading" : "Read response aloud locally"}
      </button>
      <small role="status">
        {text.length > 6000
          ? "This response exceeds the 6,000-character speech limit."
          : note}
      </small>
    </div>
  );
}
