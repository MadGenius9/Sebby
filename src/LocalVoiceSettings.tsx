import { useEffect, useRef, useState } from "react";
import { useVoiceSession } from "./VoiceSession";
import { LANGUAGES } from "./languages";
import {
  saveVoicePreferences,
  voicePreferences,
  stopNeuralSpeech,
  speakNeuralText,
  type LocalVoiceAPI,
  type LocalVoiceStatus,
} from "./localSpeech";
export function LocalVoiceSettings({ language }: { language: string }) {
  const session = useVoiceSession();
  const previewEpoch = useRef(0);
  const [preferences, setPreferences] = useState(voicePreferences);
  const [status, setStatus] = useState<LocalVoiceStatus | null>(null);
  const [notice, setNotice] = useState("");
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const load = () =>
      setSystemVoices(
        window.speechSynthesis?.getVoices().filter((v) => v.localService) || [],
      );
    load();
    window.speechSynthesis?.addEventListener?.("voiceschanged", load);
    return () =>
      window.speechSynthesis?.removeEventListener?.("voiceschanged", load);
  }, []);
  const api = window.sebby as unknown as Partial<LocalVoiceAPI> | undefined;
  useEffect(() => {
    const stop = () => {
      previewEpoch.current++;
      void stopNeuralSpeech();
      session.setSpeech("idle");
    };
    window.addEventListener("sebby:stop-local-speech", stop);
    return () => {
      window.removeEventListener("sebby:stop-local-speech", stop);
      stop();
    };
  }, [session.setSpeech]);
  async function refresh() {
    try {
      if (!api?.localVoiceStatus) throw Error("Open the updated desktop app.");
      const next = await api.localVoiceStatus();
      setStatus(next);
      setNotice(
        next.available
          ? "Local neural speech and recognition assets found. First use may warm the models."
          : "Local voice assets are missing. Run scripts/setup-local-voice.ps1, then scripts/start-local-voice.ps1.",
      );
    } catch {
      setStatus(null);
      setNotice(
        "Local voice service unavailable. Run scripts/setup-local-voice.ps1 once, then scripts/start-local-voice.ps1. System voices and explicit cloud transcription remain separate options.",
      );
    }
  }
  function save(next: typeof preferences) {
    window.dispatchEvent(new Event("sebby:stop-local-speech"));
    void stopNeuralSpeech();
    try {
      saveVoicePreferences(next);
      setPreferences(next);
      setNotice("Voice preference saved on this device.");
    } catch {
      setNotice("Voice preference could not be saved.");
    }
  }
  return (
    <details className="scope">
      <summary>Voice and speech settings</summary>
      <p>
        Neural speech uses Kokoro on this PC. System speech uses installed
        Windows voices. No cloud voice is selected automatically. Text and
        generated audio remain in memory; audio is discarded after playback or
        interruption.
      </p>
      <label>
        Speech provider
        <select
          aria-label="Speech provider"
          value={preferences.provider}
          onChange={(e) =>
            save({
              ...preferences,
              provider: e.target.value as "system" | "neural",
            })
          }
        >
          <option value="system">Windows device-local voices</option>
          <option value="neural">Local neural voice / Kokoro</option>
        </select>
      </label>
      <button onClick={() => void refresh()}>Check local voice service</button>
      {preferences.provider === "system" && (
        <label>
          Windows voice
          <select
            aria-label="Windows voice"
            value={preferences.systemVoice || ""}
            onChange={(e) =>
              save({ ...preferences, systemVoice: e.target.value })
            }
          >
            <option value="">
              First installed local voice matching reply language
            </option>
            {systemVoices
              .filter((v) => v.lang.toLowerCase().split("-")[0] === language)
              .map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} · {v.lang}
                </option>
              ))}
          </select>
        </label>
      )}
      {preferences.provider === "neural" && (
        <>
          <label>
            Neural voice
            <select
              aria-label="Neural voice"
              value={preferences.voice}
              onChange={(e) => save({ ...preferences, voice: e.target.value })}
            >
              {!status?.voices.some((v) => v.id === preferences.voice) && (
                <option value={preferences.voice}>
                  {preferences.voice} (availability not checked)
                </option>
              )}
              {status?.voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ·{" "}
                  {LANGUAGES.find(([id]) => id === v.language)?.[1] ||
                    v.language}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={
              !status?.available ||
              !status.voices.some(
                (v) => v.id === preferences.voice && v.language === language,
              ) ||
              ["starting", "recording", "stopping", "uploading"].includes(
                session.capture,
              )
            }
            onClick={async () => {
              window.dispatchEvent(new Event("sebby:stop-local-speech"));
              window.speechSynthesis?.cancel();
              const epoch = ++previewEpoch.current;
              const samples: Record<string, string> = {
                en: "Hello. I'm Sebby. I'm here to help you think, build, and explore. You can interrupt me whenever you need.",
                es: "Hola. Soy Sebby. Estoy aquí para ayudarte a pensar, crear y explorar.",
                fr: "Bonjour. Je suis Sebby. Je suis là pour vous aider à réfléchir et à créer.",
                it: "Ciao. Sono Sebby. Sono qui per aiutarti a pensare e creare.",
                pt: "Olá. Sou Sebby. Estou aqui para ajudar você a pensar e criar.",
                hi: "नमस्ते। मैं सेबी हूँ। मैं आपकी मदद के लिए यहाँ हूँ।",
              };
              try {
                await speakNeuralText(
                  samples[language] || "",
                  language,
                  (state) => {
                    if (epoch === previewEpoch.current) {
                      session.setSpeech(state);
                      setNotice(`Voice preview: ${state}`);
                    }
                  },
                );
              } catch {
                if (epoch === previewEpoch.current)
                  setNotice(
                    "Voice preview failed. Check the local service and output device. No cloud fallback.",
                  );
              } finally {
                if (epoch === previewEpoch.current) session.setSpeech("idle");
              }
            }}
          >
            Preview selected voice
          </button>
          {status &&
            !status.voices.some(
              (v) => v.id === preferences.voice && v.language === language,
            ) && (
              <p role="alert">
                Selected voice does not support reply language {language}.
                Choose a matching voice or change Reply language. There is no
                automatic substitution.
              </p>
            )}
        </>
      )}
      <label>
        Speech pacing
        <input
          aria-label="Speech pacing"
          type="number"
          min="0.7"
          max="1.3"
          step="0.05"
          value={preferences.speed}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (n >= 0.7 && n <= 1.3) save({ ...preferences, speed: n });
          }}
        />
      </label>
      <p role="status">{notice}</p>
      <p>
        Sentence-chunk playback begins after a complete reply; this is
        push-to-talk conversation, not continuous listening. Press Record to
        interrupt. No wake word, background microphone, voice cloning, or exact
        imitation.
      </p>
    </details>
  );
}
