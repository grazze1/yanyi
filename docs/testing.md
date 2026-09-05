# 测试指南

必跑门禁：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、两项 Native Host 脚本、`cargo test --workspace`、Clippy `-D warnings`、rustfmt check 和 Playwright。

Fixture E2E 不依赖注册表，覆盖 popup 状态和截图；生产 E2E 需要先注册 Host。真实供应商 smoke 默认禁用，必须显式 `Test-DeepSeekConnection.ps1 -ConfirmBilling`。

测试结果以 `docs/test-results.md` 为唯一最新记录；未运行的真实网站、真实 API、安装/卸载和 GUI 项不得标记通过。
