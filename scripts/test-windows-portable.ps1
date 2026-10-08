$ErrorActionPreference = 'Stop'
$base = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$unpack = Join-Path $base 'out/verification'
if (Test-Path $unpack) { Remove-Item $unpack -Recurse -Force }
Expand-Archive (Join-Path $base 'out/PFx-Responsive-Windows-x64.zip') $unpack -Force
$exedir = Join-Path $unpack 'PFx Responsive'
$exe = Join-Path $exedir 'PFx Responsive.exe'
if (!(Test-Path $exe)) { throw 'Launcher executable missing from portable ZIP' }
if (!(Test-Path (Join-Path $exedir 'node.exe'))) { throw 'Node runtime missing from portable ZIP' }
if (!(Test-Path (Join-Path $exedir 'core/node_modules/playwright-core/.local-browsers'))) { throw 'Chromium missing from portable ZIP' }
$env:PFX_LAUNCHER_NO_BROWSER = '1'
$launcher = Start-Process -FilePath $exe -WorkingDirectory $exedir -PassThru
$headers = @{'x-pfx-app'='1'}
try {
  $online = $false
  for ($i = 0; $i -lt 100; $i++) {
    Start-Sleep -Milliseconds 900
    if ($launcher.HasExited) { throw "Launcher quit early ($($launcher.ExitCode))" }
    try {
      $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4177/health' -TimeoutSec 2
      if ($health.status -eq 'ok') {
        $page = Invoke-WebRequest -Uri 'http://127.0.0.1:4188/' -TimeoutSec 2
        if ($page.StatusCode -eq 200) { $online = $true; break }
      }
    } catch { }
  }
  if (-not $online) { throw 'Portable launcher did not start both bundled services' }
  $bootstrap = Invoke-RestMethod -Uri 'http://127.0.0.1:4188/api/bootstrap' -Headers $headers
  if ($bootstrap.workspaceKey.Length -ne 64) { throw 'Missing isolated workspace credential' }
  $headers['x-pfx-workspace'] = $bootstrap.workspaceKey
  $status = Invoke-RestMethod -Uri 'http://127.0.0.1:4188/api/status' -Headers $headers
  if ($status.state -ne 'online') { throw "Bundled Core is not authenticated: $($status.state)" }
  $body = @{url='https://example.com/';width=390;height=844} | ConvertTo-Json -Compress
  $session = Invoke-RestMethod -Uri 'http://127.0.0.1:4188/api/sessions' -Method Post -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 45
  if (-not $session.id) {throw 'Failed to open a live website'}
  $png = Join-Path $base 'out/windows-portable-test.png'
  Invoke-WebRequest -Uri "http://127.0.0.1:4188/api/sessions/$($session.id)/screenshot" -Headers $headers -OutFile $png -TimeoutSec 30
  $bytes = [System.IO.File]::ReadAllBytes($png)
  if ($bytes.Length -lt 1000 -or $bytes[0] -ne 137 -or $bytes[1] -ne 80 -or $bytes[2] -ne 78 -or $bytes[3] -ne 71) {throw 'Invalid real screenshot from packaged Core'}
  $closed = Invoke-RestMethod -Uri "http://127.0.0.1:4188/api/sessions/$($session.id)" -Headers $headers -Method Delete
  if (-not $closed.closed) {throw 'Session did not close'}
  Write-Host "WINDOWS_PORTABLE_PASS: serviceReady=true realScreenshot=$($bytes.Length) sessionClosed=true packagedNode=true packagedChromium=true"
} finally {
  if (-not $launcher.HasExited) { Stop-Process -Id $launcher.Id -Force -ErrorAction SilentlyContinue }
  # GitHub disposes this ephemeral runner and all associated child processes.
}
