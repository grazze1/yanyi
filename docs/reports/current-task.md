# 当前任务：最终专项整改

日期：2026-08-09

分支：`codex/final-remediation`

安全基线：`46ea556`

## 目标

在现有工程上增量完成以下可验收闭环：

- 可见 `TextNode` 完整扫描、明确未翻译原因、长页续批、动态 delta job 与原位原子渲染；
- 选区浮窗/Side Panel 统一会话、浏览器重启恢复、conversation CRUD 和 citations；
- SQLite v4 append-only 升级、page jobs、模型目录与选择状态、8 顶级学科；
- 三种 KnowledgeMode、七个受限上下文工具与隐藏推理隔离；
- Windows release 后台策略、仓库安全清理、生产 fixture 隔离和发布内容审计；
- 最新工作树的 TypeScript、Rust、Edge、Tauri、迁移、安全、视觉与可访问性回归。

## 已确认事实

1. Edge/Chromium 是首轮唯一浏览器范围。跨源 iframe、闭合 Shadow DOM 和浏览器保护页允许 `unsupported`，但不能静默遗漏。
2. migration 0001-0003 保持不变；0004 追加升级。旧库升级前执行 checkpoint/backup，无法可靠归并的会话保持 legacy。
3. 整页翻译必须连接 Native Host；扩展 UI 可独立显示，但不得偷偷切换供应商或离线翻译。
4. 自动回归使用本地 Mock；真实 DeepSeek 只执行用户授权、显式确认计费的最小 smoke，不显示或记录 Key/正文。
5. 根目录设计图与 `docs/design-assets/00`-`05` 的 Git blob 哈希逐一一致；基线可恢复，根目录副本已 staged 删除。
6. 不 push、不签名、不发布商店、不安装新的系统级依赖。

## 当前实现证据

- 动态首次任务封口后，新增节点用新 page job ID 从 batch 0 开始；普通长页保持原 job 连续批次。
- Side Panel 优先恢复 session handoff；无 handoff 时读取有界活动 conversation 引用，再通过 Native `conversation.get` 分页恢复 SQLite 消息和 citations；显式“新聊天”清除活动 ID。
- 助手回答和规范化 citations 在同一数据库事务中保存；legacy `message_sources` 保持兼容。
- 安装库只读审计：v4、integrity ok、WAL、FK、49 表、8 顶级学科、6 站点规则、8 任务预设。
- 真实 DeepSeek 连接、翻译和助手工具/citation smoke 已通过，公共/持久路径未暴露 reasoning；详细非敏感数字见 `docs/final-delivery-report.md`。
- Node production audit 与 RustSec audit 已执行；后者无 vulnerability、17 条允许 warning。

## 模型事实（2026-08-09 校验）

- 当前官方 `/models` 返回 `deepseek-v4-flash` 与 `deepseek-v4-pro`，但列表只证明 ID、owner 与可用性，不证明完整能力。
- thinking、`high|max`、tools、JSON 等能力来自受审计 DeepSeek adapter；只有 thinking 已启用且能力已验证时才发送 reasoning effort。
- 工具调用中的 `reasoning_content` 只允许在同一调用链内存回传，不进入 UI、日志、会话或记忆。
- 选择优先级：单次请求 > conversation > task preset > API Profile default；不可用模型报错，不跨供应商自动切换。

官方来源：

- <https://api-docs.deepseek.com/api/list-models/>
- <https://api-docs.deepseek.com/guides/thinking_mode/>
- <https://api-docs.deepseek.com/updates/>

## 最终结论与人工边界

- 最新工作树的全量门禁、opt-in live-site E2E、production handshake、Tauri/NSIS build/silent repair、安装版 Host framing 与 release audit 均已通过；结果已更新到 `docs/test-results.md`。
- PE subsystem 与自动进程 smoke 已通过；Edge 原生菜单、跨源 iframe/PDF、瞬时闪窗、可见安装/卸载流程与辅助技术仍需要人工观察。
- popup 逐项模型控制、组件级结构化 provider 批处理和完整 DOM 页面搜索仍是明确差距，不用文档措辞掩盖。
