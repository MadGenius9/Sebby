import https from "node:https";
import { ResponsesProvider } from "./provider.mjs";
export const XAI_CAPABILITIES = Object.freeze({
  chat: true,
  tools: true,
  reasoningReplay: true,
  voice: false,
  modelDiscovery: false,
});
/** xAI's documented Responses-compatible subset; endpoint is never caller configurable. */
export function directXaiTransport({
  body,
  key,
  signal,
  onDispatched = () => {},
}) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      "https://api.x.ai/v1/responses",
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
export class XaiProvider extends ResponsesProvider {
  constructor({ credentials, transport = directXaiTransport, timeoutMs } = {}) {
    super({ credentials, transport, timeoutMs });
  }
  async status() {
    const credential = await this.credentials.status();
    return {
      configured: credential.configured,
      source: credential.source,
      provider: "xai",
      connection: "not-verified",
      capabilities: XAI_CAPABILITIES,
    };
  }
  async send(options = {}) {
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
      return {
        status: "error",
        text: "",
        responseId: null,
        usage: null,
        functionCalls: [],
        outputItems: [],
        error:
          "Unsupported xAI option; this adapter supports text and declared function tools only.",
      };
    const result = await super.send(options);
    if (result.error) result.error = result.error.replaceAll("OpenAI", "xAI");
    return result;
  }
}
