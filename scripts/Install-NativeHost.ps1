param(
  [string]$HostExecutable = "",
  [ValidateSet("Edge", "Chrome")]
  [string]$Browser = "Edge",
  [string]$ExtensionId = ""
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($HostExecutable)) {
  $HostExecutable = Join-Path $ProjectRoot "target\release\yanyi-native-host.exe"
}
$ResolvedHost = Resolve-Path -LiteralPath $HostExecutable -ErrorAction Stop
$BrowserSlug = $Browser.ToLowerInvariant()
if ([string]::IsNullOrWhiteSpace($ExtensionId)) {
  $ExtensionId = if ($Browser -eq "Chrome") { "clneblfdkkemjfehjgolimihblegcice" } else { "ajpiobadehjdkionkgfkpipjfgdgopjn" }
}
$ManifestDirectory = Join-Path $env:LOCALAPPDATA "Yanyi\NativeMessagingHosts\$BrowserSlug"
$ManifestPath = Join-Path $ManifestDirectory "cn.yanyi.native_host.json"
$RegistryPath = if ($Browser -eq "Chrome") { "HKCU:\Software\Google\Chrome\NativeMessagingHosts\cn.yanyi.native_host" } else { "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\cn.yanyi.native_host" }

New-Item -ItemType Directory -Force -Path $ManifestDirectory | Out-Null
$ManifestJson = @{
  name = "cn.yanyi.native_host"
  description = "Yanyi local translation native host"
  path = $ResolvedHost.Path
  type = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json -Depth 3
$Utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($ManifestPath, $ManifestJson, $Utf8WithoutBom)

New-Item -Path $RegistryPath -Force | Out-Null
Set-ItemProperty -Path $RegistryPath -Name "(default)" -Value $ManifestPath

Write-Output "Native Host registered: $ManifestPath"
Write-Output "Browser: $Browser"
Write-Output "Allowed extension: $ExtensionId"
