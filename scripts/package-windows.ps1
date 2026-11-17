param([Parameter(Mandatory = $true)][string]$OutputDirectory)

$ErrorActionPreference = 'Stop'
$node = (Get-Command node.exe).Source
$platform = & $node -p "process.platform + ' ' + process.arch"
if ($LASTEXITCODE -ne 0 -or $platform -ne 'win32 x64') {
    throw 'Build the test package with Windows x64 Node.js.'
}

$stage = Join-Path $OutputDirectory 'staging'
$package = Join-Path $stage 'Sebby'
$zip = Join-Path $OutputDirectory 'Sebby-Windows-x64-Test-1.zip'
New-Item -ItemType Directory -Path "$package/runtime", "$package/scripts", "$package/server", "$package/web" | Out-Null
Copy-Item LICENSE, THIRD_PARTY_NOTICES.md, package.json, package-lock.json $package
Copy-Item docs/READ-ME-FIRST.txt "$package/READ-ME-FIRST.txt"
Copy-Item scripts/Start-Sebby-Test.cmd "$package/Start-Sebby.cmd"
Copy-Item scripts/start-local.mjs "$package/scripts/"
Copy-Item server/package.json "$package/server/"
Copy-Item web/package.json "$package/web/"
Copy-Item -Recurse server/dist "$package/server/"
Copy-Item -Recurse web/dist "$package/web/"
Copy-Item $node "$package/runtime/node.exe"
Copy-Item (Join-Path (Split-Path $node) 'LICENSE') "$package/runtime/LICENSE"

Push-Location $package
try {
    & npm.cmd ci --omit=dev --workspace server
    if ($LASTEXITCODE -ne 0) { throw 'Installing Windows runtime dependencies failed.' }
    # The application uses relative paths for its own workspace files.
    # npm's workspace junctions are unnecessary and can point outside the ZIP.
    foreach ($name in @('server', 'web')) {
        $link = Join-Path $package "node_modules/@grokbot/$name"
        if (Test-Path -LiteralPath $link) {
            & $node -e 'require("node:fs").unlinkSync(process.argv[1])' $link
            if ($LASTEXITCODE -ne 0) { throw "Removing workspace junction failed: $name" }
        }
    }
} finally {
    Pop-Location
}

& tar.exe -a -cf $zip -C $stage Sebby
if ($LASTEXITCODE -ne 0) { throw 'Creating the Windows ZIP failed.' }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant()
"$hash  $(Split-Path -Leaf $zip)" | Set-Content -Encoding ascii "$zip.sha256"
