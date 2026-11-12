import { randomUUID } from "node:crypto";
import { VoiceTranscriber, VOICE_LIMITS } from "./voice.mjs";
export class VoiceController {
  constructor({
    getContext,
    approveCapture,
    approveUpload,
    transport,
    localVoice,
    now = Date.now,
  }) {
    Object.assign(this, {
      getContext,
      approveCapture,
      approveUpload,
      transport,
      localVoice,
      now,
    });
    this.capture = null;
    this.pending = false;
    this.epoch = 0;
    this.closed = false;
    this.uploads = 0;
    this.expiry = null;
  }
  isBusy() {
    return this.pending || !!this.capture || this.uploads > 0;
  }
  async status() {
    try {
      if (this.closed) throw Error("Voice is closed; restart Sebby.");
      const c = this.capture?.context ?? (await this.getContext());
      return {
        configured: (await c.credentials.status()).configured,
        provider: c.provider,
        defaultModel: "",
        supportedFormats: ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"],
      };
    } catch {
      return {
        configured: false,
        provider: "",
        defaultModel: "",
        supportedFormats: [],
      };
    }
  }
  async begin(input = {}, windowId) {
    const { model, provider = "openai", language = "auto" } = input ?? {};
    if (
      this.closed ||
      !input ||
      Object.keys(input).some(
        (k) => !["model", "provider", "language"].includes(k),
      ) ||
      !["openai", "local"].includes(provider) ||
      (provider === "local" && model !== "whisper-small") ||
      (provider === "openai" && language !== "auto") ||
      this.isBusy() ||
      !Number.isSafeInteger(windowId) ||
      typeof model !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(model)
    )
      throw Error("Voice recording unavailable.");
    this.pending = true;
    const epoch = this.epoch;
    try {
      const context =
        provider === "local"
          ? { provider: "local", language }
          : await this.getContext();
      if (epoch !== this.epoch) throw Error("Recording cancelled.");
      if (provider === "local") {
        const status = await this.localVoice?.status();
        if (!status?.available || !status.inputLanguages.includes(language))
          throw Error(
            "Start the local voice service and choose a supported input language.",
          );
      } else if (
        context.provider !== "openai" ||
        !(await context.credentials.status()).configured
      )
        throw Error("Select a configured OpenAI profile.");
      if (epoch !== this.epoch) throw Error("Recording cancelled.");
      if (
        !(await this.approveCapture({
          model,
          profileId: context.profileId,
          provider,
          disclosure:
            provider === "local"
              ? "Allow push-to-talk microphone recording? Up to 60 seconds in memory, processed by the local voice service at 127.0.0.1:11435. No audio leaves this PC or is saved to disk."
              : "Allow microphone recording while Sebby is open? Up to 60 seconds in memory. Upload to OpenAI requires separate paid-request approval.",
        })) ||
        epoch !== this.epoch
      )
        throw Error("Microphone permission declined.");
      const captureId = randomUUID();
      this.capture = {
        captureId,
        windowId,
        model,
        context,
        grantUntil: this.now() + 10000,
        consumed: false,
        ended: false,
        createdAt: this.now(),
        transcriber: null,
      };
      clearTimeout(this.expiry);
      this.expiry = setTimeout(() => {
        if (this.capture?.captureId === captureId)
          this.cancel(captureId, windowId);
      }, 10 * 60_000);
      this.expiry.unref?.();
      return { captureId };
    } finally {
      this.pending = false;
    }
  }
  checkPermission({ windowId, audioOnly }) {
    const c = this.capture;
    return !!(
      c &&
      c.windowId === windowId &&
      audioOnly === true &&
      !c.ended &&
      this.now() <= (c.consumed ? c.createdAt + 70000 : c.grantUntil)
    );
  }
  consumePermission(request) {
    if (!this.checkPermission(request) || this.capture.consumed) return false;
    this.capture.consumed = true;
    return true;
  }
  require(id, windowId) {
    const c = this.capture;
    if (!c || c.captureId !== id || c.windowId !== windowId)
      throw Error("Recording session unavailable.");
    return c;
  }
  end(id, windowId) {
    const c = this.require(id, windowId);
    if (c.transcriber) throw Error("Upload already active.");
    c.ended = true;
    c.endedAt = this.now();
    return { ended: true };
  }
  async transcribe(input, windowId) {
    if (
      !input ||
      Object.keys(input).some(
        (k) => !["captureId", "bytes", "mimeType", "durationMs"].includes(k),
      ) ||
      !(input.bytes instanceof Uint8Array) ||
      !input.bytes.length ||
      input.bytes.length > VOICE_LIMITS.maxBytes ||
      !Number.isFinite(input.durationMs) ||
      input.durationMs <= 0
    )
      throw Error("Invalid recording input.");
    const c = this.require(input?.captureId, windowId);
    if (
      !c.ended ||
      !c.consumed ||
      c.transcriber ||
      this.now() - c.createdAt > 10 * 60_000 ||
      input.durationMs > VOICE_LIMITS.maxDurationMs
    )
      throw Error("Recording session expired or invalid.");
    c.transcriber =
      c.context.provider === "local"
        ? this.localVoice.transcriber(c.context.language)
        : new VoiceTranscriber({
            credentials: c.context.credentials,
            approve: (details) =>
              this.approveUpload({
                ...details,
                profileId: c.context.profileId,
              }),
            transport: this.transport,
          });
    this.uploads++;
    try {
      return await c.transcriber.transcribe({
        bytes: input.bytes,
        mimeType: input.mimeType,
        durationMs: input.durationMs,
        model: c.model,
      });
    } finally {
      input.bytes.fill(0);
      c.transcriber = null;
      this.uploads--;
    }
  }
  cancel(id, windowId) {
    const c = this.require(id, windowId);
    clearTimeout(this.expiry);
    c.transcriber?.cancel();
    this.capture = null;
    this.epoch++;
    return { cancelled: true };
  }
  shutdown() {
    this.closed = true;
    clearTimeout(this.expiry);
    this.epoch++;
    this.capture?.transcriber?.shutdown();
    this.capture = null;
  }
}
