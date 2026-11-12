export type VoicePreferences = {
  provider: "system" | "neural";
  voice: string;
  speed: number;
  systemVoice?: string;
};
export type LocalVoiceStatus = {
  available: boolean;
  assetsReady: boolean;
  voices: { id: string; name: string; language: string }[];
  inputLanguages: string[];
};
export type LocalVoiceAPI = {
  localVoiceStatus(): Promise<LocalVoiceStatus>;
  synthesizeLocalSpeech(input: {
    text: string;
    voice: string;
    language: string;
    speed: number;
  }): Promise<Uint8Array>;
  cancelLocalSpeech(): Promise<unknown>;
};
export function voicePreferences(): VoicePreferences {
  try {
    const value = JSON.parse(
      localStorage.getItem("sebby.voice.preferences.v1") || "{}",
    );
    return {
      provider: value.provider === "neural" ? "neural" : "system",
      voice: typeof value.voice === "string" ? value.voice : "af_heart",
      speed:
        typeof value.speed === "number" &&
        value.speed >= 0.7 &&
        value.speed <= 1.3
          ? value.speed
          : 1,
      ...(typeof value.systemVoice === "string" &&
      value.systemVoice.length < 500
        ? { systemVoice: value.systemVoice }
        : {}),
    };
  } catch {
    return { provider: "system", voice: "af_heart", speed: 1 };
  }
}
export function saveVoicePreferences(value: VoicePreferences) {
  localStorage.setItem("sebby.voice.preferences.v1", JSON.stringify(value));
  window.dispatchEvent(new Event("sebby:voice-preferences-changed"));
}
export function speechChunks(text: string): string[] {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " Code block omitted. ")
    .replace(/https?:\/\/\S+/g, " link ")
    .replace(/[*#`]/g, "")
    .trim();
  const sentences = cleaned.match(/[^.!?。！？\n]+[.!?。！？]*|\n+/g) || [];
  const result: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    let rest = sentence.trim();
    while (rest.length > 550) {
      if (current) {
        result.push(current);
        current = "";
      }
      let end = rest.lastIndexOf(" ", 550);
      if (end < 100) end = 550;
      result.push(rest.slice(0, end));
      rest = rest.slice(end).trim();
    }
    if (!rest) continue;
    if (current.length + rest.length > 550) {
      result.push(current);
      current = "";
    }
    current += (current ? " " : "") + rest;
  }
  if (current) result.push(current);
  return result;
}
let generation = 0;
let currentAudio: HTMLAudioElement | null = null;
let objectURL = "";
let settle: (() => void) | null = null;
export async function stopNeuralSpeech() {
  generation++;
  const audio = currentAudio;
  currentAudio = null;
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    audio.onplaying = null;
    try {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    } catch {
      /* release URL below */
    }
  }
  if (objectURL) URL.revokeObjectURL(objectURL);
  objectURL = "";
  settle?.();
  settle = null;
  const api = window.sebby as unknown as Partial<LocalVoiceAPI> | undefined;
  try {
    await api?.cancelLocalSpeech?.();
  } catch {
    /* Playback is already stopped. */
  }
}
export async function speakNeuralText(
  text: string,
  language: string,
  report: (state: string) => void,
) {
  const stopping = stopNeuralSpeech();
  const epoch = generation;
  await stopping;
  if (epoch !== generation) return;
  const api = window.sebby as unknown as Partial<LocalVoiceAPI> | undefined;
  const preferences = voicePreferences();
  if (!api?.synthesizeLocalSpeech || !text.trim() || text.length > 6000)
    throw Error(
      "Local neural speech is unavailable or the response exceeds 6,000 characters.",
    );
  const chunks = speechChunks(text);
  if (!chunks.length) throw Error("No speakable text.");
  for (const chunk of chunks) {
    if (generation !== epoch) return;
    report("synthesizing");
    const bytes = await api.synthesizeLocalSpeech({
      text: chunk,
      voice: preferences.voice,
      language,
      speed: preferences.speed,
    });
    if (generation !== epoch) return;
    objectURL = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: "audio/wav" }),
    );
    const audio = new Audio(objectURL);
    currentAudio = audio;
    try {
      await new Promise<void>((resolve, reject) => {
        settle = resolve;
        audio.onplaying = () => {
          if (generation === epoch) report("reading");
        };
        audio.onended = () => resolve();
        audio.onerror = () =>
          reject(Error("Audio output failed. Check the playback device."));
        audio.play().catch(reject);
      });
    } finally {
      if (currentAudio === audio) {
        currentAudio = null;
        settle = null;
        audio.onended = null;
        audio.onerror = null;
        audio.onplaying = null;
        audio.removeAttribute("src");
        if (objectURL) URL.revokeObjectURL(objectURL);
        objectURL = "";
      }
    }
  }
  if (generation === epoch) report("idle");
}
