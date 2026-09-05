# 最终专项整改：集成验收记录

快照日期：2026-08-09。本文记录跨层证据；最终命令、数量与哈希以 `docs/test-results.md` 为准。

## 1. 扩展扫描到页面任务

- scanner 使用 `TreeWalker(SHOW_TEXT)`，覆盖短 UI 文本、链接、表格、同源 iframe 和开放 Shadow DOM；MAIN-world hook 能发现初扫后创建的 open ShadowRoot。
- 选择 fallback 统一 content-frame context 与 Edge `selectionText`；保留 tab/frame/capturedAt/domain/tags/contextHash。无可定位 Range 时只降级到 Side Panel，不伪造浮窗锚点；PDF URL 明确标记 `isPdf`。
- 动态 DOM 至少 500 ms 防抖。旧 node hash 的迟到译文记 `stale`，不覆盖新原文；扩展自有节点不触发循环。
- 普通长页批次在视口优先级变化后通过已排队 segment ID 排除继续，不依赖不稳定数组下标。
- 新增 page-job lifecycle：旧 job 已发送 final batch 后，晚到 mutation 生成新的 delta page job/batch 0；未封口的普通续批保持原 job/batch+1。

## 2. Native/数据库闭环

- 协议/schema/TypeScript/Rust 对 page job、batch、scan diagnostics、conversation CRUD、model catalog/selection 保持映射。
- Native scan report 写入失败会返回 `scan_report_segment_write_failed`；诊断中的其他 batch ID 不会被错误当成当前批次失败。
- migration 0004 创建 page jobs、message contexts/citations、model catalog/selection，并追加 conversation/message 字段。旧 schema 先 backup 再升级，`message_sources` 复制为 legacy citations。
- 安装库只读审计：`integrity=ok`、v4、WAL、FK、49 表、8 顶级学科、6 内置规则、8 任务预设。
- task emitter 的 sequence 分配已收口到任务级互斥；并发 delta 与终态不会重复或倒退。

## 3. 统一助手与恢复

- SelectionPopover 与 Side Panel 共用 `ConversationProvider`/Zustand store/stream reducer/ModelControls/安全 Markdown/单一 form。
- Enter、Shift+Enter、IME composing、空输入、停止、重试、编辑重发、复制、笔记、术语和引用路径共用一致状态机。
- 活动流使用 10 分钟有界 session handoff；浏览器重启后读取有界 active reference，再以 `conversation.get` 每页最多 200 条、总计有界的方式恢复 SQLite 消息和 citations。
- 新聊天清除 conversation ID；后续轮次携带同一 ID。回答与 citations 事务写入，恢复时 pending/streaming 消息被标为可重试中断态。
- 真实助手 smoke 使用受限 `get_selection_context`，公开 citation 与 SQLite 恢复 citation 均存在，`reasoning_content` 未进入任何公开或持久对象。

## 4. 模型与上下文

- 七个工具具备 JSON Schema、8 KiB 参数上限、128 KiB 结果上限、32 citation 上限、query/page/workspace 身份校验和最多 4 轮调用。
- `hybrid | page_only | general` 已进入 prompt、协议、会话存储和 UI；网页内容明确是不可信资料。
- `/models` 更新 availability 而不覆盖 verified/manual 能力；未知项保持 unverified。选择优先级在数据库/Host 中实现，不支持 thinking/tools 的字段不得发送。
- `reasoning_content` 用 chain ID 限制在同一 tool chain；单元回归覆盖不流出、跨链拒绝和无工具时不发送。

## 5. 已执行的定向证据

| 检查                           | 快照结果     | 说明                                                                         |
| ------------------------------ | ------------ | ---------------------------------------------------------------------------- |
| 最终 Vitest                    | 114/114      | 23 files；协议、会话、UI、TextNode、任务与恢复                               |
| 最终 Rust                      | 68/68        | database、Native、DeepSeek、上下文、DPAPI、桌面注册                          |
| 最终 Playwright                | 9/9 + 1 skip | production、fixture、Native、stale ACK、GitHub、PyTorch；Chrome branded skip |
| page-job lifecycle             | 3/3          | 普通续批与 final 后 delta job                                                |
| popup adapter/fixture 隔离     | 10/10        | 两个 popup 测试文件；extension strict typecheck 同步通过                     |
| citations 持久化定向 Rust 测试 | 通过         | atomic exchange、分类/去重；已纳入最终 Rust 全量                             |
| 真实 DeepSeek 三类 smoke       | 通过         | 连接、翻译、助手工具/citation；不记录正文/Key                                |
| Node/RustSec 供应链            | 通过/有警告  | Node 无已知生产漏洞；Rust 无 vulnerability、17 warnings                      |

旧的全量 35/28 或更早 12/23 已失效，不与本表相加。

## 6. 尚需收口/人工确认

1. **原生菜单**：Playwright 无法可靠驱动 Edge 扩展原生右键菜单；同源 iframe、跨源 iframe 和内置 PDF 各需人工执行翻译/解释/询问。
2. **窗口与辅助技术**：PE/自动无窗口 smoke 已通过；125%/150%/200%、Narrator、高对比度、键盘及瞬时闪窗仍需实机观察。
3. **工具条碰撞**：窄视口右上角固定工具条仍需人工确认不会遮挡站点关键操作；当前 DOM click 只证明事件身份。
4. **范围差距**：popup 未暴露逐项 Provider/model/thinking/effort；provider 仍以 segment 为基本请求；`search_current_page` 仅搜索授权上下文包。

## 结论

扫描→批次→Native→数据库→原子 DOM、选区→统一助手→工具→citations→重启恢复两条主链已通过最终自动回归。剩余边界均是明确列出的人机验收或产品范围差距，不能用自动化结果替代。
