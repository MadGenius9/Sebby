import test from "node:test";
import assert from "node:assert/strict";
import { mediaPermissionPolicy } from "../electron/media-permissions.mjs";
const url = "file:///fixture/dist/index.html";
function fixture() {
  let consumed = 0,
    closing = false;
  const contents = { id: 7, getURL: () => url };
  const window = { isDestroyed: () => false, webContents: contents };
  const policy = mediaPermissionPolicy({
    getWindow: () => window,
    getVoice: () => ({
      consumePermission: (request) => {
        assert.deepEqual(request, { windowId: 7, audioOnly: true });
        return ++consumed === 1;
      },
    }),
    appURL: url,
    isClosing: () => closing,
  });
  return {
    policy,
    contents,
    close: () => (closing = true),
    count: () => consumed,
  };
}
const details = {
  isMainFrame: true,
  requestingUrl: url,
  mediaTypes: ["audio"],
};
test("microphone gate requires one approved trusted main-frame audio-only request", () => {
  const { policy, contents } = fixture();
  assert.equal(policy.check(), false);
  let result;
  policy.request(contents, "media", (x) => (result = x), details);
  assert.equal(result, true);
  policy.request(contents, "media", (x) => (result = x), details);
  assert.equal(result, false);
});
test("all other permissions, frames, content, missing metadata and closing state deny without consuming grant", () => {
  const f = fixture();
  const cases = [
    ["media", { ...details, mediaTypes: ["audio", "video"] }],
    ["media", { ...details, mediaTypes: [] }],
    ["media", { ...details, isMainFrame: false }],
    ["media", { ...details, requestingUrl: "https://other.test" }],
    ["media", {}],
    ["display-capture", details],
    ["notifications", details],
    ["clipboard-read", details],
  ];
  for (const [permission, value] of cases) {
    let result;
    f.policy.request(f.contents, permission, (x) => (result = x), value);
    assert.equal(result, false);
  }
  f.policy.request(
    { ...f.contents },
    "media",
    (x) => assert.equal(x, false),
    details,
  );
  f.close();
  f.policy.request(f.contents, "media", (x) => assert.equal(x, false), details);
  assert.equal(f.count(), 0);
});
