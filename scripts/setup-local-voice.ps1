param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA 'Sebby\local-voice')
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$pythonRoot = Join-Path $env:LOCALAPPDATA 'Sebby\Python312'
$pythonExe = Join-Path $pythonRoot 'python.exe'
New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null

function Get-VerifiedFile([string]$Url, [string]$Destination, [string]$Sha256) {
  if (Test-Path -LiteralPath $Destination) {
    if ((Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash -ne $Sha256) {
      throw "Existing file has a different hash and was preserved: $Destination"
    }
    return
  }
  $parent = Split-Path $Destination -Parent
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  $temporary = Join-Path $parent ([guid]::NewGuid().ToString() + '.download')
  Invoke-WebRequest -Uri $Url -OutFile $temporary
  if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ne $Sha256) {
    throw "Download checksum failed; untrusted download was not installed: $Url"
  }
  Move-Item -LiteralPath $temporary -Destination $Destination
}

if (!(Test-Path -LiteralPath $pythonExe)) {
  $installer = Join-Path $RuntimeRoot 'python-3.12.10-amd64.exe'
  Get-VerifiedFile 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe' $installer '67B5635E80EA51072B87941312D00EC8927C4DB9BA18938F7AD2D27B328B95FB'
  $signature = Get-AuthenticodeSignature -FilePath $installer
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Python Software Foundation') {
    throw 'Python installer signature validation failed.'
  }
  $arguments = @('/quiet', 'InstallAllUsers=0', "TargetDir=`"$pythonRoot`"", 'Include_launcher=0', 'InstallLauncherAllUsers=0', 'PrependPath=0', 'Include_test=0', 'Include_doc=0', 'Shortcuts=0')
  $installation = Start-Process -FilePath $installer -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
  if ($installation.ExitCode -ne 0) { throw "Python installation failed: $($installation.ExitCode)" }
}

$venvPython = Join-Path $RuntimeRoot 'venv\Scripts\python.exe'
if (!(Test-Path -LiteralPath $venvPython)) {
  & $pythonExe -m venv (Join-Path $RuntimeRoot 'venv')
  if ($LASTEXITCODE -ne 0) { throw 'Could not create isolated voice environment.' }
}
& $venvPython -m pip install --index-url https://pypi.org/simple -r (Join-Path $repoRoot 'native\local-voice\requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Voice dependency installation failed.' }

$models = Join-Path $RuntimeRoot 'models'
Get-VerifiedFile 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.onnx' (Join-Path $models 'kokoro-v1.0.onnx') 'BEB0D1848DEE9A49DA392CC3DF26958D46CFA35D321EDF434F52949153F0DF3A'
Get-VerifiedFile 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin' (Join-Path $models 'voices-v1.0.bin') 'BCA610B8308E8D99F32E6FE4197E7EC01679264EFED0CAC9140FE9C29F1FBF7D'
$whisper = 'https://huggingface.co/Systran/faster-whisper-small/resolve/536b0662742c02347bc0e980a01041f333bce120/'
$whisperRoot = Join-Path $models 'whisper-small'
Get-VerifiedFile ($whisper + 'model.bin') (Join-Path $whisperRoot 'model.bin') '3E305921506D8872816023E4C273E75D2419FB89B24DA97B4FE7BCE14170D671'
Get-VerifiedFile ($whisper + 'config.json') (Join-Path $whisperRoot 'config.json') 'B55496AC7940A7AE47D2C01EAB40EDFD8701FEEC1229D9CCE3B40014383FB828'
Get-VerifiedFile ($whisper + 'tokenizer.json') (Join-Path $whisperRoot 'tokenizer.json') 'FB7B63191E9BB045082C79FD742A3106A12C99513AB30DF4A0D47FA6CB6FD0AB'
Get-VerifiedFile ($whisper + 'vocabulary.txt') (Join-Path $whisperRoot 'vocabulary.txt') '34CE3FE1C5041027B3F8D42912270993F986DBC4BB34CF27F951E34A1E453913'
& $venvPython -m unittest discover -s (Join-Path $repoRoot 'native\local-voice') -p 'test_*.py'
if ($LASTEXITCODE -ne 0) { throw 'Local voice contract checks failed.' }
Write-Output 'Local voice setup complete. Runtime uses local model paths only; no recordings are stored.'
Write-Output 'Start explicitly with scripts/start-local-voice.ps1. Downloads and package installation happened only during this setup.'
