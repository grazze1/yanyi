# ADR-0003：最终专项整改架构

状态：已采纳（2026-08-09）

## 背景

专项审计确认，旧实现以少量块级元素为扫描单位、用附加卡片模拟替换、在首批结束后忽略动态增量，并将解释与追问拆成多个会话。模型能力与模型 ID 也分散在多处。整改必须在协议 v1 和前三个已发布迁移不变的前提下增量完成。

## 决策

1. **以可见 `TextNode` 为事实单元。** 使用 `TreeWalker(SHOW_TEXT)` 扫描完整已渲染文档；视口仅影响优先级。扫描纳入同源 iframe 与开放 Shadow DOM；跨源 iframe、闭合 Shadow DOM 和浏览器内置页面明确计为 `unsupported`。
2. **原位、原子渲染。** 每个节点保存页面会话内稳定 ID、原文快照、内容哈希、DOM role、组件 ID 与分片信息。`replace` 只写原 `Text.nodeValue`；长节点必须在所有分片完成验证后一次提交。`below`/`bilingual` 才创建标记为 `data-yanyi-owned` 的透明附加节点。还原只使用快照。
3. **逻辑页面任务与动态 delta 任务分离。** 一个 `PageTranslationJob` 聚合普通长页的连续 Native Host 批次；每批有独立 task ID 和连续 `batchIndex`。若最终批次已发送，500 ms 防抖后的新 DOM 不能重新打开旧任务，而是以新的 page job ID、`batchIndex=0` 创建 delta job。
4. **完成态由诊断闭包决定。** `ScanDiagnostics` 与节点状态共同记录 discovered、eligible、protected、ignored、queued、completed、failed、stale、overBudget、unsupported、cancelled、notScanned。未翻译原因统一映射为 `ignored | protected | failed | stale | over_budget | unsupported | cancelled | not_scanned`；存在未解释的合格节点时不得报告 `completed`。
5. **统一助手会话。** 选区浮窗与 Side Panel 共用 conversation store、stream reducer、模型控制和唯一发送表单。会话 ID 只在首次询问或显式“新聊天”时变化；短时流任务通过 session handoff 延续，浏览器重启则由 `browser.storage.local` 中的有界活动引用重新从 SQLite 分页加载消息和引用。
6. **回答与引用原子持久化。** 助手回答、模型配置和规范化 citations 在同一数据库事务中写入；引用按 page/workspace/general_knowledge/tool 分类并去重。`message_sources` 保留兼容读取，迁移到 `message_citations` 的旧记录标为 `legacy`。
7. **页面是数据，不是指令。** `KnowledgeMode` 固定为 `hybrid | page_only | general`，默认 `hybrid`。七个受限上下文工具都有 JSON Schema、授权、页面/工作区会话校验和结果上限。`reasoning_content` 只可在同一次工具调用链的内存中回传，不能流向 UI、日志、会话或长期记忆。
8. **模型目录与能力来源分离。** `/models` 只刷新 ID、owner 和可用性；thinking、reasoning effort、tools、JSON 与上下文能力来自受审计 provider adapter、兼容端点扩展元数据或人工配置。未知能力标为未验证。选择优先级为：单次请求 > 会话 > 任务预设 > API Profile 默认；不可用模型明确失败，不跨供应商回退。
9. **数据库只追加升级。** `0004_final_remediation.sql` 新增 page jobs、conversation/message 生命周期字段、contexts、citations、model catalog 与 selection state，并将分类法校准为 8 个顶级学科。v1/v2/v3 数据库升级前先 WAL checkpoint 和 SQLite 备份；失败不得替换原库。
10. **Windows 后台进程与清理边界显式化。** Tauri 与 Native Host 的 release 使用 Windows subsystem；Native Messaging 继续使用继承的 stdin/stdout，后台 `reg.exe` 使用 `CREATE_NO_WINDOW`。清理命令只删除仓库内白名单路径，发布审计拒绝测试、fixture、日志、数据库、报告、环境文件和疑似明文 Key。

## 结果与约束

- 协议仍为 v1，通过可选字段和新增消息类型向后兼容；所有跨边界输入继续执行大小、版本、序列和关联校验。
- 页面模式切换与还原不发起模型请求；迟到结果必须同时匹配 tab、frame、page session、job、node ID 与 source hash。
- `search_current_page` 当前搜索的是捕获并授权的页面上下文包，不代表浏览器完整 DOM 索引；扩大检索范围需要新的显式页面快照协议。
- `componentId` 与 DOM role 已进入分段与提示上下文，但真正的“一个组件一次结构化多 segment provider 请求”尚未成为强制调度单元，见最终交付限制。
