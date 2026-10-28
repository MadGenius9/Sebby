import test from "node:test";
import assert from "node:assert/strict";
import {
  AnthropicProvider,
  ANTHROPIC_CAPABILITIES,
} from "../electron/anthropic-provider.mjs";
const credentials = {
  status: () => ({ configured: true, source: "test" }),
  getKey: () => "FAKE_NOT_REAL_ANTHROPIC_CREDENTIAL",
};
const start = {
  type: "message_start",
  message: { id: "msg_test", usage: { input_tokens: 10, output_tokens: 0 } },
};
function events(
  block = { type: "text", text: "" },
  deltas = [{ type: "text_delta", text: "Hello" }],
  reason = "end_turn",
) {
  return [
    start,
    { type: "content_block_start", index: 0, content_block: block },
    ...deltas.map((delta) => ({
      type: "content_block_delta",
      index: 0,
      delta,
    })),
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: reason },
      usage: { output_tokens: 4 },
    },
    { type: "message_stop" },
  ];
}
function transport(values, onRequest = () => {}) {
  return async (req) => {
    onRequest(JSON.parse(req.body));
    req.onDispatched();
    const raw = values
      .map((x) => `event: ${x.type}\ndata: ${JSON.stringify(x)}\n\n`)
      .join("");
    return {
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: (async function* () {
        for (let i = 0; i < raw.length; i += 11)
          yield Buffer.from(raw.slice(i, i + 11));
      })(),
    };
  };
}
test("Anthropic text streams and uses native Messages shape, no Responses assumptions", async () => {
  let sent;
  const seen = [];
  const p = new AnthropicProvider({
    credentials,
    transport: transport(events(), (body) => (sent = body)),
  });
  const result = await p.send({
    model: "user-selected-claude",
    input: "Hi",
    instructions: "Trusted app rule",
    onEvent: (x) => seen.push(x),
  });
  assert.equal(result.status, "completed");
  assert.equal(result.text, "Hello");
  assert.deepEqual(result.usage, {
    inputTokens: 10,
    outputTokens: 4,
    totalTokens: 14,
  });
  assert.equal(sent.max_tokens, 2048);
  assert.equal(sent.system, "Trusted app rule");
  assert.equal(sent.store, undefined);
  assert.deepEqual(sent.messages, [
    { role: "user", content: [{ type: "text", text: "Hi" }] },
  ]);
  assert.equal(seen[0].type, "request-dispatched");
});
test("Anthropic tool use is captured and replay translates to tool_use/tool_result", async () => {
  let sent;
  const p = new AnthropicProvider({
    credentials,
    transport: transport(
      events(
        { type: "tool_use", id: "toolu_1", name: "read_file", input: {} },
        [{ type: "input_json_delta", partial_json: '{"path":"a.txt"}' }],
        "tool_use",
      ),
      (body) => (sent = body),
    ),
  });
  const result = await p.send({
    model: "claude-selected",
    input: [
      { role: "user", content: "read" },
      {
        type: "function_call",
        call_id: "prior",
        name: "read_file",
        arguments: "{}",
      },
      { type: "function_call_output", call_id: "prior", output: "result" },
    ],
    tools: [
      { type: "function", name: "read_file", parameters: { type: "object" } },
    ],
  });
  assert.equal(result.status, "completed");
  assert.equal(result.functionCalls[0].callId, "toolu_1");
  assert.equal(sent.messages[1].content[0].type, "tool_use");
  assert.equal(sent.messages[2].content[0].type, "tool_result");
  assert.equal(sent.tools[0].input_schema.type, "object");
});
test("Anthropic thinking/foreign replay and unsupported options fail before dispatch", async () => {
  let calls = 0;
  const p = new AnthropicProvider({
    credentials,
    transport: async () => calls++,
  });
  for (const input of [
    [{ type: "reasoning", id: "rs", encrypted_content: "opaque" }],
    [{ role: "system", content: "bad" }],
  ])
    assert.equal((await p.send({ model: "claude", input })).status, "error");
  assert.equal(
    (
      await p.send({
        model: "claude",
        input: "x",
        thinking: { type: "enabled" },
      })
    ).status,
    "error",
  );
  assert.equal(calls, 0);
  assert.equal(ANTHROPIC_CAPABILITIES.reasoningReplay, false);
});
test("Anthropic unapproved tools, thinking blocks, bad JSON and premature EOF fail closed", async () => {
  for (const stream of [
    events(
      { type: "tool_use", id: "toolu_1", name: "evil", input: {} },
      [],
      "tool_use",
    ),
    events({ type: "thinking", thinking: "private" }, []),
    events(
      { type: "tool_use", id: "toolu_1", name: "read", input: {} },
      [{ type: "input_json_delta", partial_json: "{broken" }],
      "tool_use",
    ),
    [start],
  ]) {
    const p = new AnthropicProvider({
      credentials,
      transport: transport(stream),
    });
    const result = await p.send({
      model: "claude",
      input: "x",
      tools: [
        { type: "function", name: "read", parameters: { type: "object" } },
      ],
    });
    assert.equal(result.status, "error");
    assert.deepEqual(result.functionCalls, []);
  }
});
test("Anthropic missing key, auth errors and cancellation do not retry or leak secrets", async () => {
  let calls = 0;
  const missing = new AnthropicProvider({
    credentials: { status: () => ({ configured: false }) },
    transport: async () => calls++,
  });
  assert.equal(
    (await missing.send({ model: "claude", input: "x" })).status,
    "error",
  );
  assert.equal(calls, 0);
  const unauthorized = new AnthropicProvider({
    credentials,
    transport: async () => {
      calls++;
      return { status: 401, body: null };
    },
  });
  const bad = await unauthorized.send({ model: "claude", input: "x" });
  assert.equal(bad.status, "error");
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(bad).includes("FAKE_NOT_REAL"), false);
  const p = new AnthropicProvider({
    credentials,
    transport: () => new Promise(() => {}),
    timeoutMs: 20,
  });
  assert.equal(
    (await p.send({ model: "claude", input: "x" })).status,
    "cancelled",
  );
});
test("Anthropic token cutoff remains incomplete, not an approved tool result", async () => {
  const p = new AnthropicProvider({
    credentials,
    transport: transport(events(undefined, undefined, "max_tokens")),
  });
  assert.equal(
    (await p.send({ model: "claude", input: "x" })).status,
    "incomplete",
  );
});
test("Anthropic refusal is explicitly incomplete with safe refusal notice", async () => {
  const p = new AnthropicProvider({
    credentials,
    transport: transport(events(undefined, undefined, "refusal")),
  });
  const result = await p.send({ model: "claude", input: "x" });
  assert.equal(result.status, "incomplete");
  assert.equal(result.refused, true);
  assert.match(result.error, /declined/);
});
