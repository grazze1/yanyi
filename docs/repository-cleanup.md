# 仓库清理与发布边界

## 最终加固（2026-08-09）

- `clean-workspace.mjs` 在词法工作区检查之外，会解析真实路径并逐级拒绝 symlink/Windows junction；即使 `target` 等中间目录被联接到仓库外，也不会继续递归删除。
- `Test-ReleaseContents.ps1` 必须同时找到并检查 `apps/desktop/dist`、桌面 resources、Edge production 与 Chrome production 输出；缺少任何 root 都会失败。
- `Build-WindowsRelease.ps1` 在内容审计前显式构建桌面前端，因此审计针对的是即将进入 Tauri/NSIS 的最新 dist，而不是旧产物或空目录。
- 当前四个 release root 的自动审计通过；缺失 root 的负向测试返回非零退出码。

更新时间：2026-08-09。

## 安全清理命令

| 命令                   | 仓库内白名单目标                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm clean:artifacts` | `apps/desktop/dist`、`apps/edge-extension/.output`、`.wxt`、`coverage`、`target/debug`、`target/release` |
| `pnpm clean:test-data` | `.playwright-profile`、`playwright-report`、`test-results`、`.test-data`                                 |
| `pnpm clean`           | 上述两组目标                                                                                             |

`scripts/clean-workspace.mjs` 从脚本位置解析仓库根目录，拒绝绝对路径、根目录本身、目录穿越和未知 mode。它不会访问 `%LOCALAPPDATA%\Yanyi`，因此不会删除 API 配置、会话、术语、工作区、日志、备份或用户数据库。

## 发布内容审计

`pnpm test:release-contents` 默认检查桌面 resources 与 Edge/Chrome production 输出，并拒绝：

- `*.test.*`、`*.spec.*`、数据库/WAL/SHM、日志、Markdown、`.env*`；
- 路径中的 fixture、Playwright、coverage、test-results、`target\debug`；
- 文本产物中的 `createFixturePopupAdapter`、`popupFixtures`、`@yanyi/test-fixtures` 和疑似 `sk-...` 明文 Key。

审计 root 必须位于仓库内。生产 popup 已改为真实 adapter；fixture adapter 仅在开发/测试环境且 URL 明确要求 `fixture` 时动态导入，`@yanyi/test-fixtures` 只属于 devDependency。最终 production roots 与 Edge/Chrome ZIP 深度审计均已通过，结果记录在 `docs/test-results.md`。

## 设计资产去重

六张根目录原图与 `docs/design-assets/00`–`05` 的 Git blob 哈希逐一一致。安全基线 `46ea556` 保留可恢复副本后，根目录重复文件已删除并纳入本轮交付；正式命名资产及当前验收截图保留。

## Git 与保留内容

- 当前工作分支为 `codex/final-remediation`，不再错误报告为 `main`；没有 push。
- 源码、测试、migrations、脚本、文档、`AGENT.md`、Skills lock、锁文件、许可证、正式设计资产和批准截图必须保留。
- clean 不等于卸载；用户数据删除只能通过精确的卸载流程和显式用户选择完成。
