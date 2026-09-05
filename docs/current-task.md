# 当前任务：公开 GitHub 发布

> 日期：2026-09-05
>
> 本地工作分支：`codex/final-remediation`
>
> 目标仓库：`grazze1/yanyi`，默认分支 `main`

## 用户已确认

- 仓库公开可见。
- 项目采用 Apache License 2.0。
- 当前规范文档与 `docs/design-assets` 设计资产随项目一并公开。

## 发布策略

当前本地历史包含早期机器路径和已失效的临时验收记录。为避免把这些历史内容公开，远端
`main` 使用经审计的当前源码树创建单一根提交；本地 `codex/final-remediation` 历史完整
保留，不做 rebase、force push 或历史删除。

## 发布前门禁

- [x] Prettier、ESLint、strict TypeScript。
- [x] Vitest 27 files / 167 tests。
- [x] Cargo fmt、Clippy `-D warnings`、Cargo 100 tests。
- [x] Edge/Chrome production build、Native Host 三组协议脚本。
- [x] Playwright 4 passed / 6 opt-in skipped。
- [x] `pnpm audit --prod --audit-level high`：0 个已知漏洞。
- [x] `cargo audit`：0 个 vulnerability；维护性警告单独记录。
- [x] 当前发布树密钥、凭据 URL、个人路径、个人邮箱、数据库、日志和私钥扫描。
- [x] Apache-2.0 LICENSE、Cargo/npm SPDX 元数据、README、第三方声明。
- [x] GitHub Actions 最小权限与不可变 commit 固定；Dependabot 配置。
- [ ] 创建公开仓库、推送 `main`、检查远端文件树和 CI。

完整审计结论见 `docs/reports/publication-audit-2026-09-05.md`。
