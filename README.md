# 研译（Yanyi）

[![CI](https://github.com/grazze1/yanyi/actions/workflows/ci.yml/badge.svg)](https://github.com/grazze1/yanyi/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

面向英文技术文档与论文的本地优先翻译工具。仓库同时包含 Edge/Chrome MV3 扩展、Tauri 2 桌面管理端、Rust Native Messaging Host 与 SQLite 数据层。

## 已交付能力

- 整页分段翻译、原文/译文/原文下方/双语模式、暂停/继续/取消、缓存和任务持久化。
- 代码、公式、URL、路径、引用与占位符保护；站点规则控制正文范围和动态内容。
- 选区翻译、解释、追问、术语快捷保存、笔记与本地历史。
- 术语库、候选术语、工作区、确认式长期记忆、网站规则和诊断管理端。
- PDF.js 文本 PDF 阅读器：本地/URL、文本层、搜索、缩放、翻译、选区解释和阅读位置恢复。
- 独立 Edge/Chrome 构建与 Native Host allowlist；Windows NSIS 安装器。

## 快速开始

1. 进入隔离环境：`powershell -ExecutionPolicy Bypass -File .\scripts\Enter-YanyiDev.ps1`。
2. 安装依赖：`pnpm install --frozen-lockfile`。
3. 构建：`pnpm build`。
4. 在 `edge://extensions` 或 `chrome://extensions` 开启开发者模式，加载对应 `.output/*-mv3` 目录。
5. 以普通用户运行 `scripts\Install-NativeHost.ps1` 注册 Native Host。
6. 在桌面端“模型与 API”安全保存配置，或运行 `scripts\Set-DeepSeekApiKey.ps1`。

完整说明见 [用户手册](docs/user-guide.md)、[开发架构](docs/architecture.md)、[测试](docs/testing.md) 与 [发布](docs/release.md)。

## 隐私边界

API Key 仅在 Native Host 中由 Windows DPAPI 保护；扩展上下文不持有明文密钥。页面正文不会写入普通日志，诊断导出默认脱敏。真实 API 烟测必须显式增加 `-ConfirmBilling`。

## 许可证

本项目采用 [Apache License 2.0](LICENSE)。第三方组件及其许可证见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
