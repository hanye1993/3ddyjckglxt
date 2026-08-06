# Resolve repo root: .../clients/android → .../
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$web = Join-Path $repoRoot "clients\web"
$dest = Join-Path $repoRoot "clients\android\app\src\main\assets\www"

if (-not (Test-Path (Join-Path $web "index.html"))) {
  throw "Web client not found: $web"
}

if (Test-Path $dest) {
  Remove-Item $dest -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $dest | Out-Null

Copy-Item (Join-Path $web "index.html") $dest -Force
if (Test-Path (Join-Path $web "manifest.webmanifest")) {
  Copy-Item (Join-Path $web "manifest.webmanifest") $dest -Force
}
Copy-Item (Join-Path $web "css") (Join-Path $dest "css") -Recurse -Force
Copy-Item (Join-Path $web "js") (Join-Path $dest "js") -Recurse -Force

Write-Host "Synced $web -> $dest"
Get-ChildItem $dest -Recurse -File | ForEach-Object {
  $_.FullName.Substring($dest.Length)
}
