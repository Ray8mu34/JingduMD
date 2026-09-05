param([int]$FileCount = 10000, [int]$ParagraphCount = 1800)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$generated = Join-Path $project 'fixtures\generated'
$manyFiles = Join-Path $generated 'many-files'
New-Item -ItemType Directory -Path $manyFiles -Force | Out-Null

$utf8 = [Text.Encoding]::UTF8
$paragraph = $utf8.GetString([Convert]::FromBase64String('6ZW/5pe26Ze06ZiF6K+76ZyA6KaB56iz5a6a55qE5a2X6Imy44CB6IqC5aWP5ZKM55WZ55m944CC6L+Z5Liq5q616JC955So5LqO6aqM6K+B6L+e57ut5rua5Yqo44CB5bu26L+f5riy5p+T44CB55uu5b2V6Lez6L2s5Lul5Y+K6ZiF6K+75L2N572u5oGi5aSN44CC'))
$chapterLabel = $utf8.GetString([Convert]::FromBase64String('5Y6L5Yqb5rWL6K+V56ug6IqC'))
$documentLabel = $utf8.GetString([Convert]::FromBase64String('5paH5qGj'))
$indexText = $utf8.GetString([Convert]::FromBase64String('57Si5byV5LiO5paH5Lu25qCR5Y6L5Yqb5rWL6K+V44CC'))
$builder = [System.Text.StringBuilder]::new()
for ($i = 1; $i -le $ParagraphCount; $i++) {
  if (($i - 1) % 60 -eq 0) { [void]$builder.AppendLine("## $chapterLabel $([math]::Ceiling($i / 60))") }
  [void]$builder.AppendLine("$paragraph`n")
}
[IO.File]::WriteAllText((Join-Path $generated 'long-100k.md'), $builder.ToString(), [Text.UTF8Encoding]::new($false))

for ($i = 1; $i -le $FileCount; $i++) {
  $bucketNumber = [int][math]::Floor(($i - 1) / 100)
  $bucket = Join-Path $manyFiles ('{0:D3}' -f $bucketNumber)
  New-Item -ItemType Directory -Path $bucket -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $bucket ("note-{0:D5}.md" -f $i)), "# $documentLabel $i`n`n$indexText", [Text.UTF8Encoding]::new($false))
}

Write-Host "Generated $ParagraphCount paragraphs and $FileCount Markdown files in $generated"
