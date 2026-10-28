import test from "node:test";
import assert from "node:assert/strict";
import { ResponsesProvider } from "../electron/provider.mjs";
import { RuntimeCredentials } from "../electron/credentials.mjs";
const credentials = new RuntimeCredentials({
  env: { OPENAI_API_KEY: "TEST_ONLY_NOT_A_REAL_KEY_123456" },
});
const delta = (text) => ({ type: "response.output_text.delta", delta: text });
const done = (extra = {}) => ({
  type: "response.completed",
  response: {
    id: "resp_test",
    usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 },
    ...extra,
  },
});
const frame = (event) => `data: ${JSON.stringify(event)}\n\n`;
function mock(events, { split = 0, status = 200 } = {}) {
  return async ({ onDispatched }) => {
    onDispatched?.();
    const encoded = events.map(frame).join("");
    return {
      status,
      headers: { "content-type": "text/event-stream" },
      body: (async function* () {
        if (split)
          for (let i = 0; i < encoded.length; i += split)
            yield Buffer.from(encoded.slice(i, i + split));
        else yield Buffer.from(encoded);
      })(),
    };
  };
}
test("Responses streaming uses explicit bounded context, store false and reports real usage", async () => {
  let sent;
  const events = [];
  const provider = new ResponsesProvider({
    credentials,
    transport: async (req) => {
      sent = JSON.parse(req.body);
      return mock([delta("Hello"), done()], { split: 7 })(req);
    },
  });
  const result = await provider.send({
    model: "user-chosen-model",
    input: "Hello",
    onEvent: (e) => events.push(e),
  });
  assert.equal(result.status, "completed");
  assert.equal(result.text, "Hello");
  assert.deepEqual(result.usage, {
    inputTokens: 12,
    outputTokens: 3,
    totalTokens: 15,
  });
  assert.equal(sent.store, false);
  assert.equal(sent.stream, true);
  assert.equal(events[0].type, "request-dispatched");
  assert.equal(JSON.stringify(events).includes("TEST_ONLY"), false);
});
test("missing credential and invalid request fail before any transport", async () => {
  let requests = 0;
  for (const options of [
    {
      model: "model",
      input: "x",
      credentials: new RuntimeCredentials({ env: {} }),
    },
    { input: "x" },
    { model: "model", input: [{ role: "system", content: "x" }] },
    { model: "model", input: "x".repeat(140000) },
    { model: "model", input: "x", maxOutputTokens: 99999 },
  ]) {
    const provider = new ResponsesProvider({
      credentials: options.credentials || credentials,
      transport: async () => {
        requests++;
      },
    });
    const result = await provider.send(options);
    assert.equal(result.status, "error");
  }
  assert.equal(requests, 0);
});
test("captures declared function calls but never executes and supports function output replay", async () => {
  const call = {
    type: "response.output_item.done",
    item: {
      type: "function_call",
      call_id: "call_1",
      name: "read_file",
      arguments: '{"path":"a.txt"}',
    },
  };
  const provider = new ResponsesProvider({
    credentials,
    transport: mock([call, done()]),
  });
  const result = await provider.send({
    model: "model",
    input: [
      { role: "user", content: "read it" },
      {
        type: "function_call",
        call_id: "old",
        name: "read_file",
        arguments: "{}",
      },
      { type: "function_call_output", call_id: "old", output: "context" },
    ],
    tools: [
      { type: "function", name: "read_file", parameters: { type: "object" } },
    ],
  });
  assert.equal(result.status, "completed");
  assert.equal(result.functionCalls[0].callId, "call_1");
  assert.equal(result.outputItems[0].type, "function_call");
});
test("undeclared/duplicate calls and malformed arguments are rejected", async () => {
  for (const calls of [
    [{ name: "unknown", arguments: "{}" }],
    [{ name: "read_file", arguments: "not-json" }],
    [
      { name: "read_file", arguments: "{}" },
      { name: "read_file", arguments: "{}" },
    ],
  ]) {
    const provider = new ResponsesProvider({
      credentials,
      transport: mock([
        ...calls.map((x) => ({
          type: "response.output_item.done",
          item: { type: "function_call", call_id: "same", ...x },
        })),
        done(),
      ]),
    });
    const result = await provider.send({
      model: "model",
      input: "x",
      tools: [
        { type: "function", name: "read_file", parameters: { type: "object" } },
      ],
    });
    assert.equal(result.status, "error");
    assert.deepEqual(result.functionCalls, []);
  }
});
test("partial termination remains error and raw provider errors never leak", async () => {
  for (const events of [
    [delta("partial")],
    [{ type: "error", message: "SECRET CONTENT" }],
  ]) {
    const result = await new ResponsesProvider({
      credentials,
      transport: mock(events),
    }).send({ model: "model", input: "x" });
    assert.equal(result.status, "error");
    assert.equal(JSON.stringify(result).includes("SECRET CONTENT"), false);
  }
});
test("authorization failure is sanitized with no automatic retry", async () => {
  let calls = 0;
  const provider = new ResponsesProvider({
    credentials,
    transport: async () => {
      calls++;
      return { status: 401, headers: {}, body: null };
    },
  });
  const result = await provider.send({ model: "model", input: "x" });
  assert.match(result.error, /authorization/);
  assert.equal(calls, 1);
});
test("abort and timeouts settle stuck transport without retries", async () => {
  const controller = new AbortController();
  const provider = new ResponsesProvider({
    credentials,
    transport: () => new Promise(() => {}),
    timeoutMs: 20,
  });
  const promise = provider.send({
    model: "model",
    input: "x",
    signal: controller.signal,
  });
  controller.abort();
  assert.equal((await promise).status, "cancelled");
  assert.equal(
    (await provider.send({ model: "model", input: "x" })).status,
    "cancelled",
  );
});
test("unknown usage is null and incomplete output is not completed", async () => {
  const provider = new ResponsesProvider({
    credentials,
    transport: mock([
      delta("partial"),
      {
        type: "response.incomplete",
        response: { id: "resp_test", usage: null },
      },
    ]),
  });
  const result = await provider.send({ model: "model", input: "x" });
  assert.equal(result.status, "incomplete");
  assert.equal(result.usage, null);
});
test("encrypted reasoning is preserved in order for main-process replay, never emitted to UI", async () => {
  const reasoning = {
    type: "reasoning",
    id: "rs_test",
    summary: [],
    encrypted_content: "OPAQUE_ENCRYPTED_TEST_STATE",
  };
  const call = {
    type: "function_call",
    call_id: "call_reason",
    id: "fc_test",
    name: "read_file",
    arguments: "{}",
  };
  const events = [];
  let secondBody;
  const provider = new ResponsesProvider({
    credentials,
    transport: mock([
      { type: "response.output_item.done", output_index: 0, item: reasoning },
      { type: "response.output_item.done", output_index: 1, item: call },
      done(),
    ]),
  });
  const result = await provider.send({
    model: "model",
    input: "x",
    tools: [
      { type: "function", name: "read_file", parameters: { type: "object" } },
    ],
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(
    result.outputItems.map((x) => x.type),
    ["reasoning", "function_call"],
  );
  assert.equal(
    JSON.stringify(events).includes(reasoning.encrypted_content),
    false,
  );
  const next = new ResponsesProvider({
    credentials,
    transport: async (req) => {
      secondBody = JSON.parse(req.body);
      return mock([done()])(req);
    },
  });
  await next.send({
    model: "model",
    input: [
      { role: "user", content: "x" },
      ...result.outputItems,
      {
        type: "function_call_output",
        call_id: "call_reason",
        output: "read result",
      },
    ],
  });
  assert.equal(
    secondBody.input[1].encrypted_content,
    reasoning.encrypted_content,
  );
  assert.deepEqual(secondBody.include, ["reasoning.encrypted_content"]);
});
test("reasoning without encrypted state and oversized encrypted state fail closed", async () => {
  for (const encrypted_content of [undefined, "x".repeat(65537)]) {
    const provider = new ResponsesProvider({
      credentials,
      transport: mock([
        {
          type: "response.output_item.done",
          item: {
            type: "reasoning",
            id: "rs_test",
            summary: [],
            encrypted_content,
          },
        },
        done(),
      ]),
    });
    const result = await provider.send({ model: "model", input: "x" });
    assert.equal(result.status, "error");
    assert.deepEqual(result.outputItems, []);
  }
});
test("refusal messages produce visible refusal text without exposing hidden reasoning", async () => {
  const item = {
    type: "message",
    id: "msg_refusal",
    role: "assistant",
    status: "completed",
    content: [{ type: "refusal", refusal: "I cannot help with that request." }],
  };
  const provider = new ResponsesProvider({
    credentials,
    transport: mock([
      { type: "response.output_item.done", output_index: 0, item },
      done({ output: [item] }),
    ]),
  });
  const result = await provider.send({ model: "model", input: "x" });
  assert.equal(result.status, "completed");
  assert.equal(result.text, "I cannot help with that request.");
});
test("conflicting response IDs and terminal inventory mismatch fail closed", async () => {
  for (const events of [
    [{ type: "response.created", response: { id: "resp_first" } }, done()],
    [
      done({
        output: [
          {
            type: "reasoning",
            id: "rs_lost",
            summary: [],
            encrypted_content: "opaque",
          },
        ],
      }),
    ],
  ]) {
    const provider = new ResponsesProvider({
      credentials,
      transport: mock(events),
    });
    assert.equal(
      (await provider.send({ model: "model", input: "x" })).status,
      "error",
    );
  }
});
test("completed message inventory determines final visible text and preserves phase", async () => {
  const first = {
    type: "message",
    id: "msg_first",
    role: "assistant",
    phase: "commentary",
    status: "completed",
    content: [{ type: "output_text", text: "Checking. ", annotations: [] }],
  };
  const last = {
    type: "message",
    id: "msg_last",
    role: "assistant",
    phase: "final_answer",
    status: "completed",
    content: [{ type: "refusal", refusal: "Cannot perform this action." }],
  };
  const provider = new ResponsesProvider({
    credentials,
    transport: mock([
      delta("provisional different text"),
      { type: "response.output_item.done", output_index: 0, item: first },
      { type: "response.output_item.done", output_index: 1, item: last },
      done({ output: [first, last] }),
    ]),
  });
  const result = await provider.send({ model: "model", input: "x" });
  assert.equal(result.text, "Checking. Cannot perform this action.");
  assert.deepEqual(
    result.outputItems.map((x) => x.phase),
    ["commentary", "final_answer"],
  );
});
