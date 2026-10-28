import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const source = await fs.readFile(
  new URL("../scripts/test-job-runner-windows.ps1", import.meta.url),
  "utf8",
);
const fixture = await fs.readFile(
  new URL(
    "../native/windows-job-runner/fixtures/Program.cs.txt",
    import.meta.url,
  ),
  "utf8",
);
const helper = await fs.readFile(
  new URL("../native/windows-job-runner/Program.cs", import.meta.url),
  "utf8",
);
test("native harness is explicit manual Windows opt-in with installed SDK only", () => {
  assert.match(source, /param\(\[switch\]\$RunNativeFixtures\)/);
  assert.ok(
    source.indexOf("if (-not $RunNativeFixtures)") <
      source.indexOf("function New-OwnedProcess"),
  );
  assert.match(
    source,
    /PSVersionTable.PSVersion.Major -lt 7 -or -not \$IsWindows/,
  );
  assert.match(source, /Get-Command dotnet.exe -CommandType Application/);
  assert.doesNotMatch(
    source,
    /Invoke-WebRequest|Invoke-RestMethod|winget|choco|Start-BitsTransfer|https?:\/\//i,
  );
  assert.match(source, /rollForward='disable';allowPrerelease=\$false/);
});
test("build uses copied fixed sources, empty offline feed and no restore fallback", () => {
  assert.match(
    source,
    /'Program.cs','Native.cs','Contract.cs','Sebby.JobRunner.csproj'/,
  );
  assert.match(source, /<packageSources><clear \/><\/packageSources>/);
  assert.match(source, /'--source',\$emptyFeed/);
  assert.match(source, /'--no-restore','--disable-build-servers'/);
  assert.match(source, /NuGetAudit=false/);
  assert.match(source, /MSBuildEnableWorkloadResolver/);
  assert.match(source, /MSBUILDDISABLENODEREUSE/);
  assert.match(source, /DOTNET_CLI_USE_MSBUILD_SERVER/);
  assert.match(source, /UseSharedCompilation=false/);
  assert.match(
    source,
    /New-OwnedProcess \$dotnet \$Arguments \$root -MinimalEnvironment/,
  );
  assert.match(source, /NUGET_PACKAGES.*Join-Path \$root 'package-cache'/);
  assert.match(source, /ImportDirectoryBuildProps=false/);
  assert.match(source, /ImportDirectoryBuildTargets=false/);
  assert.match(source, /ImportDirectoryPackagesProps=false/);
  assert.match(
    source,
    /Directory.Build.props','Directory.Build.targets','Directory.Packages.props/,
  );
  assert.match(source, /fixtures\/Program.cs.txt/);
});
test("bounded waits and precise owned cleanup never use process-name kills", () => {
  assert.match(source, /Elapsed.TotalSeconds -ge 300/);
  assert.match(source, /Wait-Bounded \$process 10000/);
  assert.match(source, /Redirected pipes remained open/);
  assert.match(
    source,
    /StartTime.ToUniversalTime\(\).Ticks.ToString\(\) -cne \$Record.startUtcTicks/,
  );
  assert.match(source, /MainModule.FileName -cne \$fixtureExe/);
  assert.match(source, /Remove-Item -LiteralPath \$root -Recurse -Force/);
  assert.doesNotMatch(source, /Stop-Process|taskkill|Get-Process\s+-Name/i);
  assert.match(source, /'kill' \{ \$process.Kill\(\) \}/);
  assert.match(source, /\$info.Environment.Clear\(\)/);
});
test("all requested benign acceptance cases and actual helper event field match", () => {
  for (const name of [
    "success",
    "nonzero",
    "timeout",
    "cancel-tree",
    "eof-tree",
    "output-overflow",
    "supervisor-killed",
  ])
    assert.ok(source.includes(`Invoke-Case '${name}'`));
  assert.match(source, /verifiedJobMembership/);
  assert.match(helper, /verifiedJobMembership = true/);
  assert.match(source, /Assert-FixturesExited \$evidence \$minimum/);
  assert.match(source, /if \(\$Mode -eq 'tree'\) \{ 3 \}/);
  assert.match(source, /SEBBY_FIXTURE_STDERR/);
});
test("fixture is fixed, finite, self-spawning only and not compiled by helper glob", async () => {
  assert.match(
    fixture,
    /Task.Delay\(TimeSpan.FromSeconds\(60\)\); Environment.Exit\(92\)/,
  );
  assert.match(fixture, /new ProcessStartInfo\(Environment.ProcessPath!\)/);
  assert.doesNotMatch(
    fixture,
    /HttpClient|WebClient|cmd.exe|powershell|ProcessStartInfo\(args/,
  );
  const files = await fs.readdir(
    new URL("../native/windows-job-runner/fixtures/", import.meta.url),
  );
  assert.ok(files.includes("Program.cs.txt"));
  assert.ok(!files.some((x) => x.endsWith(".cs")));
});
