import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const source = await fs.readFile(
  new URL("../scripts/start-sebby-secure.ps1", import.meta.url),
  "utf8",
);
test("secure launcher prompts locally hidden, keeps key off command line, and cleans memory/env", () => {
  assert.match(source, /Read-Host 'Existing API key' -AsSecureString/);
  assert.match(source, /ZeroFreeBSTR/);
  assert.match(source, /finally/);
  assert.match(source, /& \$electron \$root/);
  assert.doesNotMatch(
    source,
    /(?:Write-Host|Write-Output|echo).*\$(?:env:OPENAI_API_KEY|previousKey|secret|pointer)/i,
  );
  assert.doesNotMatch(
    source,
    /(?:Set-Content|Add-Content|Out-File|Set-Clipboard|setx|WriteAllText)/i,
  );
  assert.ok(
    source.indexOf("Remove-Item Env:OPENAI_API_KEY") <
      source.indexOf("& npm.cmd run build"),
  );
  assert.ok(
    source.indexOf("& npm.cmd run build") <
      source.indexOf("Read-Host 'Existing API key'"),
  );
});

test("all supported provider environment keys are stripped before build and restored for runtime and finally", () => {
  const build = source.indexOf("& npm.cmd run build"),
    launch = source.indexOf("& $electron $root"),
    cleanup = source.indexOf("} finally {");
  for (const [env, previous, had] of [
    ["OPENAI_API_KEY", "previousKey", "hadKey"],
    ["ANTHROPIC_API_KEY", "previousAnthropicKey", "hadAnthropicKey"],
    ["XAI_API_KEY", "previousXaiKey", "hadXaiKey"],
  ]) {
    assert.ok(source.indexOf(`$${had} = Test-Path Env:${env}`) < build);
    const strip = source.indexOf(`Remove-Item Env:${env}`);
    assert.ok(strip >= 0 && strip < build);
    const restore = source.indexOf(`$env:${env} = $${previous}`, build);
    assert.ok(restore > build && restore < launch);
    const final = source.slice(cleanup);
    assert.ok(final.includes(`$env:${env} = $${previous}`));
    assert.ok(final.includes(`Remove-Item Env:${env}`));
    assert.ok(final.includes(`$${previous} = $null`));
  }
  assert.doesNotMatch(
    source,
    /(?:Write-Host|Write-Output|echo).*\$(?:env:(?:OPENAI|ANTHROPIC|XAI)_API_KEY|previous(?:Anthropic|Xai)?Key)/i,
  );
});
