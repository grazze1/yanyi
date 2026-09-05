# 研译开发进度

快照日期：2026-08-09；工作分支：`codex/final-remediation`；安全基线：`46ea556`。

## 本轮（浏览器交互、会话与全局记忆重构）新增

- **修复浮窗永久“正在读取当前上下文…”**：service worker 的 `runtime.sendMessage` 不会到达 content script；assistant 事件现按 task 来源同时投递到扩展页面与来源 tab/frame。
- **修复“打开侧边栏”无效**：`sidePanel.open()` 需要用户手势，改由 Popup 在自身 click handler 内直接调用；失败时给出受限页面 / 无窗口 / 需重试的明确原因。
- **模型不再被永久锁死**：四态语义 verified / unverified / unsupported / unavailable；未验证可选并使用安全默认参数；新增用户主动的一次最小能力验证；仅禁用确认不支持的能力。
- **同站点复用同一会话**：`site_scope = URL origin`；每个 origin 一个 active conversation；只有“新聊天”创建新会话；每条消息保存自己的页面上下文。
- **浮窗可拖动**：header 拖拽手柄、anchored / manual 双模式、viewport 夹取、恢复锚定、compact / expanded。
- **“解释”并入“询问研译”**：右键菜单收敛为翻译 / 询问研译 / 添加到术语库；解释成为浮窗快捷意图，复用同一 chat pipeline。
- **全局记忆成为正式功能**：`global_memories` 七种类型、标签、FTS5、真实 CRUD、启用禁用、固定、搜索、导入（TXT/MD/JSON，需逐条确认）、导出、使用统计。
- **Prompt 缓存策略**：版本化稳定前缀快照（不含 timestamp / 随机 ID / 使用计数），相关性检索只注入少量记忆，避免整库注入反而增加 token。
- **Popup 职责收敛**：删除底部术语库 / 工作区 / 历史 / 设置四个大按钮，改为 `⋯` 溢出菜单。
- **迁移 0005**：schema 版本 4 → 5，站点作用域 + 全局记忆 + 快照；v1–v4 四条升级路径均通过备份与无数据丢失断言。

测试：Vitest 27 files / 167 tests（基线 114）、Rust 100 tests（基线 68）、
Playwright 4 passed / 6 skipped、Native Host 三组脚本通过。详见 `docs/test-results.md`。

新增文档：`browser-interaction-audit.md`、`browser-chat-event-flow.md`、
`conversation-session-model.md`、`model-capabilities.md`、`global-memory.md`、
`memory-import.md`、`prompt-cache-strategy.md`、`browser-app-boundary.md`、
`ui-review-browser.md`。

## 已落地

- Conda `yanyi-dev`、项目内 Rust/Cargo/pnpm 缓存隔离，以及 pnpm/Cargo workspace。
- Edge/Chrome MV3 扩展、Tauri 2 桌面端、Rust Native Host、SQLite v4/FTS5/WAL/DPAPI 与 NSIS 构建链。
- 可见 `TextNode` 全文扫描，覆盖短标签、按钮、链接、表格、同源 iframe 和开放 Shadow DOM；代码、公式、URL、路径、编辑区、隐藏节点与扩展节点受保护。
- `replace` 原 `nodeValue` 原子提交、`below`/`bilingual` 附加渲染、快照还原、500 ms 动态重扫、SPA 页面会话隔离、长页续批及动态 delta page job。
- 页面任务/批次持久化、完整扫描诊断、失败/陈旧/预算/不支持原因闭包，以及完成态数据库聚合。
- 选区上下文缓存、Shadow DOM 浮窗、Side Panel 统一多轮会话、停止/重试/编辑重发/复制/笔记/术语操作、安全 Markdown 与引用展示。
- 活动会话重启恢复：扩展只保存有界活动引用，消息与 citations 从 SQLite 分页恢复；“新聊天”清除旧会话引用。
- `hybrid | page_only | general`、七个受限上下文工具、工具调用链内临时 reasoning、页面/工作区来源区分。
- migration `0004_final_remediation.sql`：会话生命周期、消息生成状态、contexts、citations、model catalog/selection、page jobs，并将顶级学科校准为 8 类。
- `/models` 目录刷新、受审计能力元数据、任务/会话选择优先级；浮窗、Side Panel 和桌面端具备详细模型控制。
- Windows release subsystem、后台注册 `CREATE_NO_WINDOW`、脱敏轮转日志、安全 clean 命令和发布内容审计。
- 生产 popup 不再静态依赖测试 fixture；fixture adapter 仅在开发/测试查询参数下动态加载，依赖已降为 devDependency。

## 已取得的独立证据

- 安装库只读审计：`integrity=ok`、`user_version=4`、`journal_mode=wal`、`foreign_keys=1`、49 张表、8 个顶级学科、6 条内置站点规则、8 个任务预设。
- 真实 DeepSeek 最小连接 smoke：`deepseek-v4-flash` 的 `/models` 与最小请求通过，耗时 761 ms、总计 18 tokens。
- 真实翻译 smoke：输出 34 个字符、占位符保持、协议输出不含明文 Key；真实助手 smoke 使用 Pro/High/page_only 与受限工具，保存同一 conversation，公开返回 1 条引用、SQLite 恢复 2 条引用，未暴露 reasoning。
- `pnpm audit --prod --audit-level high` 未发现已知生产依赖漏洞；`cargo-audit 0.22.2` 扫描 528 个锁定 crate 未发现 vulnerability，报告 17 条允许的维护性/unsound warning。
- Edge/Chrome 生产构建、ZIP、Tauri release、Native Host release 与 NSIS 产物已最终生成；NSIS silent install/repair 连续两次通过，安装 Host 与 release Host 哈希一致。
- 最终门禁通过：Vitest 23 files / 114 tests，Rust 68 tests，Playwright 9 passed / 1 skipped；真实 GitHub/PyTorch、production handshake、Native 翻译与 stale ACK 均通过。
- E2E Native 数据目录已强制隔离；真实 SQLite 在完整 opt-in 回归前后哈希、大小和修改时间一致。旧 Mock 记录已备份后精确清理，`integrity_check=ok`。

## 最终自动回归

Prettier、ESLint、strict TypeScript、Vitest、Cargo fmt/test/Clippy、Native Host 三组脚本、Edge fixture/production/native/live-site E2E、Tauri/NSIS、release-content 与 ZIP 深度审计均通过。唯一自动跳过项是 branded Chrome 137+ 不再接受 `--load-extension`；Chrome 构建产物仍已完成。完整命令与哈希见 `docs/test-results.md`。

## 仍需人工或外部条件

- 在真实 Edge 原生右键菜单中分别验证普通页面、同源/跨源 iframe 与内置 PDF 的“翻译/解释/询问”。
- 以 Windows 125%/150% 缩放、Narrator、高对比度和键盘完整走查浮窗、Side Panel、popup 与桌面端。
- PE header 与自动进程 smoke 已确认 Desktop/Host 为 Windows GUI 且无控制台窗口；仍需肉眼观察安装/注册是否瞬时闪窗，并人工执行可见界面的全新安装、保留数据卸载和完全删除数据卸载。
- 代码签名、商店发布、商店 ID 固化与自动更新信任链未获授权，不在本轮执行。

## 已知产品边界

- 跨源 iframe、闭合 Shadow DOM、`edge://`/商店页等浏览器保护页面不可注入，必须显示 `unsupported`；Edge 内置 PDF 首轮只承诺选区翻译/解释/追问。
- popup 当前提供任务型模型预设；Provider/模型/thinking/effort 的完整控制位于选区浮窗、Side Panel 与桌面端。若严格要求 popup 也逐项选择，仍需补一层紧凑控制。
- 组件 ID、页面 profile 与 DOM-role 规则已参与翻译，但 provider 调度仍以 segment 为基本请求；结构化组件批量输出尚未全面替换该路径。
- `search_current_page` 只检索当前授权上下文包；不是整页长期索引。
- TBX 只有数据模型预留；OCR 默认禁用且未绑定大型本地引擎。
