param(
  [string]$HostPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'target\debug\yanyi-native-host.exe')
)

if (-not (Test-Path -LiteralPath $HostPath)) {
  throw "找不到 Native Host：$HostPath。请先在项目目录构建 native-host。"
}

$secureKey = Read-Host '输入 DeepSeek API Key（不会回显）' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
  $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $plainKey | & $HostPath --configure-stdin
  if ($LASTEXITCODE -ne 0) { throw 'DPAPI 配置未保存。' }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  Remove-Variable plainKey -ErrorAction SilentlyContinue
}
