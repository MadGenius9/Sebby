param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA 'Sebby\local-voice')
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$pythonExe = Join-Path $RuntimeRoot 'venv\Scripts\python.exe'
$serverPath = Join-Path $repoRoot 'native\local-voice\server.py'
if (!(Test-Path -LiteralPath $pythonExe)) { throw 'Run scripts/setup-local-voice.ps1 first.' }
try {
  $existing = Invoke-RestMethod -Uri 'http://127.0.0.1:11435/health' -TimeoutSec 2
} catch { $existing = $null }
if ($existing) {
  if ($existing.ttsProvider -ne 'kokoro-onnx-cpu') { throw 'Port 11435 is occupied by an unknown service.' }
  $existing | ConvertTo-Json -Depth 5
  exit 0
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$arguments = @("`"$serverPath`"", '--assets', "`"$(Join-Path $RuntimeRoot 'models')`"")
$service = Start-Process -FilePath $pythonExe -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $RuntimeRoot "server-$stamp.log") -RedirectStandardError (Join-Path $RuntimeRoot "server-$stamp-error.log")
$deadline = (Get-Date).AddSeconds(20)
do {
  if ($service.HasExited) { throw 'Local voice service exited. Inspect its runtime error log.' }
  try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:11435/health' -TimeoutSec 2 } catch { $health = $null }
  if ($health) { $health | ConvertTo-Json -Depth 5; exit 0 }
  Start-Sleep -Milliseconds 300
} while ((Get-Date) -lt $deadline)
throw 'Local voice service did not become available. No cloud fallback was attempted.'
