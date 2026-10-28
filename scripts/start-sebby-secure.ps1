# Explicit, user-run Windows launcher. Never writes or prints a credential.
[CmdletBinding()]
param([switch]$SkipBuild)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
if (-not [System.IO.File]::Exists($electron)) { throw 'Install the reviewed project dependencies with npm ci first. Electron is not installed.' }
$hadKey = Test-Path Env:OPENAI_API_KEY
$previousKey = if ($hadKey) { $env:OPENAI_API_KEY } else { $null }
$hadAnthropicKey = Test-Path Env:ANTHROPIC_API_KEY
$previousAnthropicKey = if ($hadAnthropicKey) { $env:ANTHROPIC_API_KEY } else { $null }
$hadXaiKey = Test-Path Env:XAI_API_KEY
$previousXaiKey = if ($hadXaiKey) { $env:XAI_API_KEY } else { $null }
$secret = $null
$pointer = [IntPtr]::Zero
Push-Location $root
try {
    # Do not expose any supported provider key to build tooling. Only the desktop process needs them.
    Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:XAI_API_KEY -ErrorAction SilentlyContinue
    if (-not $SkipBuild) {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Build failed. No credential prompt or application launch occurred.' }
    }
    if (-not [System.IO.File]::Exists((Join-Path $root 'dist\index.html'))) { throw 'No production build exists. Run without -SkipBuild.' }
    # Restore only pre-existing non-OpenAI keys for the explicitly configured desktop profiles.
    if ($hadAnthropicKey) { $env:ANTHROPIC_API_KEY = $previousAnthropicKey }
    if ($hadXaiKey) { $env:XAI_API_KEY = $previousXaiKey }
    if (-not [string]::IsNullOrWhiteSpace($previousKey)) {
        $env:OPENAI_API_KEY = $previousKey
    } else {
        Write-Host 'Enter your existing OpenAI API key in this local hidden prompt. It is used for this app session only; no key is saved.'
        $secret = Read-Host 'Existing API key' -AsSecureString
        if ($secret.Length -eq 0) { throw 'No key entered. Application not launched.' }
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
        $env:OPENAI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    # No command-line argument, renderer field, file, clipboard operation, or printed output contains the key.
    & $electron $root
    $appExitCode = $LASTEXITCODE
    if ($appExitCode -ne 0) { throw ('Sebby exited with code ' + $appExitCode + '. No credential value is included here.') }
} finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($null -ne $secret) { $secret.Dispose() }
    if ($hadKey) { $env:OPENAI_API_KEY = $previousKey } else { Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue }
    if ($hadAnthropicKey) { $env:ANTHROPIC_API_KEY = $previousAnthropicKey } else { Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue }
    if ($hadXaiKey) { $env:XAI_API_KEY = $previousXaiKey } else { Remove-Item Env:XAI_API_KEY -ErrorAction SilentlyContinue }
    $previousKey = $null
    $previousAnthropicKey = $null
    $previousXaiKey = $null
    Pop-Location
}
