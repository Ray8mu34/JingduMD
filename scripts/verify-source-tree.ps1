param(
  [Parameter(Mandatory = $true)][string]$Path,
  [Parameter(Mandatory = $true)][string]$Baseline,
  [Parameter(Mandatory = $true)][ValidateSet('Capture', 'Verify')][string]$Mode
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $Path).Path

function Get-TreeSnapshot {
  $items = Get-ChildItem -LiteralPath $root -Force -Recurse
  @($items | ForEach-Object {
    $relative = $_.FullName.Substring($root.Length).TrimStart('\')
    if ($_.PSIsContainer) {
      [ordered]@{ path = $relative; kind = 'directory'; length = 0; sha256 = '' }
    } else {
      [ordered]@{ path = $relative; kind = 'file'; length = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
    }
  } | Sort-Object path)
}

if ($Mode -eq 'Capture') {
  $parent = Split-Path -Parent $Baseline
  if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  Get-TreeSnapshot | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $Baseline -Encoding utf8
  Write-Host "Read-only baseline captured: $Baseline"
  exit 0
}

if (-not (Test-Path -LiteralPath $Baseline)) { throw "Baseline not found: $Baseline" }
$expected = Get-Content -LiteralPath $Baseline -Raw | ConvertFrom-Json
$actual = Get-TreeSnapshot
$expectedJson = @($expected) | ConvertTo-Json -Depth 4 -Compress
$actualJson = @($actual) | ConvertTo-Json -Depth 4 -Compress
if ($expectedJson -ne $actualJson) {
  $before = @($expected | ForEach-Object { "$($_.kind)|$($_.path)|$($_.length)|$($_.sha256)" })
  $after = @($actual | ForEach-Object { "$($_.kind)|$($_.path)|$($_.length)|$($_.sha256)" })
  Compare-Object $before $after | Format-Table -AutoSize
  throw 'The source tree changed. Read-only verification failed.'
}
Write-Host 'The source tree matches its baseline. Read-only verification passed.'
