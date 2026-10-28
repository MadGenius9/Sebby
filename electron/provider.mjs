import https from "node:https";
const MAX_INPUT = 128 * 1024,
  MAX_EVENT = 256 * 1024,
  MAX_STREAM = 2 * 1024 * 1024,
  MAX_OUTPUT = 256 * 1024;
class ProviderError extends Error {}
const fail = (message) => {
  throw new ProviderError(message);
};
function text(value, max = MAX_INPUT) {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value) > max ||
    value.includes("\0")
  )
    fail("Invalid or oversized request text.");
  return value;
}
function identifier(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,200}$/.test(value);
}
function reasoningItem(item) {
  if (
    !identifier(item.id) ||
    typeof item.encrypted_content !== "string" ||
    !item.encrypted_content
  )
    fail(
      "Reasoning continuation lacks encrypted state; this model response cannot be safely continued.",
    );
  text(item.encrypted_content, 65536);
  if (!Array.isArray(item.summary) || item.summary.length > 20)
    fail("Invalid reasoning summary metadata.");
  const summary = item.summary.map((part) => {
    if (!part || part.type !== "summary_text")
      fail("Unsupported reasoning summary metadata.");
    return { type: "summary_text", text: text(part.text, 4096) };
  });
  return {
    type: "reasoning",
    id: item.id,
    summary,
    encrypted_content: item.encrypted_content,
    ...(["completed", "incomplete"].includes(item.status)
      ? { status: item.status }
      : {}),
  };
}
function replayItem(item) {
  if (item?.type === "reasoning") return reasoningItem(item);
  if (
    item?.type === "message" &&
    item.role === "assistant" &&
    Array.isArray(item.content) &&
    item.content.length <= 20
  ) {
    const content = item.content.map((part) => {
      if (part?.type === "output_text")
        return {
          type: "output_text",
          text: text(part.text, MAX_OUTPUT),
          annotations: [],
        };
      if (part?.type === "refusal")
        return { type: "refusal", refusal: text(part.refusal, 8192) };
      fail("Unsupported assistant content item.");
    });
    if (
      item.phase !== undefined &&
      !["commentary", "final_answer"].includes(item.phase)
    )
      fail("Unsupported assistant message phase.");
    return {
      type: "message",
      role: "assistant",
      content,
      ...(item.phase ? { phase: item.phase } : {}),
      ...(identifier(item.id) ? { id: item.id } : {}),
      ...(["completed", "incomplete"].includes(item.status)
        ? { status: item.status }
        : {}),
    };
  }
  if (
    item?.type === "function_call" &&
    identifier(item.call_id) &&
    identifier(item.name)
  )
    return {
      type: "function_call",
      call_id: item.call_id,
      name: item.name,
      arguments: text(item.arguments, 32768),
      ...(identifier(item.id) ? { id: item.id } : {}),
    };
  fail("Unsupported provider output item cannot be safely replayed.");
}
function normalizeInput(input) {
  if (typeof input === "string") return text(input);
  if (!Array.isArray(input) || !input.length || input.length > 100)
    fail("Input must contain 1–100 explicit context items.");
  return input.map((item) => {
    if (!item || typeof item !== "object") fail("Invalid context item.");
    if (item.type === "reasoning" || item.type === "message")
      return replayItem(item);
    if (
      ["user", "assistant"].includes(item.role) &&
      typeof item.content === "string"
    )
      return { role: item.role, content: text(item.content) };
    if (
      item.type === "function_call" &&
      identifier(item.call_id) &&
      identifier(item.name)
    )
      return {
        type: "function_call",
        call_id: item.call_id,
        name: item.name,
        arguments: text(item.arguments, 32768),
      };
    if (item.type === "function_call_output" && identifier(item.call_id))
      return {
        type: "function_call_output",
        call_id: item.call_id,
        output: text(item.output, 32768),
      };
    fail(
      "Unsupported context item; images, files and implicit authority roles are disabled.",
    );
  });
}
function payloadFor({
  input,
  instructions,
  model,
  maxOutputTokens = 2048,
  tools = [],
}) {
  if (
    typeof model !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,100}$/.test(model)
  )
    fail("Choose an explicit valid model identifier.");
  if (
    !Number.isInteger(maxOutputTokens) ||
    maxOutputTokens < 16 ||
    maxOutputTokens > 8192
  )
    fail("Output token limit must be 16–8192.");
  if (!Array.isArray(tools) || tools.length > 16)
    fail("Too many function tools.");
  const validatedTools = tools.map((tool) => {
    if (
      !tool ||
      tool.type !== "function" ||
      !identifier(tool.name) ||
      !tool.parameters ||
      typeof tool.parameters !== "object" ||
      Array.isArray(tool.parameters)
    )
      fail("Only explicit local function schemas are supported.");
    const result = {
      type: "function",
      name: tool.name,
      description: text(tool.description || "", 2000),
      parameters: structuredClone(tool.parameters),
      strict: tool.strict === true,
    };
    if (Buffer.byteLength(JSON.stringify(result)) > 32768)
      fail("Function schema exceeds limit.");
    return result;
  });
  if (new Set(validatedTools.map((t) => t.name)).size !== validatedTools.length)
    fail("Duplicate function names are not allowed.");
  const payload = {
    model,
    input: normalizeInput(input),
    stream: true,
    store: false,
    include: ["reasoning.encrypted_content"],
    max_output_tokens: maxOutputTokens,
    ...(instructions !== undefined
      ? { instructions: text(instructions, 16384) }
      : {}),
    ...(validatedTools.length
      ? { tools: validatedTools, parallel_tool_calls: false }
      : {}),
  };
  if (Buffer.byteLength(JSON.stringify(payload)) > MAX_INPUT)
    fail("Explicit request context exceeds 128 KiB.");
  return payload;
}
/** Fixed official endpoint, direct TLS, no redirects, environment proxy or retries. */
export function directResponsesTransport({
  body,
  key,
  signal,
  onDispatched = () => {},
}) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        agent: false,
        signal,
        rejectUnauthorized: true,
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${key}`,
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
    const abort = () =>
      reject(new ProviderError("Request cancelled or timed out."));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
function usage(value) {
  if (!value) return null;
  const keys = ["input_tokens", "output_tokens", "total_tokens"];
  if (keys.some((k) => !Number.isSafeInteger(value[k]) || value[k] < 0))
    return null;
  return {
    inputTokens: value.input_tokens,
    outputTokens: value.output_tokens,
    totalTokens: value.total_tokens,
  };
}
export class ResponsesProvider {
  constructor({
    credentials,
    transport = directResponsesTransport,
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
      provider: "openai",
      connection: "not-verified",
    };
  }
  async send({ signal, onEvent = () => {}, ...options } = {}) {
    let output = "",
      responseId = null,
      reportedUsage = null,
      terminal = null;
    const calls = new Map();
    const replay = new Map();
    let bodyStream;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, this.timeoutMs);
    const emit = (event) => {
      try {
        onEvent(event);
      } catch {
        fail("Response consumer failed.");
      }
    };
    try {
      const payload = payloadFor(options);
      if (!(await this.credentials.status()).configured)
        fail(
          "Existing OpenAI API key is not available to the Sebby main process.",
        );
      if (controller.signal.aborted) fail("Request cancelled or timed out.");
      const key = await this.credentials.getKey();
      const response = await abortable(
        this.transport({
          body: JSON.stringify(payload),
          key,
          signal: controller.signal,
          onDispatched: () => emit({ type: "request-dispatched" }),
        }),
        controller.signal,
      );
      bodyStream = response.body;
      if (response.status !== 200) {
        if (response.status === 401 || response.status === 403)
          fail(
            "Provider authorization failed. Check your existing key and project access.",
          );
        if (response.status === 429)
          fail(
            "Provider rate or quota limit reached. No automatic retry was attempted.",
          );
        fail("Provider request failed. No automatic retry was attempted.");
      }
      if (
        !/^text\/event-stream(?:\s*;|$)/i.test(
          response.headers?.["content-type"] || "",
        )
      )
        fail("Provider returned an unsupported response format.");
      if (!bodyStream?.[Symbol.asyncIterator])
        fail("Provider stream is unavailable.");
      emit({ type: "status", status: "streaming" });
      let buffer = "",
        total = 0;
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const allowedNames = new Set(payload.tools?.map((x) => x.name) || []);
      const remember = (event, item) => {
        const index =
          event.output_index === undefined ? replay.size : event.output_index;
        if (
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= 100 ||
          replay.has(index) ||
          replay.size >= 100
        )
          fail("Invalid or duplicate output item index.");
        replay.set(index, item);
      };
      const handle = (data) => {
        if (data === "[DONE]") return;
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          fail("Provider returned invalid stream data.");
        }
        if (!event || typeof event.type !== "string")
          fail("Invalid provider event.");
        if (event.type === "response.created") {
          if (identifier(event.response?.id)) responseId = event.response.id;
        } else if (event.type === "response.output_text.delta") {
          const delta = text(event.delta, MAX_EVENT);
          if (Buffer.byteLength(output) + Buffer.byteLength(delta) > MAX_OUTPUT)
            fail("Provider output exceeded the local size limit.");
          output += delta;
          emit({ type: "text-delta", delta });
        } else if (
          event.type === "response.output_item.done" &&
          event.item?.type === "reasoning"
        ) {
          const normalized = reasoningItem(event.item);
          remember(event, normalized);
        } else if (
          event.type === "response.output_item.done" &&
          event.item?.type === "message"
        ) {
          const normalized = replayItem(event.item);
          remember(event, normalized);
          if (!output) {
            const visible = normalized.content
              .map((part) =>
                part.type === "refusal" ? part.refusal : part.text,
              )
              .join("");
            if (Buffer.byteLength(visible) > MAX_OUTPUT)
              fail("Provider output exceeded the local size limit.");
            output = visible;
            if (visible) emit({ type: "text-delta", delta: visible });
          }
        } else if (
          event.type === "response.output_item.done" &&
          event.item?.type === "function_call"
        ) {
          const item = event.item;
          if (
            !identifier(item.call_id) ||
            !identifier(item.name) ||
            !allowedNames.has(item.name)
          )
            fail("Provider requested an undeclared function.");
          text(item.arguments, 32768);
          if (calls.has(item.call_id) || calls.size >= 16)
            fail("Duplicate or excessive function calls.");
          try {
            const args = JSON.parse(item.arguments);
            if (!args || typeof args !== "object" || Array.isArray(args))
              throw Error();
          } catch {
            fail("Provider function arguments are not a JSON object.");
          }
          calls.set(item.call_id, {
            callId: item.call_id,
            name: item.name,
            arguments: item.arguments,
          });
          remember(event, replayItem(item));
        } else if (event.type === "response.output_item.done")
          fail("Unsupported provider output item cannot be safely continued.");
        else if (
          ["response.completed", "response.incomplete"].includes(event.type)
        ) {
          const item = event.response;
          if (!identifier(item?.id))
            fail("Provider completion lacks a response identifier.");
          if (item.output !== undefined) {
            if (!Array.isArray(item.output) || item.output.length > 100)
              fail("Invalid terminal output inventory.");
            const finalItems = item.output.map(replayItem);
            const seenItems = [...replay.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([, value]) => value);
            if (JSON.stringify(finalItems) !== JSON.stringify(seenItems))
              fail(
                "Provider terminal output did not match completed stream items.",
              );
          }
          if (responseId && responseId !== item.id)
            fail("Provider response identifier changed.");
          responseId = item.id;
          reportedUsage = usage(item.usage);
          terminal =
            event.type === "response.completed" ? "completed" : "incomplete";
        } else if (["error", "response.failed"].includes(event.type))
          fail("Provider reported a generation failure.");
      };
      const iterator = bodyStream[Symbol.asyncIterator]();
      while (!terminal) {
        const next = await abortable(iterator.next(), controller.signal);
        if (next.done) break;
        const chunk =
          typeof next.value === "string" ? Buffer.from(next.value) : next.value;
        total += chunk.byteLength;
        if (total > MAX_STREAM)
          fail("Provider stream exceeded the local size limit.");
        buffer += decoder.decode(chunk, { stream: true });
        let match;
        while ((match = /\r?\n\r?\n/.exec(buffer))) {
          const frame = buffer.slice(0, match.index);
          if (Buffer.byteLength(frame) > MAX_EVENT)
            fail("Provider event exceeded the local size limit.");
          buffer = buffer.slice(match.index + match[0].length);
          const data = frame
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).replace(/^ /, ""))
            .join("\n");
          if (data) handle(data);
          if (terminal) break;
        }
        if (Buffer.byteLength(buffer) > MAX_EVENT)
          fail("Provider event exceeded the local size limit.");
      }
      if (!terminal) fail("Provider stream ended before confirmed completion.");
      const messageItems = [...replay.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, item]) => item)
        .filter((item) => item.type === "message");
      if (messageItems.length) {
        output = messageItems
          .flatMap((item) =>
            item.content.map((part) =>
              part.type === "refusal" ? part.refusal : part.text,
            ),
          )
          .join("");
        if (Buffer.byteLength(output) > MAX_OUTPUT)
          fail("Provider output exceeded the local size limit.");
      }
      const functionCalls = [...calls.values()];
      const outputItems = [...replay.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, item]) => item);
      if (output && !outputItems.some((item) => item.type === "message"))
        outputItems.unshift({ role: "assistant", content: output });
      if (Buffer.byteLength(JSON.stringify(outputItems)) > MAX_INPUT)
        fail("Continuation context exceeds the local limit.");
      emit({ type: "status", status: terminal });
      return {
        status: terminal,
        text: output,
        responseId,
        usage: reportedUsage,
        functionCalls,
        outputItems,
      };
    } catch (error) {
      const status = controller.signal.aborted ? "cancelled" : "error";
      return {
        status,
        text: output,
        responseId,
        usage: reportedUsage,
        functionCalls: [],
        outputItems: [],
        error:
          error instanceof ProviderError
            ? error.message
            : "Provider request failed safely. Check connectivity and configuration.",
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      controller.abort();
      bodyStream?.destroy?.();
    }
  }
}
