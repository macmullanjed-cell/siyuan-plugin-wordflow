param(
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $OutputPath) { $OutputPath = Join-Path $root "package.zip" }
$OutputPath = [IO.Path]::GetFullPath($OutputPath)

$files = @(
  "icon.png",
  "preview.png",
  "index.js",
  "index.css",
  "plugin.json",
  "README.md",
  "README.zh-CN.md",
  "PRIVACY.md",
  "CHANGELOG.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "i18n/en.json",
  "i18n/zh-CN.json"
)

foreach ($relative in $files) {
  $source = Join-Path $root ($relative -replace "/", [IO.Path]::DirectorySeparatorChar)
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing release file: $relative" }
}

$icon = Get-Item -LiteralPath (Join-Path $root "icon.png")
$preview = Get-Item -LiteralPath (Join-Path $root "preview.png")
if ($icon.Length -gt 20KB) { throw "icon.png exceeds 20KB" }
if ($preview.Length -gt 200KB) { throw "preview.png exceeds 200KB" }

$manifest = Get-Content -LiteralPath (Join-Path $root "plugin.json") -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.name -ne "siyuan-plugin-wordflow") { throw "Unexpected plugin name" }
if ($manifest.version -ne "0.6.2") { throw "plugin.json version must be 0.6.2" }
if ($manifest.author -eq "GITHUB_OWNER" -or $manifest.url -match "GITHUB_OWNER") { throw "Replace the GitHub owner placeholder before building" }

if (Test-Path -LiteralPath $OutputPath) { Remove-Item -LiteralPath $OutputPath -Force }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [IO.File]::Open($OutputPath, [IO.FileMode]::CreateNew)
try {
  $archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
  try {
    foreach ($relative in $files) {
      $source = Join-Path $root ($relative -replace "/", [IO.Path]::DirectorySeparatorChar)
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $source, $relative, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally { $archive.Dispose() }
} finally { $stream.Dispose() }

$sha256 = [Security.Cryptography.SHA256]::Create()
try {
  $hashBytes = $sha256.ComputeHash([IO.File]::ReadAllBytes($OutputPath))
} finally {
  $sha256.Dispose()
}
$hash = ([BitConverter]::ToString($hashBytes)).Replace("-", "")
Write-Host "Built $OutputPath"
Write-Host "SHA256 $hash"
