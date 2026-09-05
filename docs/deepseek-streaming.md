# DeepSeek 流式实现

已核验官方 Chat Completions 文档：请求为 `POST https://api.deepseek.com/chat/completions`，整页翻译使用 `deepseek-v4-flash`、`thinking: { type: "disabled" }`、`stream: true` 和 `stream_options: { include_usage: true }`。`[DONE]` 是正常结束标记，usage 在结束前独立 chunk 返回。

`deepseek-client` 的增量解析器处理 split UTF-8、CRLF、keepalive、多 event、usage、非法 JSON、超时和缺少 `[DONE]`。请求与输出不会写日志；错误仅映射为可行动中文状态。

本地 Mock 也是 HTTP/SSE `chat/completions` 端点，保证测试不触达 DeepSeek 或产生费用。实际模型列表仍可由已配置的客户端 `GET /models` 验证。

参考：[DeepSeek Create Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion)，[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)。
