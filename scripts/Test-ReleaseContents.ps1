param(
  [string[]]$Roots
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Roots -or $Roots.Count -eq 0) {
  $Roots = @(
    (Join-Path $ProjectRoot "apps\desktop\dist"),
    (Join-Path $ProjectRoot "apps\desktop\src-tauri\resources"),
    (Join-Path $ProjectRoot "apps\edge-extension\.output\edge-mv3"),
    (Join-Path $ProjectRoot "apps\edge-extension\.output\chrome-mv3")
  )
}

$ResolvedProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$ForbiddenNames = @(
  "*.test.*", "*.spec.*", "*.db", "*.db-wal", "*.db-shm", "*.log", "*.md", ".env*"
)
$ForbiddenPathFragments = @("fixture", "test-results", "playwright", "coverage", "target\debug")
$TextExtensions = @(".css", ".html", ".js", ".json", ".mjs")
$ForbiddenTextPatterns = @(
  @{ Label = "test fixture code"; Regex = "createFixturePopupAdapter|popupFixtures|@yanyi/test-fixtures" },
  @{ Label = "hidden reasoning field"; Regex = "(?<![A-Za-z0-9_])reasoning_content(?![A-Za-z0-9_])" },
  @{ Label = "plaintext API key"; Regex = "(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}" }
)
$Violations = [Collections.Generic.List[string]]::new()

foreach ($Root in $Roots) {
  if (-not (Test-Path -LiteralPath $Root)) {
    throw "Release content audit root is missing; build the artifact before auditing: $Root"
  }
  $ResolvedRoot = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Root).Path)
  if (-not $ResolvedRoot.StartsWith($ResolvedProjectRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing release audit outside workspace: $ResolvedRoot"
  }
  Get-ChildItem -LiteralPath $ResolvedRoot -Recurse -File | ForEach-Object {
    $Relative = $_.FullName.Substring($ResolvedProjectRoot.Length).TrimStart('\')
    foreach ($Pattern in $ForbiddenNames) {
      if ($_.Name -like $Pattern) { $Violations.Add("$Relative (matches $Pattern)") }
    }
    foreach ($Fragment in $ForbiddenPathFragments) {
      if ($Relative.IndexOf($Fragment, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $Violations.Add("$Relative (contains $Fragment)")
      }
    }
    if ($TextExtensions -contains $_.Extension.ToLowerInvariant()) {
      $Content = [IO.File]::ReadAllText($_.FullName)
      foreach ($Pattern in $ForbiddenTextPatterns) {
        if ([Text.RegularExpressions.Regex]::IsMatch($Content, $Pattern.Regex)) {
          $Violations.Add("$Relative (contains $($Pattern.Label))")
        }
      }
    }
  }
}

if ($Violations.Count -gt 0) {
  $Violations | Sort-Object -Unique | ForEach-Object { Write-Error "Release content violation: $_" }
  throw "Release content audit failed."
}
Write-Output "Release content audit passed: no tests, fixtures, hidden reasoning fields, logs, databases, Markdown, or environment files found."
