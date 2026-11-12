import { useVoiceSession } from "./VoiceSession";
import { useEffect, useRef, useState } from "react";
import { voicePreferences } from "./localSpeech";
import { NeuralSpeechButton } from "./NeuralSpeechButton";
/** Explicit device-local speech only. Never silently substitute a remote voice. */
export function SpeechButton({
  text,
  language = "en",
}: {
  text: string;
  language?: string;
}) {
  const [preferences, setPreferences] = useState(voicePreferences);
  useEffect(() => {
    const update = () => setPreferences(voicePreferences());
    window.addEventListener("sebby:voice-preferences-changed", update);
    return () =>
      window.removeEventListener("sebby:voice-preferences-changed", update);
  }, []);
  return preferences.provider === "neural" ? (
    <NeuralSpeechButton text={text} language={language} />
  ) : (
    <SystemSpeechButton text={text} language={language} />
  );
}
function SystemSpeechButton({
  text,
  language = "en",
}: {
  text: string;
  language?: string;
}) {
  const session = useVoiceSession();
  const micBusy = ["starting", "recording", "stopping"].includes(
    session.capture,
  );
  const [speaking, setSpeaking] = useState(false),
    [note, setNote] = useState("");
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  useEffect(() => {
    const stop = () => {
      if (!utterance.current) return;
      utterance.current = null;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      setSpeaking(false);
      session.setSpeech("idle");
    };
    window.addEventListener("sebby:stop-local-speech", stop);
    return () => {
      window.removeEventListener("sebby:stop-local-speech", stop);
      stop();
    };
  }, [session.setSpeech]);
  return (
    <div className="button-row">
      <button
        className="text-button"
        disabled={micBusy || !text.trim() || text.length > 6000}
        onClick={() => {
          if (micBusy) return;
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
            session.setSpeech("idle");
            return;
          }
          const voice = window.speechSynthesis
            .getVoices()
            .find(
              (v) =>
                v.localService &&
                (!voicePreferences().systemVoice ||
                  v.voiceURI === voicePreferences().systemVoice) &&
                v.lang.toLowerCase().split("-")[0] === language,
            );
          if (!voice) {
            setNote(
              `No device-local ${language === "en" ? "English" : language} voice is available. Remote voices are not used.`,
            );
            return;
          }
          window.dispatchEvent(new Event("sebby:stop-local-speech"));
          window.speechSynthesis.cancel();
          const value = new SpeechSynthesisUtterance(text);
          value.voice = voice;
          value.rate = voicePreferences().speed;
          value.lang = voice.lang;
          utterance.current = value;
          const finish = () => {
            if (utterance.current === value) {
              utterance.current = null;
              setSpeaking(false);
              session.setSpeech("idle");
            }
          };
          value.onend = finish;
          value.onerror = () => {
            if (utterance.current !== value) return;
            finish();
            setNote("Local speech could not finish.");
          };
          value.onstart = () => {
            if (utterance.current === value) {
              session.setSpeech("reading");
              setNote(
                "Reading with a device-local voice · no cloud audio request",
              );
            }
          };
          setNote("Local speech queued; waiting for device playback.");
          session.setSpeech("queued");
          setSpeaking(true);
          try {
            window.speechSynthesis.speak(value);
          } catch {
            finish();
            setNote("Local speech could not start.");
          }
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
