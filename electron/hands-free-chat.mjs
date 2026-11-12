import { randomUUID } from "node:crypto";
import { ChatService } from "./chat.mjs";

const TTL = 30 * 60_000;
const MAX_TURNS = 60;
const OUTPUT_TOKENS = 512;
const exact = (input, keys) => {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(input, key))
  )
    throw Error("Invalid hands-free chat request.");
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Separate local-text ChatService: this grant never bypasses ordinary chat or tool approvals. */
export class HandsFreeChatSession {
  constructor({
    getIdentity,
    assertVoiceSession,
    confirm,
    provider,
    conversations,
    workspace,
    store,
    skills,
    onEvent,
    now = Date.now,
  }) {
    Object.assign(this, {
      getIdentity,
      assertVoiceSession,
      confirm,
      conversations,
      now,
    });
    this.grant = null;
    this.pending = false;
    this.turnPending = false;
    this.turn = null;
    this.epoch = 0;
    this.closed = false;
    this.expiry = null;
    this.chat = new ChatService({
      conversations,
      workspace,
      store,
      skills,
      onEvent,
      approve: (request) => this.approve(request),
      provider: {
        status: async () => {
          const turn = this.turn;
          this.current(turn?.grant);
          const result = await provider.status();
          await this.requireTurn(turn);
          if (result.provider !== "ollama")
            throw Error("Hands-free chat is local Ollama only.");
          return result;
        },
        send: async (input) => {
          const turn = this.turn;
          await this.requireTurn(turn);
          const grant = turn.grant;
          if (
            input.model !== grant.identity.model ||
            input.maxOutputTokens > OUTPUT_TOKENS ||
            (input.tools !== undefined &&
              (!Array.isArray(input.tools) || input.tools.length))
          )
            throw Error("Hands-free chat scope changed.");
          const result = await provider.send({ ...input, tools: [] });
          await this.requireTurn(turn);
          return result;
        },
      },
    });
  }
  get isBusy() {
    return this.pending || this.turnPending || this.chat.isActive;
  }
  owns(runId) {
    return typeof runId === "string" && this.chat.runs.has(runId);
  }
  current(expected = this.grant) {
    if (
      this.closed ||
      !expected ||
      this.grant !== expected ||
      this.now() >= expected.expiresAt ||
      !same(this.getIdentity(), expected.identity)
    )
      throw Error(
        "Hands-free local chat permission expired or its profile/workspace changed. Restart hands-free mode.",
      );
    return expected;
  }
  async requireVoice(grant, voiceSessionId) {
    this.current(grant);
    const voice = await this.assertVoiceSession(voiceSessionId);
    this.current(grant);
    if (
      !voice?.context ||
      voice.consumed !== true ||
      voice.context.provider !== "ollama" ||
      voice.context.profileId !== grant.identity.profileId ||
      voice.context.model !== grant.identity.model
    )
      throw Error("Hands-free microphone and chat profiles do not match.");
  }
  async requireTurn(turn) {
    if (!turn || this.turn !== turn)
      throw Error("Hands-free turn permission was revoked.");
    await this.requireVoice(turn.grant, turn.voiceSessionId);
    if (this.turn !== turn)
      throw Error("Hands-free turn permission was revoked.");
  }
  async begin(input = {}) {
    exact(input, []);
    if (this.closed || this.pending || this.grant || this.chat.isActive)
      throw Error("Stop the existing hands-free chat session first.");
    const identity = this.getIdentity();
    if (
      identity.provider !== "ollama" ||
      typeof identity.model !== "string" ||
      !identity.model ||
      /cloud/i.test(identity.model)
    )
      throw Error(
        "Select an installed local Ollama model before enabling hands-free chat.",
      );
    this.pending = true;
    const epoch = this.epoch;
    try {
      const accepted = await this.confirm(
        "Allow this local hands-free conversation session?",
        `Local Ollama profile: ${identity.profileId}\nModel: ${identity.model}\nWorkspace: ${identity.workspaceRoot || "personal"}\n\nFor up to 30 minutes and 60 spoken turns, send text and this session's recent conversation history only to Ollama at 127.0.0.1:11434 without another chat dialog each turn. Maximum output: 512 tokens per turn. No cloud fallback, memory, project files, skills, tools, commands or consequential actions are authorized. A fresh dedicated conversation is created. Transcripts and replies use normal local chat-history retention; microphone recordings are not retained by Sebby. Stop hands-free mode to revoke permission. Provider or workspace changes invalidate it. Microphone listening requires its separate native permission.`,
      );
      if (
        this.closed ||
        epoch !== this.epoch ||
        !same(this.getIdentity(), identity)
      )
        throw Error(
          "Hands-free chat setup was cancelled or its scope changed.",
        );
      if (accepted !== true) return { status: "denied" };
      const conversation = await this.conversations.create({
        title: "Hands-free local conversation",
        workspaceId: identity.workspaceRoot || undefined,
      });
      if (
        this.closed ||
        epoch !== this.epoch ||
        !same(this.getIdentity(), identity)
      )
        throw Error(
          "Hands-free chat setup was cancelled or its scope changed.",
        );
      const grant = {
        sessionId: randomUUID(),
        identity: structuredClone(identity),
        conversationId: conversation.id,
        turns: 0,
        expiresAt: this.now() + TTL,
      };
      this.grant = grant;
      this.expiry = setTimeout(() => this.end(grant.sessionId), TTL);
      this.expiry.unref?.();
      return {
        status: "ready",
        sessionId: grant.sessionId,
        conversationId: grant.conversationId,
        expiresAt: grant.expiresAt,
        maxTurns: MAX_TURNS,
        maxOutputTokens: OUTPUT_TOKENS,
      };
    } finally {
      this.pending = false;
    }
  }
  approve(request) {
    try {
      const grant = this.current();
      return (
        request.kind === "local-chat-request" &&
        request.conversationId === grant.conversationId &&
        request.workspace === grant.identity.workspaceRoot &&
        request.model === grant.identity.model &&
        request.memoryIncluded === false &&
        Array.isArray(request.files) &&
        request.files.length === 0 &&
        Array.isArray(request.skills) &&
        request.skills.length === 0 &&
        Number.isSafeInteger(request.maxOutputTokens) &&
        request.maxOutputTokens <= OUTPUT_TOKENS
      );
    } catch {
      return false;
    }
  }
  async start(input) {
    exact(input, ["sessionId", "voiceSessionId", "text"]);
    const grant = this.current();
    if (
      input.sessionId !== grant.sessionId ||
      typeof input.voiceSessionId !== "string" ||
      typeof input.text !== "string" ||
      !input.text.trim() ||
      input.text.includes("\0") ||
      Buffer.byteLength(input.text) > 4000 ||
      this.chat.isActive ||
      this.turnPending ||
      grant.turns >= MAX_TURNS
    )
      throw Error(
        "Hands-free local turn is invalid, busy, or its 60-turn limit was reached.",
      );
    if (typeof this.assertVoiceSession !== "function")
      throw Error(
        "An active native-approved hands-free microphone session is required.",
      );
    this.turnPending = true;
    try {
      await this.requireVoice(grant, input.voiceSessionId);
      this.turn = { grant, voiceSessionId: input.voiceSessionId };
      grant.turns++;
      const result = await this.chat.start({
        conversationId: grant.conversationId,
        text: input.text,
        model: grant.identity.model,
        includeMemory: false,
        filePaths: [],
        skillIds: [],
        maxOutputTokens: Math.min(
          OUTPUT_TOKENS,
          grant.identity.maxOutputTokens || OUTPUT_TOKENS,
        ),
      });
      if (this.grant !== grant || this.closed) {
        this.chat.cancel(result.runId);
        throw Error("Hands-free chat was stopped.");
      }
      return result;
    } finally {
      this.turnPending = false;
    }
  }
  end(sessionId) {
    if (
      sessionId !== undefined &&
      sessionId !== "" &&
      this.grant?.sessionId !== sessionId
    )
      throw Error("Unknown hands-free chat session.");
    this.grant = null;
    this.turn = null;
    this.epoch++;
    clearTimeout(this.expiry);
    this.expiry = null;
    if (this.chat.active) this.chat.cancel(this.chat.active.id);
    return { stopped: true };
  }
  async shutdown() {
    this.closed = true;
    this.end();
    await this.chat.shutdown();
  }
}
