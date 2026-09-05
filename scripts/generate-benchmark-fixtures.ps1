param(
  [string]$OutputRoot = (Join-Path $PSScriptRoot '..\.bench-fixtures'),
  [int]$DocumentCount = 10000
)

$ErrorActionPreference = 'Stop'
$longRoot = Join-Path $OutputRoot 'long-document'
$manyRoot = Join-Path $OutputRoot 'many-documents'
New-Item -ItemType Directory -Force -Path $longRoot,$manyRoot | Out-Null

$paragraph = 'This paragraph validates continuous scrolling, line height, layout stability, and reading-position restoration. JingReader never modifies source documents.'
$builder = [System.Text.StringBuilder]::new()
[void]$builder.AppendLine('# 100k-character reading benchmark')
for ($i = 1; $builder.Length -lt 110000; $i++) {
  if ($i % 20 -eq 1) { [void]$builder.AppendLine("`n## Section $i") }
  [void]$builder.AppendLine("$paragraph`n")
}
[System.IO.File]::WriteAllText((Join-Path $longRoot 'long-100k.md'),$builder.ToString(),[System.Text.UTF8Encoding]::new($false))

for ($i = 1; $i -le $DocumentCount; $i++) {
  $bucketIndex = [int][math]::Floor(($i - 1) / 100)
  $bucket = Join-Path $manyRoot ('group-{0:D3}' -f $bucketIndex)
  New-Item -ItemType Directory -Force -Path $bucket | Out-Null
  $content = "# Document $i`n`nIndex benchmark keyword benchmark-$i. Shared full-text phrase: comfortable long-form reading."
  [System.IO.File]::WriteAllText((Join-Path $bucket ("document-{0:D5}.md" -f $i)),$content,[System.Text.UTF8Encoding]::new($false))
}

Write-Output "LONG_CHARS=$($builder.Length)"
Write-Output "DOCUMENTS=$DocumentCount"
Write-Output "OUTPUT=$([System.IO.Path]::GetFullPath($OutputRoot))"
