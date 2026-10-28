import test from "node:test";
import assert from "node:assert/strict";
import { XaiProvider, XAI_CAPABILITIES } from "../electron/xai-provider.mjs";
const credentials = {
  status: () => ({ configured: true, source: "test" }),
  getKey: () => "FAKE_NOT_REAL_XAI_CREDENTIAL",
};
function mock(events, capture = () => {}) {
  return async (req) => {
    capture(JSON.parse(req.body));
    req.onDispatched();
    return {
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: (async function* () {
        yield Buffer.from(
          events.map((x) => `data: ${JSON.stringify(x)}\n\n`).join(""),
        );
      })(),
    };
  };
}
const done = {
  type: "response.completed",
  response: {
    id: "resp_xai",
    usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
  },
};
test("xAI uses confirmed Responses subset and xAI status instead of OpenAI branding", async () => {
  let sent;
  const p = new XaiProvider({
    credentials,
    transport: mock(
      [{ type: "response.output_text.delta", delta: "Hi" }, done],
      (body) => (sent = body),
    ),
  });
  assert.equal((await p.status()).provider, "xai");
  const result = await p.send({ model: "user-chosen-grok", input: "Hi" });
  assert.equal(result.text, "Hi");
  assert.equal(result.status, "completed");
  assert.equal(sent.store, false);
  assert.deepEqual(sent.include, ["reasoning.encrypted_content"]);
  assert.equal(XAI_CAPABILITIES.voice, false);
});
test("xAI declared function and encrypted reasoning replay are bounded main-only output", async () => {
  const values = [
    {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "reasoning",
        id: "rs_xai",
        summary: [],
        encrypted_content: "XAI_OPAQUE",
      },
    },
    {
      type: "response.output_item.done",
      output_index: 1,
      item: {
        type: "function_call",
        call_id: "call_xai",
        name: "read",
        arguments: "{}",
      },
    },
    done,
  ];
  const events = [];
  const p = new XaiProvider({ credentials, transport: mock(values) });
  const result = await p.send({
    model: "grok-selected",
    input: "x",
    tools: [{ type: "function", name: "read", parameters: { type: "object" } }],
    onEvent: (x) => events.push(x),
  });
  assert.equal(result.status, "completed");
  assert.equal(result.outputItems[0].encrypted_content, "XAI_OPAQUE");
  assert.equal(JSON.stringify(events).includes("XAI_OPAQUE"), false);
});
test("xAI rejects unsupported options and blocks missing credentials before network", async () => {
  let calls = 0;
  const p = new XaiProvider({ credentials, transport: async () => calls++ });
  assert.equal(
    (await p.send({ model: "grok", input: "x", voice: true })).status,
    "error",
  );
  const missing = new XaiProvider({
    credentials: { status: () => ({ configured: false }) },
    transport: async () => calls++,
  });
  const result = await missing.send({ model: "grok", input: "x" });
  assert.match(result.error, /xAI/);
  assert.equal(calls, 0);
});
