param(
  [string]$HostPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'target\release\yanyi-native-host.exe'),
  [string]$Model,
  [switch]$ConfirmBilling
)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmBilling) {
  throw '此烟测会发送一条极小的真实流式请求。确认可能产生费用后，请增加 -ConfirmBilling。'
}
if (-not (Test-Path -LiteralPath $HostPath -PathType Leaf)) {
  throw "找不到 Native Host：$HostPath"
}

$Arguments = @('--test-connection')
if ($Model) { $Arguments += @('--model', $Model) }
$Started = [System.Diagnostics.Stopwatch]::StartNew()
$Result = & $HostPath @Arguments
if ($LASTEXITCODE -ne 0) { throw 'DeepSeek 连接烟测失败；请查看上方安全错误消息。' }
$Started.Stop()
$Parsed = $Result | ConvertFrom-Json
[pscustomobject]@{
  Status = 'passed'
  Model = $Parsed.model
  AvailableModels = ($Parsed.availableModels -join ', ')
  ProviderElapsedMs = $Parsed.elapsedMs
  ScriptElapsedMs = $Started.ElapsedMilliseconds
  PromptTokens = $Parsed.promptTokens
  CompletionTokens = $Parsed.completionTokens
  TotalTokens = $Parsed.totalTokens
  OutputCharacters = $Parsed.outputCharacters
}
