param([switch]$SkipTests)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot "Enter-YanyiDev.ps1")
Push-Location $ProjectRoot
try {
  if (-not $SkipTests) {
    pnpm lint
    if ($LASTEXITCODE -ne 0) { throw "pnpm lint failed with exit code $LASTEXITCODE" }
    pnpm typecheck
    if ($LASTEXITCODE -ne 0) { throw "pnpm typecheck failed with exit code $LASTEXITCODE" }
    pnpm test
    if ($LASTEXITCODE -ne 0) { throw "pnpm test failed with exit code $LASTEXITCODE" }
    cargo test --workspace
    if ($LASTEXITCODE -ne 0) { throw "cargo test failed with exit code $LASTEXITCODE" }
    cargo clippy --workspace --all-targets -- -D warnings
    if ($LASTEXITCODE -ne 0) { throw "cargo clippy failed with exit code $LASTEXITCODE" }
    cargo fmt --all -- --check
    if ($LASTEXITCODE -ne 0) { throw "cargo fmt failed with exit code $LASTEXITCODE" }
  }
  cargo build -p native-host --release
  if ($LASTEXITCODE -ne 0) { throw "Native Host release build failed with exit code $LASTEXITCODE" }
  $ResourceDirectory = Join-Path $ProjectRoot "apps\desktop\src-tauri\resources\native-host"
  New-Item -ItemType Directory -Force -Path $ResourceDirectory | Out-Null
  Copy-Item -LiteralPath (Join-Path $ProjectRoot "target\release\yanyi-native-host.exe") -Destination (Join-Path $ResourceDirectory "yanyi-native-host.exe") -Force
  pnpm --filter @yanyi/edge-extension build
  if ($LASTEXITCODE -ne 0) { throw "Edge extension build failed with exit code $LASTEXITCODE" }
  pnpm --filter @yanyi/edge-extension build:chrome
  if ($LASTEXITCODE -ne 0) { throw "Chrome extension build failed with exit code $LASTEXITCODE" }
  pnpm --filter @yanyi/desktop build
  if ($LASTEXITCODE -ne 0) { throw "Desktop frontend build failed with exit code $LASTEXITCODE" }
  & (Join-Path $PSScriptRoot "Test-ReleaseContents.ps1")
  pnpm --filter @yanyi/desktop tauri build --config src-tauri/tauri.release.conf.json
  if ($LASTEXITCODE -ne 0) { throw "Tauri/NSIS build failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}
