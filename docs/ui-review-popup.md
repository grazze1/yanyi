# 前端专项验收：Popup、Side Panel 与选区浮窗

审查日期：2026-08-09

审查顺序：界面设计规范 → `frontend-design` → Playwright 截图 → `frontend-design-review` → 最新 Vercel Web Interface Guidelines → 修复与复测。

## 结论

自动化验收范围内通过，无阻断项。现有“精确开发工具 / 阅读工作台”方向得到保留：蓝色任务主线、紧凑数据栅格、清晰的本地状态和上下文来源条形成一致层级，没有引入装饰性渐变或通用 AI 落地页风格。

| 审查支柱                       | 状态 | 证据                                                                                                                                         |
| ------------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Frictionless insight-to-action | 通过 | Popup 保留单一翻译主操作；长页扫描报告可展开并可直接进入同一任务；选区“翻译/解释”自动请求，“询问”直接聚焦唯一输入框。                        |
| Quality craft                  | 通过 | 380 px Popup、320 px Side Panel、380 px 页面和 125%/150% 缩放均无横向溢出；Shadow DOM 浮窗边缘避让、滚动、Esc、焦点与窄视口边界通过。        |
| Trustworthy building           | 通过 | 扫描的 12 类结果全部可见；模型能力未验证时禁用；回答范围可检查；浏览器持久层只保存无正文会话指针，context、消息和引用从 Native/SQLite 恢复。 |

## 本轮关键修复

- `PopupApp.tsx:513`：扫描报告使用原生 disclosure，展示可见、合格、入队、完成、保护、忽略、失败、过期、取消、超预算、未扫描和不支持共 12 类诊断。
- `PopupApp.tsx:571`：长页明确显示“全文续批中”、批次进度与可操作的“查看任务”，避免 160 段后静默结束。
- `ConversationPanel.tsx:180`：只持久化 conversation ID、knowledge mode 与时间；显式“新聊天”会排队清除指针，避免旧异步写回，页面上下文从 SQLite 恢复。
- `browserAssistantAdapter.ts:523`：浏览器重启后通过现有 Native `conversation.get` 分页恢复最多 10,000 条消息及 citations；本地扩展存储不复制消息正文历史。
- `sidepanel/main.tsx:304`：实时 handoff 优先，否则按持久 conversation ID 从 SQLite 恢复；页面导航不会自动创建新会话。
- `ConversationPanel.tsx:860`：修复 Provider 切换被旧选择回弹的问题；跨 Provider 不复用旧 API Profile 或 thinking 能力。
- `SelectionPopover.tsx:146`：使用 `border-box` 消除高 DPI 下边框造成的视口越界；浮窗和 Side Panel 共用会话、模型、知识范围与 composer。

## 自动化证据

- ESLint：仓库级 `pnpm lint` 0 error / 0 warning。
- TypeScript：仓库级 `pnpm typecheck` 通过，包含 `@yanyi/edge-extension` strict typecheck。
- Vitest：最终全量 23 个文件、114 项测试通过；UI 专项快照测试仍保持通过。
- WXT：Edge MV3 test build 通过。
- Playwright：完整 opt-in 最终 9 passed、1 skipped；覆盖 production、fixture UI、TextNode 扫描、Native 翻译、stale ACK、GitHub 与 PyTorch。唯一跳过项为 branded Chrome 137+ 自动加载限制。
- Playwright production opt-in：真实安装版 Native Host 握手和 Popup / Assistant / Page / Notes / Options 冒烟通过；未发起真实计费模型请求。
- 持久恢复回归覆盖：受限指针写入、URL 查询/片段清除、SQLite 分页、citation 映射、中断流恢复为可重试失败态、store 恢复不复活旧 task，以及“新聊天”删除指针。

| 截图                                                                                   | 视口 / 缩放      | 覆盖内容                                                   |
| -------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------- |
| [`edge-popup-scan-report-150.png`](screenshots/edge-popup-scan-report-150.png)         | 360 × 640 / 150% | 长页翻译中、12 类扫描诊断、续批入口、固定底部操作          |
| [`edge-popup-scan-report-125-420.png`](screenshots/edge-popup-scan-report-125-420.png) | 420 × 640 / 125% | 宽视口居中、报告栅格、页脚边界与无横向溢出                 |
| [`edge-sidepanel-assistant-150.png`](screenshots/edge-sidepanel-assistant-150.png)     | 320 × 700 / 150% | 上下文边界、统一聊天、模型与 knowledge mode、唯一 composer |
| [`edge-selection-popover-150.png`](screenshots/edge-selection-popover-150.png)         | 380 × 640 / 150% | Shadow DOM 浮窗、来源条、共享控件、焦点与视口避让          |
| [`popup-connected-125.png`](screenshots/popup-connected-125.png)                       | 380 × 640 / 125% | 真实 Native Host 已连接、生产扩展主界面                    |
| [`sidepanel-smoke.png`](screenshots/sidepanel-smoke.png)                               | 380 × 640 / 125% | 生产 Side Panel；Page 与 Notes 入口同时通过语义断言        |

## Web Interface Guidelines 复核

依据 2026-08-09 获取的 [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) 扫描本轮 UI：

- 未发现 `transition: all`、禁用页面缩放、无语义点击 `div/span`、未经清洗的 `dangerouslySetInnerHTML` 或缺少可访问名称的主表单控件。
- 所有 `outline: none` 均在同一 `:focus-visible` 规则中提供可见 box-shadow / border 替代；动画同时提供 `prefers-reduced-motion` 降级。
- 图标按钮具有 `aria-label` 与 `title`；disclosure 具有 `aria-expanded` / `aria-controls`；输入具有 label、name、autocomplete，示例占位文案以省略号结尾。
- Markdown 禁用原始 HTML 并限制安全链接协议；错误、离线、模型不兼容和中断恢复状态均给出下一步。

## 人工验收保留项

以下项目需要真实 Windows / Edge 交互设备，不能由当前无障碍树和 fixture 截图完全代替：

- Narrator 完整朗读顺序、Windows 高对比度、200% 浏览器缩放。
- 真实鼠标触发三个 Edge 右键菜单，以及浮窗固定后页面滚动体验。
- 完全退出并重新启动 Edge 后，用已存在的 Native/SQLite 会话确认消息、引用和 knowledge mode 恢复；自动测试已覆盖其存储和协议边界。
- 真实 DeepSeek 流式任务从选区浮窗展开到 Side Panel 时的连续性；Mock/组件层已验证不重新发起请求。
