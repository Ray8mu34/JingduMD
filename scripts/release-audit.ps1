param(
  [string]$CertificateThumbprint = '',
  [string]$TimestampUrl = 'http://timestamp.digicert.com',
  [switch]$SkipChecks,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$release = Join-Path $project 'release'
$env:RUSTUP_HOME = 'D:\Env\Rust\Rustup'
$env:CARGO_HOME = 'D:\Env\Rust\Cargo'
$env:Path = "D:\Env\Rust\Cargo\bin;$env:Path"
$config = Get-Content -LiteralPath (Join-Path $project 'src-tauri\tauri.conf.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $config.version

function Invoke-Checked([scriptblock]$Command) {
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE" }
}

if (-not $SkipChecks) {
  Invoke-Checked { pnpm.cmd test }
  Invoke-Checked { pnpm.cmd build }
  Invoke-Checked { cargo fmt --manifest-path (Join-Path $project 'src-tauri\Cargo.toml') -- --check }
  Invoke-Checked { cargo clippy --manifest-path (Join-Path $project 'src-tauri\Cargo.toml') -- -D warnings }
  Invoke-Checked { cargo test --manifest-path (Join-Path $project 'src-tauri\Cargo.toml') }
}
if (-not $SkipBuild) { Invoke-Checked { pnpm.cmd tauri build } }

New-Item -ItemType Directory -Path $release -Force | Out-Null
$bundleRoot = Join-Path $project 'src-tauri\target\release\bundle'
$artifacts = @()
if (Test-Path -LiteralPath $bundleRoot) {
  $bundleArtifacts = Get-ChildItem -LiteralPath $bundleRoot -Recurse -File | Where-Object { $_.Extension -in '.exe', '.msi' -and $_.Name -match [regex]::Escape($version) }
  foreach ($bundleArtifact in $bundleArtifacts) {
    $destination = Join-Path $release $bundleArtifact.Name
    Copy-Item -LiteralPath $bundleArtifact.FullName -Destination $destination -Force
    $artifacts += Get-Item -LiteralPath $destination
  }
}
$portableSource = Join-Path $project 'src-tauri\target\release\jingreader.exe'
if (Test-Path -LiteralPath $portableSource) {
  $portable = Join-Path $release "JingReader-Portable-$version.exe"
  Copy-Item -LiteralPath $portableSource -Destination $portable -Force
  $artifacts += Get-Item -LiteralPath $portable
}
if (-not $artifacts.Count) { throw 'No release artifacts were found.' }

$signed = $false
if ($CertificateThumbprint) {
  $signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if (-not $signtool) {
    $signtool = Get-ChildItem -LiteralPath 'D:\Env\VSBuildTools\Windows Kits\10\bin' -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  }
  if (-not $signtool) { throw 'signtool.exe was not found. Verify that the Windows SDK is installed.' }
  $signtoolPath = if ($signtool.Source) { $signtool.Source } else { $signtool.FullName }
  foreach ($artifact in $artifacts) {
    Invoke-Checked { & $signtoolPath sign /sha1 $CertificateThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $artifact.FullName }
    $signature = Get-AuthenticodeSignature -LiteralPath $artifact.FullName
    if ($signature.Status -ne 'Valid') { throw "Signature verification failed: $($artifact.FullName) ($($signature.Status))" }
  }
  $signed = $true
}

$uniqueArtifacts = @($artifacts | Sort-Object FullName -Unique)
$manifestArtifacts = @($uniqueArtifacts | ForEach-Object {
  $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
  [ordered]@{ name = $_.Name; size = $_.Length; sha256 = $hash.Hash; signed = $signed }
})
$manifest = [ordered]@{
  schemaVersion = 1
  product = 'JingReader'
  version = $version
  platform = 'windows-x86_64'
  generatedUtc = [DateTime]::UtcNow.ToString('o')
  updaterEnabled = $false
  artifacts = $manifestArtifacts
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $release 'release-manifest.json') -Encoding utf8
$manifestArtifacts | ForEach-Object { "$($_.sha256)  $($_.name)" } | Set-Content -LiteralPath (Join-Path $release 'SHA256SUMS.txt') -Encoding ascii
Write-Host "Release audit completed: $release"
