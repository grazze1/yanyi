# ADR-0002：全量产品的本地服务与配置边界

状态：已采纳（2026-08-04）

## 背景

第二阶段只实现了网页翻译纵向切片。模型名散落在 TypeScript、JSON Schema 与 Rust 中，桌面端没有业务 CRUD，扩展也不能访问术语、工作区、历史和可恢复任务。后续功能必须在不泄露 API Key、不让网页内容直接调用本地能力、不破坏协议 v1 握手兼容性的前提下增量实现。

## 决策

1. SQLite 是配置和业务数据的唯一事实源；`0001_initial.sql` 保持不变，后续只追加迁移。
2. Native Host 是扩展访问数据库、模型供应商和文件能力的唯一边界。扩展只持有短期页面状态和不含正文的任务路由元数据。
3. 模型 ID 是经 `/models` 验证的普通字符串；内置值只作为可编辑种子。`thinking.type` 只允许 `enabled|disabled`，`reasoning_effort` 独立为 `high|max`。
4. API Key 仅由桌面端或安全 PowerShell 工具写入 DPAPI 密文。扩展 Options 只能读取“已配置/掩码”状态和编辑非秘密参数。
5. 协议保持 `protocolVersion: 1`，以新增消息类型向后兼容扩展能力；未知消息仍返回结构化错误。
6. 术语、网站规则、工作区、会话、记忆、缓存与 PDF 元数据均通过领域服务和数据库仓储访问，不在生产 UI 中使用 fixture 数据。
7. Edge 与 Chrome 共用 WXT 源码，但使用不同的固定开发扩展 ID和各自最小化 Native Host allowlist。

## 安全影响

- 自定义 Base URL 默认必须为 HTTPS；loopback 仅开发模式，显式信任的自定义地址仍不能绕过响应大小、重定向和超时限制。
- 网页正文始终标记为不可信数据；模型生成的引用、工具名、selector 和文件路径均需本地验证。
- 导入、导出和 PDF 文件先 canonicalize，并限制大小；诊断报告默认不包含正文、译文、完整 URL query 或密钥。

## 兼容性

旧数据库从 schema v1 迁移到 v2；原有表和数据不重建。旧 `translation.start` 消息继续有效，缺省任务预设映射为数据库内置预设。
