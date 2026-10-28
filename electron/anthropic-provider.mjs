import https from "node:https";
export const ANTHROPIC_CAPABILITIES = Object.freeze({
  chat: true,
  tools: true,
  reasoningReplay: false,
  voice: false,
  modelDiscovery: false,
});
const INPUT_LIMIT = 128 * 1024,
  OUTPUT_LIMIT = 256 * 1024,
  EVENT_LIMIT = 256 * 1024,
  STREAM_LIMIT = 2 * 1024 * 1024;
class AnthropicError extends Error {}
const fail = (message) => {
  throw new AnthropicError(message);
};
const id = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,200}$/.test(value);
function text(value, max = INPUT_LIMIT) {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value) > max ||
    value.includes("\0")
  )
    fail("Invalid or oversized Anthropic text.");
  return value;
}
function parseArgs(value) {
  text(value, 32768);
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail("Invalid tool argument JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    fail("Tool arguments must be an object.");
  return parsed;
}
function payload({
  input,
  instructions,
  model,
  maxOutputTokens = 2048,
  tools = [],
}) {
  if (
    !id(model) ||
    !Number.isInteger(maxOutputTokens) ||
    maxOutputTokens < 16 ||
    maxOutputTokens > 8192
  )
    fail("Choose an explicit model and output limit between 16 and 8192.");
  const source =
    typeof input === "string" ? [{ role: "user", content: input }] : input;
  if (!Array.isArray(source) || !source.length || source.length > 100)
    fail("Invalid explicit context.");
  const messages = [];
  const append = (role, block) => {
    const last = messages.at(-1);
    if (last?.role === role) last.content.push(block);
    else messages.push({ role, content: [block] });
  };
  for (const item of source) {
    if (!item || typeof item !== "object") fail("Invalid context item.");
    if (
      ["user", "assistant"].includes(item.role) &&
      typeof item.content === "string"
    )
      append(item.role, { type: "text", text: text(item.content) });
    else if (item.type === "function_call" && id(item.call_id) && id(item.name))
      append("assistant", {
        type: "tool_use",
        id: item.call_id,
        name: item.name,
        input: parseArgs(item.arguments),
      });
    else if (item.type === "function_call_output" && id(item.call_id))
      append("user", {
        type: "tool_result",
        tool_use_id: item.call_id,
        content: text(item.output, 32768),
      });
    else
      fail(
        "Unsupported Anthropic context. Reasoning, images and foreign provider items cannot be replayed.",
      );
  }
  if (messages[0].role !== "user")
    fail("Anthropic context must begin with a user message.");
  if (!Array.isArray(tools) || tools.length > 16)
    fail("Invalid function tool list.");
  const mappedTools = tools.map((tool) => {
    if (
      !tool ||
      tool.type !== "function" ||
      !id(tool.name) ||
      !tool.parameters ||
      typeof tool.parameters !== "object" ||
      Array.isArray(tool.parameters)
    )
      fail("Only explicit function schemas are supported.");
    return {
      name: tool.name,
      description: text(tool.description || "", 2000),
      input_schema: structuredClone(tool.parameters),
    };
  });
  if (new Set(mappedTools.map((x) => x.name)).size !== mappedTools.length)
    fail("Duplicate function names.");
  const result = {
    model,
    max_tokens: maxOutputTokens,
    stream: true,
    messages,
    ...(instructions !== undefined
      ? { system: text(instructions, 16384) }
      : {}),
    ...(mappedTools.length
      ? {
          tools: mappedTools,
          tool_choice: { type: "auto", disable_parallel_tool_use: true },
        }
      : {}),
  };
  if (Buffer.byteLength(JSON.stringify(result)) > INPUT_LIMIT)
    fail("Anthropic context exceeds 128 KiB.");
  return result;
}
export function directAnthropicTransport({
  body,
  key,
  signal,
  onDispatched = () => {},
}) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        agent: false,
        rejectUnauthorized: true,
        signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) =>
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: response,
        }),
    );
    request.on("finish", () => {
      try {
        onDispatched();
      } catch {
        request.destroy(Error("Consumer failed."));
      }
    });
    request.on("error", reject);
    request.end(body);
  });
}
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const stop = () =>
      reject(new AnthropicError("Request cancelled or timed out."));
    if (signal.aborted) {
      stop();
      return;
    }
    signal.addEventListener("abort", stop, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", stop));
  });
}
export class AnthropicProvider {
  constructor({
    credentials,
    transport = directAnthropicTransport,
    timeoutMs = 120000,
  } = {}) {
    this.credentials = credentials;
    this.transport = transport;
    this.timeoutMs = Math.min(300000, Math.max(20, timeoutMs));
  }
  async status() {
    const credential = await this.credentials.status();
    return {
      configured: credential.configured,
      source: credential.source,
      provider: "anthropic",
      connection: "not-verified",
      capabilities: ANTHROPIC_CAPABILITIES,
    };
  }
  async send(options = {}) {
    let visible = "",
      responseId = null,
      reportedUsage = null,
      bodyStream;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (options.signal?.aborted) cancel();
    else options.signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, this.timeoutMs);
    const emit = (event) => {
      try {
        options.onEvent?.(event);
      } catch {
        fail("Response consumer failed.");
      }
    };
    try {
      if (
        Object.keys(options).some(
          (key) =>
            ![
              "input",
              "instructions",
              "model",
              "maxOutputTokens",
              "tools",
              "signal",
              "onEvent",
            ].includes(key),
        )
      )
        fail(
          "Unsupported Anthropic option. Extended thinking and voice are not enabled.",
        );
      const request = payload(options);
      if (!(await this.credentials.status()).configured)
        fail(
          "Existing Anthropic API key is not available to the main process.",
        );
      if (controller.signal.aborted) fail("Request cancelled or timed out.");
      const key = await this.credentials.getKey();
      const response = await abortable(
        this.transport({
          body: JSON.stringify(request),
          key,
          signal: controller.signal,
          onDispatched: () => emit({ type: "request-dispatched" }),
        }),
        controller.signal,
      );
      bodyStream = response.body;
      if (response.status !== 200) {
        if ([401, 403].includes(response.status))
          fail(
            "Anthropic authorization failed. Check the selected key and project access.",
          );
        if (response.status === 429)
          fail("Anthropic rate or quota limit reached. No automatic retry.");
        fail("Anthropic request failed. No automatic retry.");
      }
      if (
        !/^text\/event-stream(?:\s*;|$)/i.test(
          response.headers?.["content-type"] || "",
        ) ||
        !bodyStream?.[Symbol.asyncIterator]
      )
        fail("Unsupported Anthropic stream format.");
      emit({ type: "status", status: "streaming" });
      const blocks = new Map(),
        allowed = new Set(request.tools?.map((x) => x.name) || []);
      let started = false,
        stopped = false,
        stopReason = null,
        inputTokens = null,
        outputTokens = null,
        cacheCreation = 0,
        cacheRead = 0,
        buffer = "",
        total = 0;
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const handle = (data) => {
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          fail("Invalid Anthropic stream JSON.");
        }
        if (!event || typeof event.type !== "string")
          fail("Invalid Anthropic event.");
        if (event.type === "ping") return;
        if (event.type === "error")
          fail("Anthropic reported a generation failure.");
        if (event.type === "message_start") {
          if (started || !id(event.message?.id))
            fail("Invalid Anthropic message start.");
          started = true;
          responseId = event.message.id;
          inputTokens = event.message.usage?.input_tokens;
          outputTokens = event.message.usage?.output_tokens;
          cacheCreation = event.message.usage?.cache_creation_input_tokens ?? 0;
          cacheRead = event.message.usage?.cache_read_input_tokens ?? 0;
          return;
        }
        if (!started) fail("Anthropic stream started out of order.");
        if (event.type === "content_block_start") {
          if (
            !Number.isSafeInteger(event.index) ||
            event.index < 0 ||
            event.index >= 100 ||
            blocks.has(event.index)
          )
            fail("Invalid content block index.");
          const b = event.content_block;
          if (b?.type === "text")
            blocks.set(event.index, {
              type: "text",
              text: text(b.text || "", OUTPUT_LIMIT),
              done: false,
            });
          else if (
            b?.type === "tool_use" &&
            id(b.id) &&
            id(b.name) &&
            allowed.has(b.name)
          ) {
            if (
              [...blocks.values()].some((x) => x.id === b.id) ||
              [...blocks.values()].filter((x) => x.type === "tool_use")
                .length >= 16
            )
              fail("Duplicate or excessive tool calls.");
            blocks.set(event.index, {
              type: "tool_use",
              id: b.id,
              name: b.name,
              arguments: "",
              initial: b.input,
              done: false,
            });
          } else
            fail(
              "Unsupported Anthropic content block. Extended thinking and server tools are disabled.",
            );
        } else if (event.type === "content_block_delta") {
          const b = blocks.get(event.index);
          if (!b || b.done) fail("Unknown or closed content block.");
          if (event.delta?.type === "text_delta" && b.type === "text") {
            const delta = text(event.delta.text, OUTPUT_LIMIT);
            b.text += delta;
            visible += delta;
            if (
              Buffer.byteLength(visible) > OUTPUT_LIMIT ||
              Buffer.byteLength(b.text) > OUTPUT_LIMIT
            )
              fail("Anthropic output exceeds limit.");
            emit({ type: "text-delta", delta });
          } else if (
            event.delta?.type === "input_json_delta" &&
            b.type === "tool_use"
          ) {
            b.arguments += text(event.delta.partial_json, 32768);
            if (Buffer.byteLength(b.arguments) > 32768)
              fail("Anthropic tool arguments exceed limit.");
          } else fail("Unsupported Anthropic delta.");
        } else if (event.type === "content_block_stop") {
          const b = blocks.get(event.index);
          if (!b || b.done) fail("Invalid content block stop.");
          b.done = true;
        } else if (event.type === "message_delta") {
          stopReason = event.delta?.stop_reason;
          if (event.usage?.input_tokens !== undefined)
            inputTokens = event.usage.input_tokens;
          if (event.usage?.output_tokens !== undefined)
            outputTokens = event.usage.output_tokens;
          if (event.usage?.cache_creation_input_tokens !== undefined)
            cacheCreation = event.usage.cache_creation_input_tokens;
          if (event.usage?.cache_read_input_tokens !== undefined)
            cacheRead = event.usage.cache_read_input_tokens;
        } else if (event.type === "message_stop") {
          if ([...blocks.values()].some((b) => !b.done) || !stopReason)
            fail("Anthropic completion has unfinished blocks.");
          stopped = true;
        } else fail("Unsupported Anthropic event.");
      };
      const iterator = bodyStream[Symbol.asyncIterator]();
      while (!stopped) {
        const next = await abortable(iterator.next(), controller.signal);
        if (next.done) break;
        const chunk =
          typeof next.value === "string" ? Buffer.from(next.value) : next.value;
        total += chunk.byteLength;
        if (total > STREAM_LIMIT) fail("Anthropic stream exceeds limit.");
        buffer += decoder.decode(chunk, { stream: true });
        let match;
        while ((match = /\r?\n\r?\n/.exec(buffer))) {
          const frame = buffer.slice(0, match.index);
          if (Buffer.byteLength(frame) > EVENT_LIMIT)
            fail("Anthropic event exceeds limit.");
          buffer = buffer.slice(match.index + match[0].length);
          const data = frame
            .split(/\r?\n/)
            .filter((x) => x.startsWith("data:"))
            .map((x) => x.slice(5).replace(/^ /, ""))
            .join("\n");
          if (data) handle(data);
          if (stopped) break;
        }
        if (Buffer.byteLength(buffer) > EVENT_LIMIT)
          fail("Anthropic event exceeds limit.");
      }
      if (!stopped)
        fail("Anthropic stream ended without confirmed completion.");
      const outputItems = [],
        functionCalls = [];
      visible = "";
      for (const [, b] of [...blocks.entries()].sort((a, b) => a[0] - b[0])) {
        if (b.type === "text") {
          visible += b.text;
          outputItems.push({ role: "assistant", content: b.text });
        } else {
          const args = b.arguments || JSON.stringify(b.initial ?? {});
          parseArgs(args);
          functionCalls.push({ callId: b.id, name: b.name, arguments: args });
          outputItems.push({
            type: "function_call",
            call_id: b.id,
            name: b.name,
            arguments: args,
          });
        }
      }
      if (
        Buffer.byteLength(visible) > OUTPUT_LIMIT ||
        Buffer.byteLength(JSON.stringify(outputItems)) > INPUT_LIMIT
      )
        fail("Anthropic continuation exceeds limit.");
      if (
        [inputTokens, outputTokens, cacheCreation, cacheRead].every(
          (value) => Number.isSafeInteger(value) && value >= 0,
        ) &&
        Number.isSafeInteger(
          inputTokens + cacheCreation + cacheRead + outputTokens,
        )
      )
        reportedUsage = {
          inputTokens: inputTokens + cacheCreation + cacheRead,
          outputTokens,
          totalTokens: inputTokens + cacheCreation + cacheRead + outputTokens,
        };
      if (
        ![
          "end_turn",
          "tool_use",
          "max_tokens",
          "stop_sequence",
          "refusal",
          "pause_turn",
        ].includes(stopReason)
      )
        fail("Unsupported Anthropic stop reason.");
      if (stopReason === "tool_use" && !functionCalls.length)
        fail("Tool stop without complete tool calls.");
      if (functionCalls.length && stopReason !== "tool_use")
        fail("Function calls were not confirmed by tool stop.");
      const status = ["max_tokens", "pause_turn", "refusal"].includes(
        stopReason,
      )
        ? "incomplete"
        : "completed";
      emit({ type: "status", status });
      return {
        status,
        text: visible,
        responseId,
        usage: reportedUsage,
        functionCalls,
        outputItems,
        ...(stopReason === "refusal"
          ? {
              refused: true,
              error:
                "Anthropic declined to complete this request. Any partial text is not a completed answer.",
            }
          : {}),
      };
    } catch (error) {
      return {
        status: controller.signal.aborted ? "cancelled" : "error",
        text: visible,
        responseId,
        usage: reportedUsage,
        functionCalls: [],
        outputItems: [],
        error:
          error instanceof AnthropicError
            ? error.message
            : "Anthropic request failed safely. Check connectivity and configuration.",
      };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
      controller.abort();
      bodyStream?.destroy?.();
    }
  }
}
