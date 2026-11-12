import http from "node:http";
import { randomUUID } from "node:crypto";
export const OLLAMA_CAPABILITIES = Object.freeze({
  chat: true,
  tools: true,
  reasoningReplay: false,
  voice: false,
  modelDiscovery: true,
});
const LIMIT = 2 * 1024 * 1024;
// Fixed loopback destination; no redirects, proxy settings, credentials or model pulls.
export function localTransport(route, body, signal) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: 11434,
        path: route,
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : {},
        signal,
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(
            Error(
              "Local Ollama request failed. Check the installed model and server.",
            ),
          );
          return;
        }
        resolve(response);
      },
    );
    request.setTimeout(120000, () =>
      request.destroy(Error("Local model timed out.")),
    );
    request.on("error", () =>
      reject(Error("Ollama is unavailable at 127.0.0.1:11434.")),
    );
    request.end(body ? JSON.stringify(body) : undefined);
  });
}
async function jsonBody(stream) {
  let size = 0,
    chunks = [];
  for await (const chunk of stream) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > LIMIT) {
      stream.destroy?.();
      throw Error("Local response exceeds limit.");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const modelName = (value) =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/.test(value) &&
  !/cloud/i.test(value);
const bounded = (value) => {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value) > 128 * 1024 ||
    value.includes("\0")
  )
    throw Error("Invalid local model text.");
  return value;
};
export class OllamaProvider {
  constructor({ transport = localTransport } = {}) {
    this.transport = transport;
  }
  async status() {
    return {
      configured: true,
      provider: "ollama",
      source: "local-runtime",
      connection: "not-verified",
    };
  }
  async listModels(signal = AbortSignal.timeout(5000)) {
    const data = await jsonBody(
      await this.transport("/api/tags", null, signal),
    );
    if (!Array.isArray(data.models) || data.models.length > 500)
      throw Error("Invalid local model list.");
    return data.models
      .filter(
        (m) =>
          modelName(m.name) &&
          !m.remote_host &&
          !m.remote_model &&
          Number.isFinite(m.size) &&
          m.size > 0,
      )
      .map((m) => ({ name: m.name, size: m.size }));
  }
  async send({
    input,
    instructions = "",
    model,
    maxOutputTokens = 2048,
    tools = [],
    signal,
    onEvent = () => {},
  }) {
    let dispatched = false;
    const responseId = `local-${randomUUID()}`;
    try {
      if (!modelName(model))
        throw Error("Choose an installed local model, not a cloud model.");
      if (
        !Number.isInteger(maxOutputTokens) ||
        maxOutputTokens < 16 ||
        maxOutputTokens > 8192
      )
        throw Error("Invalid output limit.");
      const combined = AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(180000),
      ]);
      combined.throwIfAborted();
      const models = await this.listModels(combined);
      if (!models.some((m) => m.name === model || m.name === model + ":latest"))
        throw Error(
          "Model is not installed locally. Use Refresh installed models in Settings.",
        );
      const items =
        typeof input === "string" ? [{ role: "user", content: input }] : input;
      if (
        !Array.isArray(items) ||
        !items.length ||
        items.length > 100 ||
        !Array.isArray(tools) ||
        tools.length > 16
      )
        throw Error("Invalid local context.");
      const messages = [{ role: "system", content: bounded(instructions) }],
        calls = new Map();
      for (const item of items) {
        if (
          ["user", "assistant"].includes(item?.role) &&
          typeof item.content === "string"
        )
          messages.push({ role: item.role, content: bounded(item.content) });
        else if (
          item?.type === "function_call" &&
          /^[a-zA-Z0-9_-]{1,80}$/.test(item.name)
        ) {
          const args = JSON.parse(bounded(item.arguments));
          if (!args || typeof args !== "object" || Array.isArray(args))
            throw Error("Invalid tool arguments.");
          calls.set(item.call_id, item.name);
          messages.push({
            role: "assistant",
            content: "",
            tool_calls: [{ function: { name: item.name, arguments: args } }],
          });
        } else if (
          item?.type === "function_call_output" &&
          calls.has(item.call_id)
        )
          messages.push({
            role: "tool",
            tool_name: calls.get(item.call_id),
            content: bounded(item.output),
          });
        else throw Error("Unsupported local conversation item.");
      }
      const definitions = tools.map((t) => {
        if (
          t?.type !== "function" ||
          !/^[a-zA-Z0-9_-]{1,80}$/.test(t.name) ||
          !t.parameters ||
          typeof t.parameters !== "object"
        )
          throw Error("Invalid tool schema.");
        return {
          type: "function",
          function: {
            name: t.name,
            description: bounded(t.description || ""),
            parameters: t.parameters,
          },
        };
      });
      const payload = {
        model,
        messages,
        stream: true,
        // This adapter exposes final text, not a reasoning stream. Thinking
        // models otherwise spend the small connection-test budget invisibly.
        think: false,
        options: { num_predict: maxOutputTokens },
        ...(definitions.length ? { tools: definitions } : {}),
      };
      if (Buffer.byteLength(JSON.stringify(payload)) > 256 * 1024)
        throw Error("Local context exceeds limit.");
      combined.throwIfAborted();
      const stream = await this.transport("/api/chat", payload, combined);
      dispatched = true;
      onEvent({ type: "request-dispatched" });
      let pending = "",
        size = 0,
        text = "",
        final = null,
        functionCalls = [];
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const consume = (line) => {
        if (!line.trim()) return;
        if (final) throw Error("Unexpected data after completion.");
        const event = JSON.parse(line);
        if (event.error) throw Error("Local model reported an error.");
        if (event.message?.content) {
          const delta = bounded(event.message.content);
          text += delta;
          if (Buffer.byteLength(text) > 64 * 1024)
            throw Error("Local output exceeds limit.");
          onEvent({ type: "text-delta", delta });
        }
        for (const call of event.message?.tool_calls || []) {
          if (
            !definitions.some((t) => t.function.name === call.function?.name) ||
            !call.function?.arguments ||
            typeof call.function.arguments !== "object" ||
            Array.isArray(call.function.arguments)
          )
            throw Error("Unexpected local tool call.");
          functionCalls.push({
            callId: `local-${randomUUID()}`,
            name: call.function.name,
            arguments: JSON.stringify(call.function.arguments),
          });
          if (functionCalls.length > 8)
            throw Error("Too many local tool calls.");
        }
        if (event.done === true) final = event;
      };
      try {
        for await (const chunk of stream) {
          combined.throwIfAborted();
          size += Buffer.byteLength(chunk);
          if (size > LIMIT) throw Error("Local stream exceeds limit.");
          pending += decoder.decode(chunk, { stream: true });
          let newline;
          while ((newline = pending.indexOf("\n")) >= 0) {
            consume(pending.slice(0, newline));
            pending = pending.slice(newline + 1);
          }
        }
        pending += decoder.decode();
        consume(pending);
      } finally {
        stream.destroy?.();
      }
      combined.throwIfAborted();
      if (!final) throw Error("Local stream ended before completion.");
      const complete = final.done_reason === "stop";
      const usage =
        Number.isSafeInteger(final.prompt_eval_count) &&
        final.prompt_eval_count >= 0 &&
        Number.isSafeInteger(final.eval_count) &&
        final.eval_count >= 0
          ? {
              inputTokens: final.prompt_eval_count,
              outputTokens: final.eval_count,
              totalTokens: final.prompt_eval_count + final.eval_count,
            }
          : null;
      return {
        status: complete ? "completed" : "incomplete",
        responseId,
        text,
        usage,
        functionCalls: complete ? functionCalls : [],
      };
    } catch (error) {
      return {
        status: signal?.aborted ? "cancelled" : "error",
        responseId: dispatched ? responseId : null,
        text: "",
        usage: null,
        functionCalls: [],
        error: signal?.aborted
          ? "Local request cancelled."
          : "Local model request failed. Check Ollama, the installed model, and available RAM. No cloud fallback was used.",
      };
    }
  }
}
