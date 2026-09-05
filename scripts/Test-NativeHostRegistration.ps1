param(
  [ValidateSet("Edge", "Chrome")]
  [string]$Browser = "Edge"
)

$ErrorActionPreference = "Stop"
$RegistryPath = if ($Browser -eq "Chrome") { "HKCU:\Software\Google\Chrome\NativeMessagingHosts\cn.yanyi.native_host" } else { "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\cn.yanyi.native_host" }
if (-not (Test-Path -LiteralPath $RegistryPath)) {
  throw "$Browser Native Host registry entry is missing. Run scripts/Install-NativeHost.ps1 -Browser $Browser."
}
$ManifestPath = (Get-ItemProperty -LiteralPath $RegistryPath)."(default)"
if (-not (Test-Path -LiteralPath $ManifestPath)) {
  throw "Native Host manifest is missing: $ManifestPath"
}
$Manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not (Test-Path -LiteralPath $Manifest.path)) {
  throw "Native Host executable is missing: $($Manifest.path)"
}
Write-Output "Browser: $Browser"
Write-Output "Registry: OK"
Write-Output "Manifest: $ManifestPath"
Write-Output "Executable: $($Manifest.path)"
Write-Output "Allowed origins: $($Manifest.allowed_origins -join ', ')"
