# 网页翻译纵向切片

实现链路：Popup → Background → Content scan → Native Messaging → Native Host task table → DeepSeek-compatible SSE → Background route → Content renderer。

`translation.start` 包含任务、页会话、来源哈希、受保护占位符和模型预设。Host 先发 `translation.accepted`，随后依次发 segment started/delta/completed/failed、progress 和 terminal completed/cancelled/failed。后台 reducer 忽略其他 task、陈旧 sequence 和 late event。

整页翻译固定 `deepseek-v4-flash`、`thinking.type=disabled`；每段一个请求，默认并发 2，最多 160 段和 96,000 字符。429/500/503、超时和早断流有限重试；401/402/400/422 不重试。取消中止排队项与活动流，暂停在当前批次结束后阻止下一批。

本轮不实现术语 CRUD、PDF/OCR、历史/记忆或解释/追问 API。Side Panel 的解释与追问不会被翻译任务自动调用。

真实手工验证：在 Edge 打开任意 http/https 文档后点击扩展 Action 的“翻译此页面”；未配置密钥时会提示设置入口，使用 `scripts\Set-DeepSeekApiKey.ps1` 以 DPAPI 保存密钥。不得将密钥写入 `.env`、源码、日志或聊天。
