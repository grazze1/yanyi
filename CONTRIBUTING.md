# 贡献指南

使用 `yanyi-dev` Conda 环境和项目内 Rust/pnpm 缓存。提交前运行 `pnpm lint && pnpm typecheck && pnpm test` 以及 Cargo test/Clippy/rustfmt。新增用户功能必须连接真实状态与 SQLite，并为错误、空、加载、取消和离线状态提供测试。不得提交密钥、数据库、日志或页面正文 fixture。

协议和数据库变化需同步 Schema/migration、TS/Rust 类型、兼容说明和测试。默认不要修改固定扩展 ID；发布 ID 变化必须同步两个 Native Host manifest allowlist。
