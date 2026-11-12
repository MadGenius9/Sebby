import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { OllamaProvider } from "../electron/ollama-provider.mjs";
import {
  validateProfile,
  RuntimeProfileCredentials,
} from "../electron/provider-profiles.mjs";
const stream = (items) =>
  Readable.from(
    items.map((x) =>
      Buffer.from(typeof x === "string" ? x : JSON.stringify(x) + "\n"),
    ),
  );
function setup(
  events,
  models = [{ name: "local-model:latest", size: 1000 }],
  inspect = () => {},
) {
  const calls = [];
  const provider = new OllamaProvider({
    transport: async (route, body, signal) => {
      signal?.throwIfAborted();
      calls.push({ route, body });
      inspect(route, body);
      return route === "/api/tags" ? stream([{ models }]) : stream(events);
    },
  });
  return { provider, calls };
}
const complete = {
  done: true,
  done_reason: "stop",
  prompt_eval_count: 10,
  eval_count: 2,
  message: { content: "" },
};
test("local model streams actual text and returns measured usage without credentials", async () => {
  const f = setup([
      { message: { content: "Hello " }, done: false },
      { message: { content: "Chuck" }, done: false },
      complete,
    ]),
    events = [];
  const result = await f.provider.send({
    model: "local-model",
    input: "Hello",
    onEvent: (e) => events.push(e),
  });
  assert.equal(result.status, "completed");
  assert.equal(result.text, "Hello Chuck");
  assert.deepEqual(result.usage, {
    inputTokens: 10,
    outputTokens: 2,
    totalTokens: 12,
  });
  assert.equal(events[0].type, "request-dispatched");
  assert.deepEqual(
    f.calls.map((c) => c.route),
    ["/api/tags", "/api/chat"],
  );
  assert.equal(JSON.stringify(f.calls).includes("Authorization"), false);
});
test("rejects remote aliases and uninstalled models without inference or fallback", async () => {
  for (const models of [
    [],
    [
      {
        name: "local-model:latest",
        size: 1000,
        remote_host: "https://remote.example",
      },
    ],
    [{ name: "local-model:latest", size: 1000, remote_model: "remote" }],
  ]) {
    const f = setup([complete], models);
    assert.equal(
      (await f.provider.send({ model: "local-model", input: "secret" })).status,
      "error",
    );
    assert.equal(f.calls.length, 1);
  }
  const f = setup([complete]);
  await f.provider.send({ model: "model-cloud", input: "secret" });
  assert.equal(f.calls.length, 0);
});
test("incomplete streams, invalid frames and token exhaustion never execute tools", async () => {
  for (const events of [
    [{ message: { content: "partial" } }],
    ["{broken\n"],
    [{ ...complete, done_reason: "length", message: { content: "cut off" } }],
  ]) {
    const f = setup(events);
    const result = await f.provider.send({
      model: "local-model",
      input: "Hello",
    });
    assert.notEqual(result.status, "completed");
    assert.deepEqual(result.functionCalls, []);
  }
});
test("tool results round trip with names and arguments, unknown calls rejected", async () => {
  const tools = [
    {
      type: "function",
      name: "read_file",
      description: "Read",
      parameters: { type: "object" },
    },
  ];
  const f = setup([
    {
      message: {
        tool_calls: [
          { function: { name: "read_file", arguments: { path: "note.md" } } },
        ],
      },
      done: false,
    },
    complete,
  ]);
  const result = await f.provider.send({
    model: "local-model",
    input: "read note",
    tools,
  });
  assert.equal(result.functionCalls[0].name, "read_file");
  const call = result.functionCalls[0];
  const follow = setup([complete], undefined, (route, body) => {
    if (route === "/api/chat")
      assert.equal(body.messages.at(-1).tool_name, "read_file");
  });
  const next = await follow.provider.send({
    model: "local-model",
    tools,
    input: [
      { role: "user", content: "read note" },
      {
        type: "function_call",
        call_id: call.callId,
        name: call.name,
        arguments: call.arguments,
      },
      {
        type: "function_call_output",
        call_id: call.callId,
        output: "Actual file",
      },
    ],
  });
  assert.equal(next.status, "completed");
  const bad = setup([
    {
      done: false,
      message: { tool_calls: [{ function: { name: "shell", arguments: {} } }] },
    },
    complete,
  ]);
  assert.equal(
    (await bad.provider.send({ model: "local-model", input: "hello", tools }))
      .status,
    "error",
  );
});
test("cancelled request makes no calls", async () => {
  const f = setup([complete]),
    c = new AbortController();
  c.abort();
  assert.equal(
    (
      await f.provider.send({
        model: "local-model",
        input: "hi",
        signal: c.signal,
      })
    ).status,
    "cancelled",
  );
  assert.equal(f.calls.length, 0);
});
test("local profile persists without environment key or vault reads", async () => {
  const p = validateProfile({
    id: "11111111-1111-1111-1111-111111111111",
    name: "Local",
    provider: "ollama",
    model: "team/local:8b",
    useEnvironment: true,
    options: { maxOutputTokens: 2048 },
  });
  assert.equal(p.useEnvironment, false);
  const c = new RuntimeProfileCredentials(p.id, {
    profiles: { get: () => p },
    vault: {
      status: () => {
        throw Error("must not read vault");
      },
    },
  });
  assert.equal((await c.status()).source, "local-runtime");
});
test("local profile rejects cloud identifiers and secret-like model strings", () => {
  for (const model of ["model-cloud", "sk-abcdefghijklmnopqrst"])
    assert.throws(() =>
      validateProfile({
        id: "11111111-1111-1111-1111-111111111111",
        name: "Local",
        provider: "ollama",
        model,
        useEnvironment: false,
        options: { maxOutputTokens: 2048 },
      }),
    );
});
