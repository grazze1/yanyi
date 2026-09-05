# GitHub 公开发布审计（2026-09-05）

## 结论

当前源码树在完成下述整改与门禁后可以作为 Apache-2.0 项目公开。远端采用独立单根
`main` 提交，避免公开本地早期提交中已经删除的机器路径和临时文件名；本地历史保持不变。

## 本轮整改

- 增加标准 Apache License 2.0 `LICENSE` 与 `NOTICE`，将 Cargo workspace 和所有 npm
  workspace 标记为 `Apache-2.0`，更新 README 与许可证决策记录。
- 清除当前树中的用户名、个人绝对路径、个人邮箱、外部明文 Key 文件名和疑似真实掩码尾号。
- 删除根目录失效的重复设计文档；正式规范保留在 `docs/界面设计文档.md`，六张设计资产
  保留在 `docs/design-assets/`。
- PowerShell 环境脚本通过 Conda 与 `vswhere` 自动发现工具；Git Bash 脚本不再硬编码
  Anaconda 安装位置。
- GitHub Actions 增加 `contents: read` 最小权限、禁用 checkout 凭据持久化，并把所有
  Action 固定到不可变 commit；增加 npm、Cargo 与 Actions 的 Dependabot 周更配置。
- 修复干净 CI 的产物依赖：先构建 Chrome，再审计本次生成的三个前端目录；完整
  Windows 发布脚本仍包含 Native Host 资源审计。
- 将锁文件中的已撤回 `chacha20 0.10.1` 更新为 `0.10.2`；它来自未启用的可选依赖分支，
  更新后 `cargo audit` 不再报告 yanked package。

## 验证结果

| 门禁                                                 | 结果                                                   |
| ---------------------------------------------------- | ------------------------------------------------------ |
| `pnpm format:check` / `pnpm lint` / `pnpm typecheck` | 通过                                                   |
| `pnpm test`                                          | 27 files / 167 tests 通过                              |
| `cargo fmt` / `cargo clippy -- -D warnings`          | 通过                                                   |
| `cargo test --workspace`                             | 100 tests 通过                                         |
| Edge 与 Chrome production build                      | 通过                                                   |
| Native Host handshake / translation / error matrix   | 通过                                                   |
| Playwright                                           | 4 passed / 6 opt-in skipped                            |
| `pnpm audit --prod --audit-level high`               | 0 个已知漏洞                                           |
| `cargo audit`                                        | 0 vulnerability；16 unmaintained、1 unsound 维护性警告 |
| 发布树敏感信息扫描                                   | 0 密钥、0 私钥、0 凭据 URL、0 个人路径/邮箱            |
| Markdown 本地链接                                    | 0 个失效链接                                           |
| Git 对象大小                                         | 最大约 1.49 MB，无需 Git LFS                           |

`glib 0.18.5` 的 unsound 警告只存在于 Tauri 的非 Windows GTK 依赖图，当前 Windows
构建不包含该路径；16 个 unmaintained 警告同样主要来自非 Windows GUI 依赖。仍应由
Dependabot 跟随 Tauri 上游升级。

## 公开发布边界

仓库已发布到 [grazze1/yanyi](https://github.com/grazze1/yanyi)，可见性为 PUBLIC，
默认分支为 `main`。GitHub 已识别 Apache-2.0，并启用私密漏洞报告。首次 Windows CI
已启动；远端运行结果以 [Actions](https://github.com/grazze1/yanyi/actions) 为准，
上表记录的是本地执行结果。

发布后的文档修订以普通后续提交追加，公开历史从经审计的根提交开始。

- 不上传 `.devtools`、Conda、pnpm store、`node_modules`、`target`、WXT 输出、日志、
  SQLite 数据库、API Key 或用户会话；这些路径均在 `.gitignore` 或发布审计中受保护。
- 仓库公开不等于安装器已签名或浏览器商店已发布。Windows 代码签名、Edge/Chrome 商店
  审核、真实辅助技术与可见安装/卸载仍属于后续人工发布门禁。
- 真实 DeepSeek 计费 smoke 不在本次公开发布中重复执行；现有 DPAPI 配置和外部明文
  Key 文件均不进入源码树。
