# Native Messaging 协议

协议版本为 1。每帧为 32 位小端长度加 UTF-8 JSON，最大 1 MB；stdout 只允许协议帧，诊断写 stderr。信封字段：`protocolVersion`、`requestId`、`type`、`sequence`、`done`、可选 `idempotencyKey` 和 `payload`。

握手、系统错误、取消、翻译、助手、术语、笔记与站点策略消息由 `packages/protocol/schema/envelope.schema.json` 和 TS/Rust 映射共同约束。未知版本返回结构化错误；requestId 负责关联，taskId 负责取消/暂停/恢复，sequence 负责流顺序。

兼容策略：版本 1 内只新增可选 payload 字段和新消息类型；破坏性变化必须升级协议并在握手中明确拒绝旧版本。
