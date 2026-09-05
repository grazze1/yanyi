param(
  [ValidateSet("Edge", "Chrome", "All")]
  [string]$Browser = "All",
  [switch]$DeleteUserData
)

$ErrorActionPreference = "Stop"
$Targets = if ($Browser -eq "All") { @("Edge", "Chrome") } else { @($Browser) }

foreach ($Target in $Targets) {
  $BrowserSlug = $Target.ToLowerInvariant()
  $RegistryPath = if ($Target -eq "Chrome") { "HKCU:\Software\Google\Chrome\NativeMessagingHosts\cn.yanyi.native_host" } else { "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\cn.yanyi.native_host" }
  $ManifestPath = Join-Path $env:LOCALAPPDATA "Yanyi\NativeMessagingHosts\$BrowserSlug\cn.yanyi.native_host.json"
  if (Test-Path -LiteralPath $RegistryPath) {
    Remove-Item -LiteralPath $RegistryPath -Recurse -Force
  }
  if (Test-Path -LiteralPath $ManifestPath) {
    Remove-Item -LiteralPath $ManifestPath -Force
  }
  Write-Output "$Target Native Host registration removed."
}

if ($Browser -eq "All") {
  $YanyiRoot = Join-Path $env:LOCALAPPDATA "Yanyi"
  $ExpectedRoot = [System.IO.Path]::GetFullPath($YanyiRoot).TrimEnd('\')
  $LocalRoot = [System.IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd('\')
  if (-not $ExpectedRoot.StartsWith("$LocalRoot\", [System.StringComparison]::OrdinalIgnoreCase) -or
      [System.IO.Path]::GetFileName($ExpectedRoot) -ne "Yanyi") {
    throw "Refusing to remove an unexpected install path: $ExpectedRoot"
  }

  foreach ($InstallArtifact in @("bin", "NativeMessagingHosts")) {
    $ArtifactPath = Join-Path $ExpectedRoot $InstallArtifact
    if (Test-Path -LiteralPath $ArtifactPath) {
      Remove-Item -LiteralPath $ArtifactPath -Recurse -Force
    }
  }

  if ($DeleteUserData -and (Test-Path -LiteralPath $ExpectedRoot)) {
    Remove-Item -LiteralPath $ExpectedRoot -Recurse -Force
    Write-Output "Yanyi user data permanently removed from $ExpectedRoot."
  } else {
    Write-Output "Yanyi databases, logs, backups, and settings were preserved. Use -DeleteUserData for a full removal."
  }
}
