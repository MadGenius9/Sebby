import https from "node:https";
import { randomBytes } from "node:crypto";
export const VOICE_LIMITS = Object.freeze({
  maxBytes: 5 * 1024 * 1024,
  maxDurationMs: 60_000,
  maxResponseBytes: 128 * 1024,
});
const formats = {
  "audio/webm": "webm",
  "audio/webm;codecs=opus": "webm",
  "audio/mp4": "mp4",
  "audio/wav": "wav",
};
export function directVoiceTransport({ body, contentType, key, signal }) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        agent: false,
        rejectUnauthorized: true,
        signal,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": contentType,
          "Content-Length": body.length,
          Accept: "application/json",
        },
      },
      (response) =>
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: response,
        }),
    );
    request.on("error", reject);
    request.end(body);
  });
}
/** Main-only adapter; caller resolves and binds profile/model, never passes renderer keys. */
export class VoiceTranscriber {
  constructor({
    credentials,
    approve,
    transport = directVoiceTransport,
    timeoutMs = 60_000,
  }) {
    this.credentials = credentials;
    this.approve = approve;
    this.transport = transport;
    this.timeoutMs = Math.min(timeoutMs, 120_000);
    this.active = null;
  }
  isBusy() {
    return this.active !== null;
  }
  cancel() {
    this.active?.abort();
  }
  shutdown() {
    this.cancel();
  }
  async transcribe({ bytes, mimeType, durationMs, model, signal } = {}) {
    if (this.active)
      return { status: "error", error: "A transcription is already active." };
    const controller = new AbortController();
    this.active = controller;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    let timer, audio, body, response;
    try {
      if (
        !(bytes instanceof Uint8Array) ||
        !bytes.length ||
        bytes.length > VOICE_LIMITS.maxBytes ||
        !Object.hasOwn(formats, mimeType) ||
        !Number.isFinite(durationMs) ||
        durationMs <= 0 ||
        durationMs > VOICE_LIMITS.maxDurationMs ||
        typeof model !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(model)
      )
        throw Error("invalid");
      if (controller.signal.aborted) return { status: "cancelled" };
      if (!(await this.credentials.status()).configured)
        return {
          status: "error",
          error: "OpenAI credentials are not configured.",
        };
      if (controller.signal.aborted) return { status: "cancelled" };
      const approved = await this.approve({
        provider: "openai",
        model,
        byteLength: bytes.length,
        durationMs,
        mimeType,
        disclosure:
          "Upload this recording to OpenAI for paid transcription? Audio leaves this device. The transcript is a draft, not a chat message.",
      });
      if (controller.signal.aborted) return { status: "cancelled" };
      if (!approved) return { status: "denied" };
      const key = await this.credentials.getKey();
      if (!key || /[\r\n]/.test(key)) throw Error("credential");
      if (controller.signal.aborted) return { status: "cancelled" };
      audio = Buffer.from(bytes);
      const boundary = `sebby-${randomBytes(24).toString("hex")}`;
      body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="recording.${formats[mimeType]}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
        ),
        audio,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      timer = setTimeout(abort, this.timeoutMs);
      response = await this.transport({
        body,
        contentType: `multipart/form-data; boundary=${boundary}`,
        key,
        signal: controller.signal,
      });
      if (
        response.status !== 200 ||
        !String(response.headers?.["content-type"] ?? "")
          .toLowerCase()
          .startsWith("application/json")
      )
        throw Error("response");
      let size = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        if (controller.signal.aborted) throw Error("abort");
        const data = Buffer.from(chunk);
        size += data.length;
        if (size > VOICE_LIMITS.maxResponseBytes) throw Error("limit");
        chunks.push(data);
      }
      if (controller.signal.aborted) return { status: "cancelled" };
      const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (
        typeof result.text !== "string" ||
        !result.text.trim() ||
        result.text.length > 32000
      )
        throw Error("transcript");
      // Only normalized numeric billing evidence crosses IPC. Never raw response metadata.
      let usage = null;
      if (
        result.usage?.type === "tokens" &&
        ["input_tokens", "output_tokens", "total_tokens"].every(
          (k) => Number.isSafeInteger(result.usage[k]) && result.usage[k] >= 0,
        )
      )
        usage = {
          type: "tokens",
          inputTokens: result.usage.input_tokens,
          outputTokens: result.usage.output_tokens,
          totalTokens: result.usage.total_tokens,
        };
      else if (
        result.usage?.type === "duration" &&
        Number.isFinite(result.usage.seconds) &&
        result.usage.seconds >= 0
      )
        usage = { type: "duration", seconds: result.usage.seconds };
      return { status: "completed", text: result.text, usage };
    } catch {
      return controller.signal.aborted
        ? { status: "cancelled" }
        : {
            status: "error",
            error:
              "Transcription failed. Check the selected audio model and connection; no automatic retry.",
          };
    } finally {
      clearTimeout(timer);
      response?.body?.destroy?.();
      audio?.fill(0);
      body?.fill(0);
      signal?.removeEventListener("abort", abort);
      this.active = null;
    }
  }
}
