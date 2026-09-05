# 全量测试结果

## 2026-08-09 浏览器交互、会话与全局记忆重构增补

本节优先于下方较早快照。环境：`source scripts/yanyi-env.sh`
（Node 24.18.0 + pnpm 11.19.0 来自 conda `yanyi-dev`，Rust 1.97.1 来自项目内 `.devtools`）。

| 命令                                                    | 结果                                        | 覆盖范围                                                              |
| ------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                        | 通过                                        | 9 个 workspace，锁文件无漂移，未新增依赖                              |
| `pnpm lint`                                             | 通过                                        | ESLint 0 error / 0 warning                                            |
| `pnpm typecheck`                                        | 通过                                        | 根配置 + 8 个 workspace 严格类型检查                                  |
| `pnpm test`                                             | 通过；27 files / 167 tests（基线 23 / 114） | 事件路由、侧边栏手势、浮窗几何、模型能力、站点作用域、桌面记忆 API    |
| `pnpm build`                                            | 通过                                        | Desktop Vite + Edge MV3 production                                    |
| `cargo fmt --all -- --check`                            | 通过                                        | —                                                                     |
| `cargo clippy --workspace --all-targets -- -D warnings` | 通过                                        | —                                                                     |
| `cargo test --workspace`                                | 通过；100 tests（基线 68）                  | 迁移 v1–v4 升级、站点作用域、全局记忆、导入、快照、Host 能力与 Prompt |
| `pnpm test:native-host`                                 | 通过                                        | 长度帧与握手                                                          |
| `pnpm test:native-host:translation`                     | 通过                                        | 翻译/助手 Mock SSE                                                    |
| `pnpm test:native-host:errors`                          | 通过                                        | 401/402/429/500/503 脱敏映射                                          |
| `pnpm test:e2e`                                         | 通过；4 passed / 6 skipped                  | 浮窗真实拖动、Popup 管理端按钮已删除、扫描报告、TextNode 覆盖         |

跳过的 6 项 E2E 需要已安装 Native Host 或外网（生产 Edge 握手、Native 翻译管线、
stale ACK、GitHub、PyTorch、Chrome 自动加载）。本轮改动不涉及这些路径的实现，
且三组 Native Host 脚本已单独覆盖 Host 侧行为。

### 本轮新增测试

| 文件                                                           | 数量 | 断言要点                                                                                                                                    |
| -------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `assistantEventRouting.test.ts`                                | 10   | 事件同时送达扩展页面与来源 tab；Side Panel 场景用 context tab；生命周期映射；终态识别                                                       |
| `openSidePanel.test.ts`                                        | 7    | 直接调用保留手势；受限页面/无窗口/需重试各自给出原因；content script 兜底                                                                   |
| `popoverPosition.test.ts`                                      | 15   | 锚定翻转、视口夹取、窄视口收缩、拖动位移、拖动起点无关、已拖动后滚动不移动、恢复锚定、缩放后重新夹取                                        |
| `modelCapability.test.ts`                                      | 14   | 四态判定、未验证可选、仅 unavailable 阻断、unknown 与 unsupported 区分、强度可见性                                                          |
| `crates/database/tests/site_scope_and_memory.rs`               | 9    | 同源 5 次询问 = 1 会话、新聊天 = 2 会话、跨站不共享、归档不复用、记忆 CRUD 与去重、相关性检索、快照确定性、导入需确认、重复不写入、放弃导入 |
| `global_memory.rs` / `memory_import.rs` / `site_scope.rs` 单测 | 15   | origin 解析、内容归一化、术语规则识别、FTS 转义、指纹确定性、三种格式解析与限制                                                             |
| `native-host` 新增单测                                         | 7    | 安全默认参数四分支、稳定前缀确定性与无易变值、空库不污染 Prompt、检索块位置、检索查询构成                                                   |
| `desktopApi.test.ts` 新增                                      | 3    | 记忆 CRUD 命令、导入两步确认、快照与导出                                                                                                    |
| E2E 扩充                                                       | —    | 浮窗真实鼠标拖动 + 恢复锚定 + 拖动后可输入 + 滚动不移动；Popup 四个管理端按钮为 0 且溢出菜单可用                                            |

### 迁移验证

- `migrates_an_empty_database_with_wal_foreign_keys_and_fts5`：schema 版本 5，≥47 张表，`global_memories_fts` 插入/更新/删除三态同步。
- `upgrades_every_released_schema_with_backup_and_without_data_loss`：v1→v5、v2→v5、v3→v5、v4→v5 四条路径，每条都创建备份、保留 legacy workspace/conversation/message/source，并断言 v5 新表齐全、legacy 会话未被并入任何站点作用域。
- `migrations_are_safe_to_run_again`：重复运行不报错。
- 历史迁移未被修改；本轮只新增 `0005_site_scope_and_global_memory.sql`。

### 未执行

- `Build-WindowsRelease.ps1` 与 `pnpm test:release-contents`：本轮未产出新的发布包，沿用上一轮结论。
- 真实付费 API 调用：未执行。能力验证功能实现完成，但未对真实 Provider 触发计费请求。
- Tauri debug/release 实机启动：未执行（桌面 Rust 侧已通过 `cargo build` 与 `cargo clippy`，前端已通过 typecheck 与 Vite build）。

---

## 2026-08-09 上一轮快照

执行日期：2026-08-09（Asia/Shanghai）。以下结果来自 `codex/final-remediation` 上一轮工作树。

## 自动化回归

| 检查                                                    | 最终结果                                                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                        | 通过；9 个 workspace，锁文件无漂移                                                                  |
| `pnpm format:check`                                     | 通过；Prettier 无差异                                                                               |
| `pnpm lint`                                             | 通过；ESLint 0 error / 0 warning                                                                    |
| `pnpm typecheck`                                        | 通过；根配置与 8 个 workspace 严格类型检查                                                          |
| `pnpm test`                                             | 通过；23 files / 114 tests                                                                          |
| `pnpm build`                                            | 通过；Desktop Vite 与 Edge MV3 production                                                           |
| `cargo fmt --all -- --check`                            | 通过                                                                                                |
| `cargo test --workspace`                                | 通过；68 tests，另有 0-test binary/doc targets                                                      |
| `cargo clippy --workspace --all-targets -- -D warnings` | 通过                                                                                                |
| `pnpm test:native-host`                                 | 通过；长度帧与握手                                                                                  |
| `pnpm test:native-host:translation`                     | 通过；翻译/助手 Mock SSE、usage、暂停/继续/取消                                                     |
| `pnpm test:native-host:errors`                          | 通过；401/402/429/500/503 脱敏映射                                                                  |
| 完整 Playwright opt-in                                  | 9 passed / 1 skipped；生产 Edge、fixture UI、TextNode 覆盖、Native 翻译、stale ACK、GitHub、PyTorch |
| `Build-WindowsRelease.ps1 -SkipTests`                   | 通过；273.6 秒，Host + Edge + Chrome + Tauri + NSIS                                                 |
| `pnpm test:release-contents`                            | 通过；Desktop、resources、Edge、Chrome 均存在且内容合规                                             |
| Edge/Chrome ZIP 深度审计                                | 通过；无 fixture、测试、日志、数据库、Markdown、环境文件、疑似 Key 或 `reasoning_content`           |

Chrome branded 137+ 已移除自动化 `--load-extension` 支持，因此 Chrome fixture 自动加载用例按设计跳过；Chrome production 构建与 ZIP 已完成，最终人工加载仍需在开发者模式进行。

## 关键集成结论

- 生产 Edge 扩展与安装版 Native Host 握手通过。
- 真实 GitHub 与 PyTorch Documentation 页面完成脚本注入、翻译、动态 TextNode 续译和还原。
- 最终批次后新增节点创建独立 delta page job；变化中的 TextNode 拒绝旧模型结果，旧结果不落 DOM、不进入恢复缓存，新快照随后重新翻译。
- 选区 launch token 只消费一次；浮窗成功不遗留 Side Panel 自动提示，手动重开不会覆盖 SQLite 恢复的会话上下文。
- 2 MiB 助手回答不会在 terminal frame 重复完整正文；小回答保持兼容，Native Messaging 单帧仍低于 1 MiB。
- 真实 DeepSeek `/models`、最小翻译和助手工具链 smoke 通过；凭据仅从 DPAPI 配置读取，未记录或输出明文 Key、Prompt、选区或回答正文。

## 数据库与测试隔离

- 安装库审计：SQLite v4、49 张表、WAL、`foreign_keys=1`、FTS5、8 个顶级学科、6 条内置站点规则，`integrity_check=ok`。
- 浏览器 E2E 的每个 Native Host 使用独立 `test-results/native-e2e/*` 数据目录。隔离复验前后，真实数据库的 SHA-256、大小和修改时间完全一致。
- 旧 E2E Mock 数据已先做 WAL 一致性备份，再按固定 Mock 译文与页面会话精确清理：29 个测试 session、36 个 task、1019 个 segment、16 个 page job、272 条 cache；真实任务和缓存保留。
- 清理前备份：`%LOCALAPPDATA%\Yanyi\backups\yanyi.db.pre-e2e-cleanup-20260809-114316.db`。

## 安全、供应链与 Windows

| 检查                                   | 结果                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm audit --prod --audit-level high` | 0 个已知漏洞                                                                              |
| `pnpm licenses list --prod`            | 通过                                                                                      |
| `cargo audit --json`                   | 0 vulnerability；17 条维护性/unsound warning 已记录于安全报告                             |
| 凭证扫描                               | tracked/untracked 源码与 production 输出无疑似明文 API Key                                |
| PE subsystem                           | Desktop 与 Native Host 均为 `Windows GUI`（subsystem 2）                                  |
| 安装版 Host framing                    | 通过；`system.handshake.ready`，协议 v1                                                   |
| Tauri installed smoke                  | 进程存活、主窗口创建、响应正常                                                            |
| NSIS silent install / repair           | 连续两次 exit 0；数据库与 DPAPI 配置保留                                                  |
| Host 注册                              | Edge/Chrome HKCU manifest 均存在，allowed origin 固定，安装 Host 哈希与 release Host 一致 |

## 最终产物哈希

| 产物                                                  |       字节 | SHA-256                                                            |
| ----------------------------------------------------- | ---------: | ------------------------------------------------------------------ |
| `target/release/yanyi-desktop.exe`                    | 16,272,896 | `F8080ED5285EA8B9F28A8E21C6EF5896E3C71F08E7409D693B35445D8D1509CA` |
| `target/release/yanyi-native-host.exe`                |  8,789,504 | `740DCB596151C78085F2C2834ECC9B5C95F0DA3F9696FA4484E8D85C6FD06033` |
| `target/release/bundle/nsis/研译_0.1.0_x64-setup.exe` |  7,485,125 | `85A48B701C1B8CC698E4BAB94E33B357629FDE59116C93045F80237C45EA098E` |
| Edge ZIP                                              |    714,108 | `A86C508593B227A78DA36C96C411EBC81D162626AACD5024DB45DB9ED3851FB9` |
| Chrome ZIP                                            |    714,107 | `162C2AE0612DA1D03664D2550D9118C3710F6268DEE40FAC3BF83A66D384479A` |

## 尚需人工验收

- Edge 原生右键菜单三种命令、跨源 iframe、内置 PDF，以及浮窗展开到 Side Panel 的同一流任务连续性。
- Windows 125%/150%/200%、Narrator、高对比度、纯键盘和中文 IME 的现场走查。
- NSIS 可见界面的全新安装与卸载路径；默认保留数据和显式完全删除数据需人工确认。
- Chrome 开发者模式人工加载、代码签名、商店发布和自动更新信任链。

Playwright 验收截图位于 `docs/screenshots/`；UI 评审见 `docs/ui-review-popup.md`。
