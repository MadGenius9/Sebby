import { randomUUID } from "node:crypto";
import { VoiceTranscriber, VOICE_LIMITS } from "./voice.mjs";
export class VoiceController {
  constructor({
    getContext,
    approveCapture,
    approveUpload,
    transport,
    localVoice,
    onHandsFreeExpired = () => {},
    now = Date.now,
  }) {
    Object.assign(this, {
      getContext,
      approveCapture,
      approveUpload,
      transport,
      localVoice,
      onHandsFreeExpired,
      now,
    });
    this.capture = null;
    this.pending = false;
    this.epoch = 0;
    this.closed = false;
    this.uploads = 0;
    this.expiry = null;
    this.handsFree = null;
    this.handsFreePending = null;
    this.handsFreeExpiry = null;
  }
  isBusy() {
    return (
      this.pending || !!this.capture || !!this.handsFree || this.uploads > 0
    );
  }
  canPlaySpeech() {
    return !this.closed && !this.pending && !this.capture && this.uploads === 0;
  }
  isHandsFreeSession(id) {
    return !!(
      this.handsFree &&
      (!id || this.handsFree.sessionId === id) &&
      this.now() < this.handsFree.expiresAt
    );
  }
  // Main-process-only authority handle. Never serialize this object over IPC.
  requireHandsFree(id, windowId) {
    const session = this.handsFree;
    if (
      !session ||
      session.sessionId !== id ||
      session.windowId !== windowId ||
      this.closed
    )
      throw Error("Hands-free session unavailable.");
    if (this.now() >= session.expiresAt) {
      this.stopHandsFree(id, windowId);
      this.onHandsFreeExpired({ sessionId: id });
      throw Error(
        "Hands-free session expired. Start a new session explicitly.",
      );
    }
    return session;
  }
  async startHandsFree(input, windowId) {
    if (
      this.closed ||
      this.isBusy() ||
      !input ||
      Object.keys(input).some((key) => key !== "language") ||
      typeof input.language !== "string" ||
      !Number.isSafeInteger(windowId)
    )
      throw Error("Hands-free local listening is unavailable.");
    this.pending = true;
    const pending = { windowId },
      epoch = this.epoch;
    this.handsFreePending = pending;
    try {
      const context = await this.getContext();
      if (
        context.provider !== "ollama" ||
        typeof context.profileId !== "string" ||
        !context.profileId
      )
        throw Error("Choose a local Ollama profile before hands-free mode.");
      const local = await this.localVoice?.status();
      if (
        this.closed ||
        epoch !== this.epoch ||
        !local?.available ||
        !local.inputLanguages.includes(input.language)
      )
        throw Error(
          "Local recognition is unavailable or starting was cancelled.",
        );
      const disclosure =
        "Enable local hands-free listening for this open Sebby window, for up to 30 minutes? The microphone stays active to detect the spoken phrase Hello Sebby, then your requests. Bounded audio chunks stay in memory and go only to the local speech service at 127.0.0.1:11435. Recognized requests may be sent automatically as text-only chat to the selected local Ollama profile, and normal chat history may retain those transcripts and replies. No files, memory, skills, remote services, tools or commands are authorized. No cloud fallback. Spoken interruption is best effort: use headphones to reduce speaker echo, and Stop hands-free remains available. Stop, navigation, expiry or closing the app ends this session.";
      const approved = await this.approveCapture({
        handsFree: true,
        provider: "local",
        model: "whisper-small",
        profileId: context.profileId,
        disclosure,
      });
      if (!approved || this.closed || epoch !== this.epoch)
        throw Error("Hands-free listening was declined or cancelled.");
      const sessionId = randomUUID(),
        expiresAt = this.now() + 30 * 60_000;
      this.handsFree = {
        sessionId,
        windowId,
        language: input.language,
        context: {
          provider: "ollama",
          profileId: context.profileId,
          ...(typeof context.model === "string"
            ? { model: context.model }
            : {}),
        },
        expiresAt,
        grantUntil: this.now() + 10000,
        consumed: false,
        transcriber: null,
      };
      clearTimeout(this.handsFreeExpiry);
      this.handsFreeExpiry = setTimeout(() => {
        if (this.handsFree?.sessionId !== sessionId) return;
        this.stopHandsFree(sessionId, windowId);
        this.onHandsFreeExpired({ sessionId });
      }, 30 * 60_000);
      this.handsFreeExpiry.unref?.();
      return { sessionId, expiresAt };
    } finally {
      if (this.handsFreePending === pending) this.handsFreePending = null;
      this.pending = false;
    }
  }
  async transcribeHandsFree(input, windowId) {
    if (
      !input ||
      Object.keys(input).some(
        (key) =>
          !["sessionId", "bytes", "mimeType", "durationMs"].includes(key),
      ) ||
      !(input.bytes instanceof Uint8Array) ||
      !input.bytes.length ||
      input.bytes.length > VOICE_LIMITS.maxBytes ||
      !["audio/webm", "audio/webm;codecs=opus", "audio/wav"].includes(
        input.mimeType,
      ) ||
      !Number.isFinite(input.durationMs) ||
      input.durationMs <= 0 ||
      input.durationMs > 30000
    )
      throw Error("Invalid bounded hands-free recording.");
    const session = this.requireHandsFree(input.sessionId, windowId);
    if (!session.consumed || session.transcriber)
      throw Error(
        "Hands-free microphone is not active or recognition is busy.",
      );
    const transcriber = this.localVoice.transcriber(session.language),
      epoch = this.epoch;
    session.transcriber = transcriber;
    this.uploads++;
    try {
      const result = await transcriber.transcribe({
        bytes: input.bytes,
        mimeType: input.mimeType,
        durationMs: input.durationMs,
        model: "whisper-small",
      });
      if (
        epoch !== this.epoch ||
        this.handsFree !== session ||
        this.now() >= session.expiresAt ||
        this.closed
      )
        return { status: "cancelled" };
      return result;
    } finally {
      input.bytes.fill(0);
      if (session.transcriber === transcriber) session.transcriber = null;
      this.uploads--;
    }
  }
  stopHandsFree(id, windowId) {
    if (
      !id &&
      this.handsFreePending &&
      this.handsFreePending.windowId === windowId
    ) {
      this.epoch++;
      return { stopped: true };
    }
    const session = this.handsFree;
    if (!session || session.sessionId !== id || session.windowId !== windowId)
      throw Error("Hands-free session unavailable.");
    clearTimeout(this.handsFreeExpiry);
    this.handsFree = null;
    this.epoch++;
    session.transcriber?.cancel();
    return { stopped: true };
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
    const c = this.capture ?? this.handsFree;
    return !!(
      c &&
      c.windowId === windowId &&
      audioOnly === true &&
      !c.ended &&
      this.now() <=
        (c.consumed
          ? c.sessionId
            ? c.expiresAt
            : c.createdAt + 70000
          : c.grantUntil)
    );
  }
  consumePermission(request) {
    const c = this.capture ?? this.handsFree;
    if (!this.checkPermission(request) || c.consumed) return false;
    c.consumed = true;
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
    clearTimeout(this.handsFreeExpiry);
    this.epoch++;
    this.capture?.transcriber?.shutdown();
    this.capture = null;
    this.handsFree?.transcriber?.shutdown();
    this.handsFree = null;
    this.handsFreePending = null;
  }
}
