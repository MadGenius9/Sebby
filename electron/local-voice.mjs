import http from "node:http";

export const LOCAL_VOICE_LIMITS = Object.freeze({
  audioBytes: 5 * 1024 * 1024,
  responseBytes: 8 * 1024 * 1024,
  textCharacters: 600,
});
const languages = new Set([
  "auto",
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "nl",
  "hi",
  "ur",
  "ar",
  "ja",
  "ko",
  "zh",
  "ru",
  "tr",
  "pl",
]);
const formats = new Set([
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/wav",
]);
export function localVoiceTransport(route, body, signal) {
  if (!["/health", "/synthesize", "/transcribe"].includes(route))
    throw Error("Unsupported local voice operation.");
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: 11435,
        path: route,
        method: data ? "POST" : "GET",
        signal,
        headers: data
          ? {
              "Content-Type": "application/json",
              "Content-Length": data.length,
            }
          : {},
      },
      (response) => resolve(response),
    );
    request.on("error", reject);
    request.setTimeout(120000, () =>
      request.destroy(Error("Local voice timed out.")),
    );
    request.end(data);
  });
}
async function read(response, limit, type, signal) {
  try {
    signal.throwIfAborted();
    if (response.statusCode === 409) {
      const error = Error("Local voice is busy draining earlier CPU work.");
      error.code = "LOCAL_VOICE_BUSY";
      throw error;
    }
    if (
      response.statusCode !== 200 ||
      !String(response.headers?.["content-type"]).startsWith(type)
    )
      throw Error("Local voice service rejected the request.");
    let size = 0;
    const chunks = [];
    for await (const chunk of response) {
      signal.throwIfAborted();
      size += chunk.length;
      if (size > limit) throw Error("Local voice response exceeds limit.");
      chunks.push(Buffer.from(chunk));
    }
    signal.throwIfAborted();
    return Buffer.concat(chunks);
  } finally {
    response.destroy?.();
  }
}
export class LocalVoiceClient {
  constructor({ transport = localVoiceTransport } = {}) {
    this.transport = transport;
    this.speech = null;
    this.closed = false;
  }
  async status(signal = AbortSignal.timeout(5000)) {
    if (this.closed) throw Error("Local voice is closed.");
    const bytes = await read(
      await this.transport("/health", null, signal),
      64000,
      "application/json",
      signal,
    );
    const data = JSON.parse(bytes.toString("utf8"));
    if (
      !Array.isArray(data.voices) ||
      data.voices.length > 100 ||
      !Array.isArray(data.inputLanguages) ||
      data.inputLanguages.length > 100 ||
      typeof data.assetsReady !== "boolean"
    )
      throw Error("Invalid local voice status.");
    const voices = data.voices.map((v) => {
      if (
        !v ||
        !/^[a-z][a-z0-9_]{1,63}$/.test(v.id) ||
        typeof v.name !== "string" ||
        v.name.length > 100 ||
        !languages.has(v.language) ||
        v.language === "auto"
      )
        throw Error("Invalid local voice metadata.");
      return { id: v.id, name: v.name, language: v.language };
    });
    return {
      available: data.available === true && data.assetsReady,
      assetsReady: data.assetsReady,
      voices,
      inputLanguages: data.inputLanguages.filter((l) => languages.has(l)),
      locality: "127.0.0.1:11435",
      retention: "Audio stays in memory; no recordings saved.",
    };
  }
  cancelSpeech() {
    this.speech?.abort();
    return { cancelled: true };
  }
  shutdown() {
    this.closed = true;
    this.cancelSpeech();
  }
  async synthesize(input) {
    if (this.closed || this.speech)
      throw Error("Local speech is unavailable or busy.");
    if (
      !input ||
      Object.keys(input).some(
        (k) => !["text", "voice", "language", "speed"].includes(k),
      ) ||
      typeof input.text !== "string" ||
      !input.text.trim() ||
      input.text.length > LOCAL_VOICE_LIMITS.textCharacters ||
      input.text.includes("\0") ||
      !languages.has(input.language) ||
      input.language === "auto" ||
      typeof input.voice !== "string" ||
      !/^[a-z][a-z0-9_]{1,63}$/.test(input.voice) ||
      !Number.isFinite(input.speed) ||
      input.speed < 0.7 ||
      input.speed > 1.3
    )
      throw Error("Invalid local speech request.");
    const controller = new AbortController();
    this.speech = controller;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(120000),
    ]);
    try {
      const status = await this.status(signal);
      if (!status.available)
        throw Error(
          "Local voice assets are missing. Run scripts/setup-local-voice.ps1.",
        );
      if (
        !status.voices.some(
          (v) => v.id === input.voice && v.language === input.language,
        )
      )
        throw Error(
          "This voice does not support the selected output language.",
        );
      signal.throwIfAborted();
      const bytes = await read(
        await this.transport("/synthesize", input, signal),
        LOCAL_VOICE_LIMITS.responseBytes,
        "audio/wav",
        signal,
      );
      if (
        bytes.length < 44 ||
        bytes.toString("ascii", 0, 4) !== "RIFF" ||
        bytes.toString("ascii", 8, 12) !== "WAVE"
      )
        throw Error("Local voice returned invalid WAV audio.");
      return new Uint8Array(bytes);
    } finally {
      if (this.speech === controller) this.speech = null;
    }
  }
  transcriber(language) {
    if (!languages.has(language)) throw Error("Unsupported input language.");
    const controller = new AbortController();
    return {
      cancel: () => controller.abort(),
      shutdown: () => controller.abort(),
      transcribe: async ({ bytes, mimeType, durationMs }) => {
        const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(120000),
        ]);
        try {
          if (
            this.closed ||
            !(bytes instanceof Uint8Array) ||
            !bytes.length ||
            bytes.length > LOCAL_VOICE_LIMITS.audioBytes ||
            !formats.has(mimeType) ||
            !Number.isFinite(durationMs) ||
            durationMs <= 0 ||
            durationMs > 60000
          )
            throw Error("Invalid local recording.");
          const status = await this.status(signal);
          if (!status.available || !status.inputLanguages.includes(language))
            throw Error("Local recognition is unavailable for this language.");
          signal.throwIfAborted();
          const response = await read(
            await this.transport(
              "/transcribe",
              {
                audio: Buffer.from(bytes).toString("base64"),
                language,
              },
              signal,
            ),
            128000,
            "application/json",
            signal,
          );
          const result = JSON.parse(response.toString("utf8"));
          if (
            typeof result.text !== "string" ||
            !result.text.trim() ||
            result.text.length > 32000
          )
            throw Error("No speech recognized.");
          return {
            status: "completed",
            text: result.text,
            language: result.language,
          };
        } catch (error) {
          return {
            status: controller.signal.aborted ? "cancelled" : "error",
            ...(!controller.signal.aborted && error?.code === "LOCAL_VOICE_BUSY"
              ? { code: "LOCAL_VOICE_BUSY" }
              : {}),
            error:
              "Local transcription unavailable, unsupported language, or no speech recognized. No cloud fallback was used.",
          };
        } finally {
          bytes?.fill?.(0);
        }
      },
    };
  }
}
