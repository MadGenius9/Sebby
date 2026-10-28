<#
.SYNOPSIS
Verifies the checked-out Sebby source and optionally produces a local unsigned installer.
.DESCRIPTION
Run explicitly from PowerShell on Windows with Node.js 24 LTS already installed.
Does not install Node/PowerShell, launch Sebby, sign, publish, push, or connect accounts.
npm ci installs only this repository's lockfile dependencies and runs their lifecycle scripts.
Review package.json and package-lock.json before running. Never run against untrusted source.
#>
[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$SkipPackage
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$exitCode = 0
$oldDiscovery = [Environment]::GetEnvironmentVariable('CSC_IDENTITY_AUTO_DISCOVERY', 'Process')
$root = Split-Path -Parent $PSScriptRoot

function Invoke-NpmStep {
    param([string]$Label, [string[]]$NpmArguments)
    Write-Host "`n=== $Label ===" -ForegroundColor Cyan
    & $script:npmCommand @NpmArguments
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        $script:exitCode = $code
        throw "$Label failed (exit $code). Later steps were not run."
    }
}

Push-Location $root
try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'This verification script must run on Windows. No steps were run.'
    }
    if (-not (Test-Path -LiteralPath 'package-lock.json' -PathType Leaf)) {
        throw 'package-lock.json is required. Restore the checked-in lockfile before continuing.'
    }
    $node = Get-Command node.exe -CommandType Application -ErrorAction Stop
    $script:npmCommand = (Get-Command npm.cmd -CommandType Application -ErrorAction Stop).Source
    $version = & $node.Source --version
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v24\.') {
        throw 'Node.js 24 LTS is required for this verification recipe. Install it through your trusted software process; this script will not install it.'
    }
    $package = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
    foreach ($name in @('test', 'test:components', 'build', 'package:win')) {
        if (-not $package.scripts.PSObject.Properties[$name]) {
            throw "Required npm script is missing: $name"
        }
    }
    if (-not $SkipPackage) {
        # Never consume signing credentials merely because the shell inherited them.
        foreach ($name in @('CSC_LINK','CSC_KEY_PASSWORD','WIN_CSC_LINK','WIN_CSC_KEY_PASSWORD','CSC_NAME','WIN_CSC_NAME','AZURE_TENANT_ID','AZURE_CLIENT_ID','AZURE_CLIENT_SECRET')) {
            if ([Environment]::GetEnvironmentVariable($name, 'Process')) {
                throw "Signing-related environment setting detected ($name). Use a clean non-signing shell for this unsigned verification script. Its value was not read into output."
            }
        }
        foreach ($name in @('sign','signtoolOptions','azureSignOptions','certificateFile','certificateSubjectName','certificateSha1','signingHashAlgorithms')) {
            if ($package.build.win.PSObject.Properties[$name]) {
                throw "Windows signing configuration detected ($name). This script only supports unsigned verification."
            }
        }
        $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
    }
    if ($SkipInstall) {
        if (-not (Test-Path -LiteralPath 'node_modules' -PathType Container)) { throw '-SkipInstall requires existing node_modules.' }
        Write-Warning 'Dependency install skipped. This run does not verify a clean lockfile install.'
    } else {
        Invoke-NpmStep -Label 'Clean lockfile dependency install' -NpmArguments @('ci','--no-fund','--no-audit')
    }
    Invoke-NpmStep -Label 'Service and security tests' -NpmArguments @('test')
    Invoke-NpmStep -Label 'React component tests' -NpmArguments @('run','test:components')
    Invoke-NpmStep -Label 'TypeScript and production build' -NpmArguments @('run','build')
    if ($SkipPackage) {
        Write-Warning 'Installer packaging skipped. No installer evidence established.'
    } else {
        Invoke-NpmStep -Label 'Local unsigned Windows NSIS package (no publish)' -NpmArguments @('run','package:win','--','--publish','never')
        Write-Host 'Packaging command passed. Inspect release/ manually and record the produced filename, hash and signature status.'
    }
    Write-Host "`nAutomated source checks passed. Native launch/install/security/accessibility checks remain manual." -ForegroundColor Green
} catch {
    if ($exitCode -eq 0) { $exitCode = 1 }
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
} finally {
    [Environment]::SetEnvironmentVariable('CSC_IDENTITY_AUTO_DISCOVERY', $oldDiscovery, 'Process')
    Pop-Location
}
exit $exitCode
