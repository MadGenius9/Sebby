import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const script = await fs.readFile(
  new URL("../scripts/verify-windows.ps1", import.meta.url),
  "utf8",
);
test("Windows verification recipe preserves ordered fail-fast checks and no publish", () => {
  const steps = [
    "@('ci','--no-fund','--no-audit')",
    "@('test')",
    "@('run','test:components')",
    "@('run','build')",
    "@('run','package:win','--','--publish','never')",
  ];
  let previous = -1;
  for (const step of steps) {
    const index = script.indexOf(step);
    assert.ok(index > previous, `Step out of order or missing: ${step}`);
    previous = index;
  }
  assert.match(script, /if \(\$code -ne 0\)/);
  assert.match(script, /throw "\$Label failed/);
  assert.match(script, /exit \$exitCode/);
});
test("Windows verification recipe exposes explicit skip switches and no implicit launch/sign", () => {
  assert.match(script, /\[switch\]\$SkipInstall/);
  assert.match(script, /\[switch\]\$SkipPackage/);
  assert.match(script, /CSC_IDENTITY_AUTO_DISCOVERY = 'false'/);
  assert.match(script, /Signing-related environment setting detected/);
  assert.doesNotMatch(
    script,
    /Start-Process|Set-ExecutionPolicy|Invoke-Expression|git push|npm start|signtool\.exe/i,
  );
});
