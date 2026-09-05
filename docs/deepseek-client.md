# DeepSeek-compatible 客户端

客户端支持可配置 Base URL、HTTPS 代理、首 token/总超时、并发和重试，拒绝非 HTTPS 远程地址与重定向；loopback 仅用于本地 Mock。`GET /models` 响应和 SSE 缓冲均有大小上限。

任务模型来自 SQLite `task_presets`，业务协议不永久写死供应商模型。错误映射覆盖缺配置、401、402、429、超时、provider、流提前结束、非法 SSE 和响应过大。日志永不包含 Key、页面正文或完整译文。
