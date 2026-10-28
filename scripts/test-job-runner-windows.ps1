# Source-only acceptance harness. NEVER called by npm, CI, app startup or renderer.
# Requires manual review, Windows x64, PowerShell 7+, an existing .NET 10 SDK.
[CmdletBinding()]
param([switch]$RunNativeFixtures)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $RunNativeFixtures) { throw 'Native execution is opt-in. Review this script, then explicitly pass -RunNativeFixtures on a Windows test host.' }
if ($PSVersionTable.PSVersion.Major -lt 7 -or -not $IsWindows -or -not [Environment]::Is64BitProcess) { throw 'Requires PowerShell 7+ on 64-bit Windows. Nothing is installed automatically.' }
$dotnetCommand = Get-Command dotnet.exe -CommandType Application -ErrorAction Stop
$dotnet = $dotnetCommand.Source
if (-not [IO.Path]::IsPathFullyQualified($dotnet) -or -not $dotnet.EndsWith('.exe', [StringComparison]::OrdinalIgnoreCase)) { throw 'A preinstalled native dotnet.exe is required.' }
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$root = Join-Path ([IO.Path]::GetTempPath()) ('sebby-native-validation-' + [Guid]::NewGuid().ToString('N'))
$watch = [Diagnostics.Stopwatch]::StartNew()
$ownedProcesses = [Collections.Generic.List[Diagnostics.Process]]::new()
$cases = [Collections.Generic.List[object]]::new()
$fixtureExe = $null
$helperExe = $null
$failure = $null

function Assert-Deadline {
    if ($watch.Elapsed.TotalSeconds -ge 300) { throw 'Global native fixture deadline exceeded (300 seconds).' }
}
function New-OwnedProcess([string]$Executable, [string[]]$Arguments, [string]$WorkingDirectory, [switch]$MinimalEnvironment) {
    Assert-Deadline
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Executable; $info.WorkingDirectory = $WorkingDirectory
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
    if ($MinimalEnvironment) {
        $info.Environment.Clear()
        $info.Environment['SystemRoot'] = [Environment]::GetFolderPath('Windows')
        $info.Environment['WINDIR'] = [Environment]::GetFolderPath('Windows')
        $info.Environment['TEMP'] = $root; $info.Environment['TMP'] = $root
    }
    $info.Environment['DOTNET_CLI_TELEMETRY_OPTOUT'] = '1'
    $info.Environment['DOTNET_SKIP_FIRST_TIME_EXPERIENCE'] = '1'
    $info.Environment['DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE'] = 'true'
    $info.Environment['MSBuildEnableWorkloadResolver'] = 'false'
    $info.Environment['MSBUILDDISABLENODEREUSE'] = '1'
    $info.Environment['DOTNET_CLI_USE_MSBUILD_SERVER'] = '0'
    $info.Environment['DOTNET_CLI_HOME'] = $root
    $info.Environment['NUGET_PACKAGES'] = Join-Path $root 'package-cache'
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $info
    if (-not $process.Start()) { $process.Dispose(); throw 'Owned process could not start.' }
    $ownedProcesses.Add($process)
    return $process
}
function Wait-Bounded([Diagnostics.Process]$Process, [int]$MaximumMs) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while (-not $Process.WaitForExit(50)) {
        Assert-Deadline
        if ($timer.ElapsedMilliseconds -ge $MaximumMs) { throw 'Owned process exceeded its bounded wait.' }
    }
}
function Complete-Capture($StdoutTask, $StderrTask) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while (-not $StdoutTask.IsCompleted -or -not $StderrTask.IsCompleted) {
        Assert-Deadline
        if ($timer.ElapsedMilliseconds -ge 5000) { throw 'Redirected pipes remained open after owned supervisor exited.' }
        Start-Sleep -Milliseconds 25
    }
    return @{stdout=$StdoutTask.GetAwaiter().GetResult();stderr=$StderrTask.GetAwaiter().GetResult()}
}
function Invoke-OfflineBuildCommand([string[]]$Arguments) {
    $process = New-OwnedProcess $dotnet $Arguments $root -MinimalEnvironment
    # Drain concurrently to prevent stdout/stderr deadlocks. Output is trusted SDK
    # diagnostics for fixed owned source; do not print environment or user projects.
    $outTask = $process.StandardOutput.ReadToEndAsync(); $errTask = $process.StandardError.ReadToEndAsync()
    $process.StandardInput.Close(); Wait-Bounded $process 90000
    $capture = Complete-Capture $outTask $errTask; $stdout = $capture.stdout; $stderr = $capture.stderr
    if ($process.ExitCode -ne 0) { throw ('Offline SDK operation failed. Missing local packs/tools must be resolved separately; no fallback download. ' + ($stdout + $stderr).Substring(0, [Math]::Min(2000, ($stdout + $stderr).Length))) }
    return $stdout
}
function Get-FixtureRecords([string]$Directory) {
    $records = @()
    foreach ($file in @(Get-ChildItem -LiteralPath $Directory -File -Filter '*.json')) {
        if ($file.Length -gt 2048 -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid fixture identity evidence.' }
        $record = [IO.File]::ReadAllText($file.FullName) | ConvertFrom-Json
        if ($record.executable -cne $fixtureExe -or "$($record.pid)" -notmatch '^[1-9][0-9]*$' -or "$($record.startUtcTicks)" -notmatch '^[0-9]+$') { throw 'Fixture identity does not match the exact owned executable.' }
        $records += $record
    }
    return $records
}
function Get-MatchingFixtureProcess($Record) {
    try { $process = [Diagnostics.Process]::GetProcessById([int]$Record.pid) } catch [ArgumentException] { return $null }
    try {
        if ($process.HasExited) { $process.Dispose(); return $null }
        if ($process.StartTime.ToUniversalTime().Ticks.ToString() -cne $Record.startUtcTicks -or $process.MainModule.FileName -cne $fixtureExe) { $process.Dispose(); return $null }
        return $process
    } catch { $process.Dispose(); throw }
}
function Assert-FixturesExited([string]$Directory, [int]$MinimumCount) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
        Assert-Deadline
        $records = @(Get-FixtureRecords $Directory)
        if ($records.Count -lt $MinimumCount) { throw 'Not enough identified fixture processes ran; cannot claim tree cleanup.' }
        $alive = $false
        foreach ($record in $records) { $process = Get-MatchingFixtureProcess $record; if ($null -ne $process) { $alive = $true; $process.Dispose() } }
        if (-not $alive) { return }
        Start-Sleep -Milliseconds 50
    } while ($timer.ElapsedMilliseconds -lt 5000)
    throw 'A verified fixture process survived the supervisor operation.'
}
function Invoke-Case([string]$Name, [string]$Mode, [string]$Control, [string]$ExpectedOutcome, [int]$ExpectedExit = -1) {
    Assert-Deadline
    $evidence = Join-Path $root $Name; [void][IO.Directory]::CreateDirectory($evidence)
    $process = New-OwnedProcess $helperExe @('--enable-reviewed-native-run') $root -MinimalEnvironment
    $stdoutTask = $process.StandardOutput.ReadToEndAsync(); $stderrTask = $process.StandardError.ReadToEndAsync()
    $request = @{ version=1; executable=$fixtureExe; executableSha256=(Get-FileHash -LiteralPath $fixtureExe -Algorithm SHA256).Hash.ToLowerInvariant(); args=@($Mode,$evidence); workspaceRoot=$root; workingDirectory=$root; timeoutMs=5000; maxOutputBytes=1024 }
    if ($Control -eq 'timeout') { $request.timeoutMs = 1200 }
    $process.StandardInput.WriteLine(($request | ConvertTo-Json -Compress -Depth 5)); $process.StandardInput.Flush()
    $minimum = if ($Mode -eq 'tree') { 3 } else { 1 }
    if ($Control -in @('cancel','eof','kill')) {
        $timer = [Diagnostics.Stopwatch]::StartNew()
        while (@(Get-FixtureRecords $evidence).Count -lt $minimum) {
            Assert-Deadline
            if ($process.HasExited -or $timer.ElapsedMilliseconds -ge 3500) { throw 'Fixture readiness was not proven before cancellation.' }
            Start-Sleep -Milliseconds 25
        }
        switch ($Control) {
            'cancel' { $process.StandardInput.WriteLine('cancel'); $process.StandardInput.Flush() }
            'eof' { $process.StandardInput.Close() }
            'kill' { $process.Kill() } # Kill only owned supervisor, NOT its tree: test kill-on-job-close itself.
        }
    }
    Wait-Bounded $process 10000
    $capture = Complete-Capture $stdoutTask $stderrTask; $stdout = $capture.stdout; $stderr = $capture.stderr
    if ($stdout.Length -gt 2097152 -or $stderr.Length -gt 65536) { throw 'Supervisor diagnostics exceeded harness limits.' }
    $events = @($stdout -split "`n" | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json })
    $started = @($events | Where-Object { $_.type -eq 'started' })
    if ($started.Count -ne 1 -or -not $started[0].verifiedJobMembership) { throw 'Native verified-job start evidence is missing.' }
    if ($Control -ne 'kill') {
        $finished = @($events | Where-Object { $_.type -eq 'finished' })
        if ($process.ExitCode -ne 0 -or $finished.Count -ne 1 -or $finished[0].outcome -ne $ExpectedOutcome) { throw 'Unexpected helper terminal result.' }
        if ($ExpectedExit -ge 0 -and $finished[0].exitCode -ne $ExpectedExit) { throw 'Unexpected fixture exit code.' }
        if ($finished[0].capturedBytes -gt 1024) { throw 'Output byte bound exceeded.' }
        if ($Mode -eq 'success') {
            $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($finished[0].stdoutBase64))
            $errorText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($finished[0].stderrBase64))
            if (-not $text.Contains('SEBBY_FIXTURE_STDOUT') -or -not $errorText.Contains('SEBBY_FIXTURE_STDERR')) { throw 'Expected independent stdout/stderr evidence missing.' }
        }
        if ($Mode -eq 'overflow' -and -not $finished[0].outputTruncated) { throw 'Output overflow was not reported.' }
    }
    Assert-FixturesExited $evidence $minimum
    $cases.Add(@{name=$Name;status='passed';fixtureCount=@(Get-FixtureRecords $evidence).Count})
}
try {
    [void][IO.Directory]::CreateDirectory($root)
    $sdks = Invoke-OfflineBuildCommand @('--list-sdks')
    $versions = @([regex]::Matches($sdks, '(?m)^(10\.\d+\.\d+) \[') | ForEach-Object { [Version]$_.Groups[1].Value } | Sort-Object -Descending)
    if ($versions.Count -eq 0) { throw 'A stable .NET 10 SDK is not installed; nothing will be downloaded.' }
    [IO.File]::WriteAllText((Join-Path $root 'global.json'), (@{sdk=@{version=$versions[0].ToString();rollForward='disable';allowPrerelease=$false}} | ConvertTo-Json -Depth 3))
    foreach ($name in @('Directory.Build.props','Directory.Build.targets','Directory.Packages.props')) { [IO.File]::WriteAllText((Join-Path $root $name), '<Project />') }
    $helperSource = Join-Path $repo 'native/windows-job-runner'
    $helperDirectory = Join-Path $root 'helper'; $fixtureDirectory = Join-Path $root 'fixture'
    [void][IO.Directory]::CreateDirectory($helperDirectory); [void][IO.Directory]::CreateDirectory($fixtureDirectory)
    foreach ($name in @('Program.cs','Native.cs','Contract.cs','Sebby.JobRunner.csproj')) { Copy-Item -LiteralPath (Join-Path $helperSource $name) -Destination (Join-Path $helperDirectory $name) }
    Copy-Item -LiteralPath (Join-Path $helperSource 'fixtures/Program.cs.txt') -Destination (Join-Path $fixtureDirectory 'Program.cs')
    Copy-Item -LiteralPath (Join-Path $helperSource 'fixtures/Sebby.JobFixture.csproj') -Destination $fixtureDirectory
    # Explicit source clearing plus an empty local feed: no NuGet HTTP source/fallback.
    $emptyFeed = Join-Path $root 'empty-feed'; [void][IO.Directory]::CreateDirectory($emptyFeed)
    $nugetConfig = Join-Path $root 'NuGet.Config'
    [IO.File]::WriteAllText($nugetConfig, '<configuration><packageSources><clear /></packageSources><fallbackPackageFolders><clear /></fallbackPackageFolders></configuration>')
    foreach ($project in @((Join-Path $helperDirectory 'Sebby.JobRunner.csproj'),(Join-Path $fixtureDirectory 'Sebby.JobFixture.csproj'))) {
        [void](Invoke-OfflineBuildCommand @('restore',$project,'--configfile',$nugetConfig,'--source',$emptyFeed,'--disable-parallel','-p:NuGetAudit=false','-p:UseSharedCompilation=false','-p:RestoreIgnoreFailedSources=false','-p:ImportDirectoryBuildProps=false','-p:ImportDirectoryBuildTargets=false','-p:ImportDirectoryPackagesProps=false'))
        [void](Invoke-OfflineBuildCommand @('build',$project,'-c','Release','--no-restore','--disable-build-servers','-p:NuGetAudit=false','-p:UseSharedCompilation=false','-p:ImportDirectoryBuildProps=false','-p:ImportDirectoryBuildTargets=false','-p:ImportDirectoryPackagesProps=false'))
    }
    $helperExe = Join-Path $helperDirectory 'bin/Release/net10.0-windows/win-x64/Sebby.JobRunner.exe'
    $fixtureExe = Join-Path $fixtureDirectory 'bin/Release/net10.0-windows/win-x64/Sebby.JobFixture.exe'
    if (-not (Test-Path -LiteralPath $helperExe -PathType Leaf) -or -not (Test-Path -LiteralPath $fixtureExe -PathType Leaf)) { throw 'Expected offline build outputs are missing.' }
    Invoke-Case 'success' 'success' 'none' 'exited' 0
    Invoke-Case 'nonzero' 'nonzero' 'none' 'exited' 23
    Invoke-Case 'timeout' 'sleep' 'timeout' 'timed-out'
    Invoke-Case 'cancel-tree' 'tree' 'cancel' 'cancelled'
    Invoke-Case 'eof-tree' 'tree' 'eof' 'cancelled'
    Invoke-Case 'output-overflow' 'overflow' 'none' 'output-limit'
    Invoke-Case 'supervisor-killed' 'tree' 'kill' ''
} catch { $failure = $_.Exception.Message }
finally {
    # Cleanup is only for process handles created here and identity-checked fixture
    # records under this exact random root. Never process-name/system-wide killing.
    foreach ($process in $ownedProcesses) {
        try { if (-not $process.HasExited) { $process.Kill($true); [void]$process.WaitForExit(5000) } } catch { if (-not $failure) { $failure = 'Owned process cleanup failed.' } }
    }
    if ($fixtureExe -and (Test-Path -LiteralPath $root)) {
        foreach ($directory in @(Get-ChildItem -LiteralPath $root -Directory | Where-Object { $_.Name -notin @('helper','fixture','empty-feed') })) {
            try { foreach ($record in @(Get-FixtureRecords $directory.FullName)) { $process = Get-MatchingFixtureProcess $record; if ($process) { try { $process.Kill(); [void]$process.WaitForExit(5000) } finally { $process.Dispose() } } } } catch { if (-not $failure) { $failure = 'Fixture identity cleanup failed.' } }
        }
    }
    foreach ($process in $ownedProcesses) { $process.Dispose() }
    # Only the directory created above; no caller-controlled deletion target.
    if (Test-Path -LiteralPath $root) { try { Remove-Item -LiteralPath $root -Recurse -Force } catch { if (-not $failure) { $failure = 'Temporary validation directory cleanup failed.' } } }
}
@{status=$(if($failure){'failed'}else{'passed'});cases=$cases.ToArray();error=$failure;nativeExecution=$true;elapsedSeconds=[Math]::Round($watch.Elapsed.TotalSeconds,2);scope='benign fixtures only; not a security sandbox certification or enablement approval'} | ConvertTo-Json -Depth 5
if ($failure) { exit 1 }
