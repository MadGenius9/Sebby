import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import fs from "node:fs/promises";
import {
  ResponsesProvider,
  directResponsesTransport,
} from "../electron/provider.mjs";
import { RuntimeCredentials } from "../electron/credentials.mjs";
const fake = "TEST_ONLY_SYNTHETIC_CREDENTIAL_123456";
const credentials = new RuntimeCredentials({
  env: {
    OPENAI_API_KEY: fake,
    OPENAI_BASE_URL: "https://attacker.invalid",
    HTTPS_PROXY: "https://attacker.invalid",
  },
});
function replaceRequest(t, callback) {
  const original = https.request;
  https.request = callback;
  t.after(() => {
    https.request = original;
  });
}
test("direct provider transport uses only fixed official HTTPS endpoint and direct verified TLS", async (t) => {
  let observed,
    body,
    dispatches = 0,
    requests = 0;
  replaceRequest(t, (url, options, callback) => {
    requests++;
    observed = { url, options };
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = (value) => {
      body = value;
      request.emit("finish");
      const response = Readable.from([]);
      response.statusCode = 302;
      response.headers = { location: "https://attacker.invalid" };
      callback(response);
    };
    return request;
  });
  const signal = new AbortController().signal;
  const response = await directResponsesTransport({
    body: '{"input":"approved"}',
    key: fake,
    signal,
    onDispatched: () => dispatches++,
    url: "https://attacker.invalid",
    headers: { Authorization: "attacker" },
  });
  assert.equal(observed.url, "https://api.openai.com/v1/responses");
  assert.equal(observed.options.agent, false);
  assert.equal(observed.options.rejectUnauthorized, true);
  assert.equal(observed.options.signal, signal);
  assert.equal(observed.options.headers.Authorization, `Bearer ${fake}`);
  assert.equal(observed.options.method, "POST");
  assert.equal(body, '{"input":"approved"}');
  assert.equal(dispatches, 1);
  assert.equal(response.status, 302);
  assert.equal(requests, 1);
  response.body.destroy();
});
test("redirect response never follows location or repeats authorized request", async (t) => {
  let requests = 0;
  replaceRequest(t, (_url, _options, callback) => {
    requests++;
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = () => {
      request.emit("finish");
      const response = Readable.from(["remote error must not leak"]);
      response.statusCode = 307;
      response.headers = { location: "https://attacker.invalid" };
      callback(response);
    };
    return request;
  });
  const result = await new ResponsesProvider({ credentials }).send({
    model: "explicit-model",
    input: "approved",
  });
  assert.equal(result.status, "error");
  assert.equal(requests, 1);
  assert.doesNotMatch(
    JSON.stringify(result),
    /attacker|remote error|SYNTHETIC/,
  );
});
test("transport exceptions and malformed SSE are sanitized and clear pending function outputs", async () => {
  const errors = [
    new Error(`Authorization: Bearer ${fake}`),
    Object.assign(new Error("request failed"), {
      headers: { Authorization: fake },
    }),
  ];
  for (const error of errors) {
    let calls = 0;
    const events = [];
    const provider = new ResponsesProvider({
      credentials,
      transport: async () => {
        calls++;
        throw error;
      },
    });
    const result = await provider.send({
      model: "explicit-model",
      input: "approved",
      onEvent: (e) => events.push(e),
    });
    assert.equal(calls, 1);
    assert.equal(result.status, "error");
    assert.doesNotMatch(
      JSON.stringify({ events, result }),
      /SYNTHETIC|Authorization/,
    );
    assert.deepEqual(result.functionCalls, []);
  }
  const provider = new ResponsesProvider({
    credentials,
    transport: async () => ({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: Readable.from([
        `data: {"type":"response.failed","error":{"message":"${fake}"}}\n\n`,
      ]),
    }),
  });
  const result = await provider.send({
    model: "explicit-model",
    input: "approved",
  });
  assert.equal(result.status, "error");
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC/);
});
test("runtime credential rejects header injection and status never exposes value", async () => {
  for (const value of [
    fake + "\nInjected: bad",
    fake + "\r",
    fake + "\0",
    "short",
  ]) {
    let transports = 0;
    const bad = new RuntimeCredentials({ env: { OPENAI_API_KEY: value } });
    const result = await new ResponsesProvider({
      credentials: bad,
      transport: async () => {
        transports++;
      },
    }).send({ model: "explicit-model", input: "approved" });
    assert.equal(transports, 0);
    assert.equal(result.status, "error");
    assert.equal(bad.status().configured, false);
  }
  assert.deepEqual(await new ResponsesProvider({ credentials }).status(), {
    configured: true,
    source: "environment",
    provider: "openai",
    connection: "not-verified",
  });
});
test("renderer bridge exposes no credential readback and project child environment is allowlisted", async () => {
  const preload = await fs.readFile(
    new URL("../electron/preload.cjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    preload,
    /getKey|saveCredential|encryptString|OPENAI_API_KEY|Authorization/,
  );
  const development = await fs.readFile(
    new URL("../electron/development.mjs", import.meta.url),
    "utf8",
  );
  assert.match(development, /const env = \{\}/);
  assert.doesNotMatch(development, /env\s*:\s*process\.env|\.\.\.process\.env/);
  assert.doesNotMatch(development, /\[.*['"]OPENAI_API_KEY['"]/);
});

test("additional provider transports use isolated official endpoints and provider-specific auth headers", async (t) => {
  const { directAnthropicTransport } =
    await import("../electron/anthropic-provider.mjs");
  const { directXaiTransport } = await import("../electron/xai-provider.mjs");
  const observed = [];
  replaceRequest(t, (url, options, callback) => {
    observed.push({ url, options });
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = () => {
      request.emit("finish");
      const response = Readable.from([]);
      response.statusCode = 302;
      response.headers = { location: "https://attacker.invalid" };
      callback(response);
    };
    return request;
  });
  const anthropic = await directAnthropicTransport({
    body: "{}",
    key: "SYNTHETIC_ANTHROPIC_ONLY",
    signal: new AbortController().signal,
  });
  const xai = await directXaiTransport({
    body: "{}",
    key: "SYNTHETIC_XAI_ONLY",
    signal: new AbortController().signal,
  });
  assert.equal(observed[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(
    observed[0].options.headers["x-api-key"],
    "SYNTHETIC_ANTHROPIC_ONLY",
  );
  assert.equal(observed[0].options.headers.Authorization, undefined);
  assert.equal(observed[1].url, "https://api.x.ai/v1/responses");
  assert.equal(
    observed[1].options.headers.Authorization,
    "Bearer SYNTHETIC_XAI_ONLY",
  );
  assert.equal(observed[1].options.headers["x-api-key"], undefined);
  for (const { options } of observed) {
    assert.equal(options.agent, false);
    assert.equal(options.rejectUnauthorized, true);
  }
  assert.equal(observed.length, 2);
  anthropic.body.destroy();
  xai.body.destroy();
});
