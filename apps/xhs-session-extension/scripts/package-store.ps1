param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$dist = Join-Path $Root "dist"
$packages = Join-Path $dist "packages"

New-Item -ItemType Directory -Force -Path $packages | Out-Null

$targets = @(
  @{ Source = (Join-Path $dist "store-chromium\*"); Output = (Join-Path $packages "syntrae-xhs-connector-chrome-store.zip") },
  @{ Source = (Join-Path $dist "store-chromium\*"); Output = (Join-Path $packages "syntrae-xhs-connector-edge-store.zip") },
  @{ Source = (Join-Path $dist "store-firefox\*"); Output = (Join-Path $packages "syntrae-xhs-connector-firefox-store.zip") }
)

foreach ($target in $targets) {
  Remove-Item -Force -ErrorAction SilentlyContinue $target.Output
  Compress-Archive -Path $target.Source -DestinationPath $target.Output
}

Write-Host "Created store packages in $packages"
