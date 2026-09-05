$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RustupHome = Join-Path $ProjectRoot ".devtools\rustup"
$CargoHome = Join-Path $ProjectRoot ".devtools\cargo"
$PnpmHome = Join-Path $ProjectRoot ".devtools\pnpm"

$CondaInfo = & conda env list --json | ConvertFrom-Json
$CondaEnvironment = $CondaInfo.envs | Where-Object { (Split-Path -Leaf $_) -eq "yanyi-dev" } | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($CondaEnvironment)) {
  throw "Conda environment 'yanyi-dev' was not found. Create it from environment.yml first."
}

$env:RUSTUP_HOME = $RustupHome
$env:CARGO_HOME = $CargoHome
$env:PNPM_HOME = $PnpmHome
$env:CONDA_DEFAULT_ENV = "yanyi-dev"
$env:CONDA_PREFIX = $CondaEnvironment
$CondaPaths = @(
  $CondaEnvironment,
  (Join-Path $CondaEnvironment "Scripts"),
  (Join-Path $CondaEnvironment "Library\bin"),
  (Join-Path $CondaEnvironment "Library\usr\bin"),
  (Join-Path $CondaEnvironment "Library\mingw-w64\bin")
)

$VcVars = $env:YANYI_VCVARS_PATH
if ([string]::IsNullOrWhiteSpace($VcVars)) {
  $VsWhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path -LiteralPath $VsWhere) {
    $VcVars = & $VsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find "VC\Auxiliary\Build\vcvars64.bat" | Select-Object -First 1
  }
}
if ([string]::IsNullOrWhiteSpace($VcVars) -or -not (Test-Path -LiteralPath $VcVars)) {
  throw "Microsoft C++ Build Tools environment was not found. Install Desktop development with C++, or set YANYI_VCVARS_PATH to vcvars64.bat."
}
cmd.exe /d /s /c "`"$VcVars`" >nul && set" | ForEach-Object {
  if ($_ -match "^([^=]+)=(.*)$") {
    Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2]
  }
}
$ToolPaths = @((Join-Path $CargoHome "bin"), $PnpmHome)
$env:PATH = ($ToolPaths + $CondaPaths + @($env:PATH)) -join ";"

$ResolvedNode = (Get-Command node -ErrorAction Stop).Source
$ResolvedCargo = (Get-Command cargo -ErrorAction Stop).Source
if (-not $ResolvedNode.StartsWith($CondaEnvironment, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Node did not resolve from yanyi-dev: $ResolvedNode"
}
if (-not $ResolvedCargo.StartsWith($CargoHome, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Cargo did not resolve from project .devtools: $ResolvedCargo"
}

Write-Output "Yanyi development environment is active for this PowerShell session."
Write-Output "Conda: $CondaEnvironment"
Write-Output "Rust: $CargoHome"
