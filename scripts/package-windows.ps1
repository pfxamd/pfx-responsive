$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$corePath = Join-Path $root 'core'
if (!(Test-Path (Join-Path $corePath 'src/server.js'))) { throw 'Core source is missing from the build workspace' }
$dist = Join-Path $root 'out/PFx Responsive'
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dist | Out-Null
# Node is copied from the pinned Node 22 environment of GitHub Actions.
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
Copy-Item $nodePath (Join-Path $dist 'node.exe')
New-Item -ItemType Directory -Force -Path (Join-Path $dist 'app'), (Join-Path $dist 'core') | Out-Null
Copy-Item (Join-Path $root 'src') (Join-Path $dist 'app/src') -Force -Recurse
Copy-Item (Join-Path $root 'public') (Join-Path $dist 'app/public') -Force -Recurse
Copy-Item (Join-Path $root 'package.json') (Join-Path $dist 'app/package.json')
Copy-Item (Join-Path $corePath 'src') (Join-Path $dist 'core/src') -Recurse
Copy-Item (Join-Path $corePath 'node_modules') (Join-Path $dist 'core/node_modules') -Recurse
Copy-Item (Join-Path $corePath 'package.json') (Join-Path $dist 'core/package.json')
# Chromium was installed adjacent to playwright-core, not in user profile.
$chromium = Join-Path $dist 'core/node_modules/playwright-core/.local-browsers'
if (!(Test-Path $chromium)) { throw 'Bundled Playwright Chromium not found' }
$exe = Join-Path $root 'windows/launcher/PFxResponsive.csproj'
dotnet publish $exe -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:PublishTrimmed=false -o (Join-Path $root 'out/launcher')
Copy-Item (Join-Path $root 'out/launcher/PFx Responsive.exe') (Join-Path $dist 'PFx Responsive.exe')
@'
PFx Responsive - Windows x64, local alpha

Double-click PFx Responsive.exe. Firefox is preferred if installed; otherwise
your default browser opens. Close the app using its system tray icon > Exit.
All runtime components are inside this folder. Do not move the EXE alone.
Internet access is needed to browse websites; no Docker, Node.js or Chromium
installation is required. The Windows Core is LOCAL-ONLY experimental mode
and is NOT hardened for public hosting or untrusted multi-user browsing.
'@ | Set-Content (Join-Path $dist 'START HERE.txt') -Encoding utf8
$zip = Join-Path $root 'out/PFx-Responsive-Windows-x64.zip'
if (Test-Path $zip) {Remove-Item $zip -Force}
Compress-Archive -Path $dist -DestinationPath $zip -CompressionLevel Optimal
Write-Host "PORTABLE_ZIP=$zip"
