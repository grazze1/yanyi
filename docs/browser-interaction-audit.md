# 浏览器端交互审计

> 审计对象：Edge 扩展 Popup、选区浮窗、Side Panel
> 结论原则：所有看起来可点击的控件，要么有真实行为，要么删除；不保留“可点击但无效果”的控件。

## 1. 审计方法

1. 逐一枚举三个界面中的可见控件。
2. 对每个控件追踪完整事件链：DOM 事件 → adapter → `runtime.sendMessage` → service worker → Native Host → 回程事件。
3. 对失效控件定位断点所在层，而不是只修改前端 handler。
4. 为每个修复补充单元测试或 E2E 断言。

## 2. Popup

| 控件                       | 审计前状态             | 根因                                                                                                                            | 修复                                                                                                                      | 覆盖                                                          |
| -------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 翻译此页面                 | 可用                   | —                                                                                                                               | 不变                                                                                                                      | E2E `fixture build renders core states`（offline 时按钮禁用） |
| 打开侧边栏                 | **无效**               | Popup 经 `runtime.sendMessage` 让 service worker 调 `sidePanel.open()`；该 API 要求用户手势，消息往返后手势丢失，调用被静默拒绝 | Popup 在自身 click handler 内直接调用 `browser.sidePanel.open()`；content script 仍走 service worker 兜底；失败时给出原因 | `openSidePanel.test.ts`（7 项）+ E2E 按钮可见性               |
| 固定为侧边栏（图钉图标）   | 与“打开侧边栏”重复     | 同上                                                                                                                            | **删除**（功能与主按钮重复）                                                                                              | —                                                             |
| 翻译模式（替换/下方/双语） | 可用                   | —                                                                                                                               | 不变                                                                                                                      | E2E                                                           |
| 页面语言（源/目标）        | 可用                   | —                                                                                                                               | 不变                                                                                                                      | E2E `popup-language-picker`                                   |
| 领域选择                   | 可用                   | —                                                                                                                               | 不变                                                                                                                      | E2E `popup-preferences`                                       |
| 技术标签增删               | 可用                   | —                                                                                                                               | 不变                                                                                                                      | E2E                                                           |
| 模型预设                   | 可用                   | —                                                                                                                               | 不变                                                                                                                      | `PopupApp.test.tsx`                                           |
| 暂停 / 继续 / 取消         | 可用                   | —                                                                                                                               | 不变                                                                                                                      | `popupAdapter.test.ts`                                        |
| 还原原文                   | 可用                   | —                                                                                                                               | 不变                                                                                                                      | `popupAdapter.test.ts`                                        |
| 查看诊断                   | 可用                   | —                                                                                                                               | `openOptions` 改为先写入目标 section 再打开页面（原顺序存在竞态）                                                         | —                                                             |
| 更多菜单（`⋯`）            | 直接打开完整设置页     | 无溢出菜单，点击即跳转                                                                                                          | 改为真实溢出菜单：打开研译管理端 / 诊断                                                                                   | E2E 溢出菜单断言                                              |
| 术语库（底部大按钮）       | 可点击，跳转桌面管理端 | 属于桌面管理端职责，占据 Popup 主要空间                                                                                         | **删除**                                                                                                                  | E2E 断言 `.secondary-nav` 数量为 0                            |
| 工作区（底部大按钮）       | 同上                   | 同上                                                                                                                            | **删除**                                                                                                                  | 同上                                                          |
| 历史（底部大按钮）         | 同上                   | 同上                                                                                                                            | **删除**                                                                                                                  | 同上                                                          |
| 设置（底部大按钮）         | 同上                   | 同上                                                                                                                            | **删除**（浏览器特定设置移入 `⋯`）                                                                                        | 同上                                                          |
| 扫描报告展开               | 可用                   | —                                                                                                                               | 不变                                                                                                                      | E2E（12 项指标）                                              |
| 查看任务                   | 可用                   | 依赖上面的 side panel 修复                                                                                                      | 走新的手势路径                                                                                                            | E2E                                                           |

## 3. 选区浮窗

| 控件                                        | 审计前状态                        | 根因                                                                                                                                                                                         | 修复                                                                                         | 覆盖                                             |
| ------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 流式回答显示                                | **永久停在“正在读取当前上下文…”** | `background.ts` 用 `runtime.sendMessage` 广播 assistant 事件。该 API 只能到达扩展页面，**永远不会到达 content script**；浮窗运行在 content script 中，因此收不到 `assistant.delta/completed` | 事件同时投递到扩展页面与来源 tab/frame（`tabs.sendMessage`）；每个 task 记录来源             | `assistantEventRouting.test.ts`（10 项）         |
| 拖动                                        | **完全不可拖动**                  | 只按锚点计算位置，没有任何拖拽实现                                                                                                                                                           | header 作为拖拽手柄，pointer 事件 + pointer capture；anchored / manual 双模式；viewport 夹取 | `popoverPosition.test.ts`（15 项）+ E2E 真实拖动 |
| 恢复自动定位                                | 不存在                            | —                                                                                                                                                                                            | 新增按钮，仅在 manual 模式显示                                                               | E2E                                              |
| 展开高级设置                                | 不存在（高级设置始终塞在小窗中）  | —                                                                                                                                                                                            | 新增 compact / expanded 切换                                                                 | —                                                |
| 固定                                        | 可用                              | —                                                                                                                                                                                            | 保留；`pointerdown` 停止冒泡以避免与拖拽冲突                                                 | `SelectionPopover.test.tsx`                      |
| 展开到 Side Panel                           | 可用                              | —                                                                                                                                                                                            | 保留；先 `saveHandoff` 再打开，不重新发起请求                                                | `SelectionPopover.test.tsx`                      |
| 关闭 / `Escape`                             | 可用                              | —                                                                                                                                                                                            | 不变                                                                                         | `SelectionPopover.test.tsx`                      |
| 发送                                        | 可用                              | —                                                                                                                                                                                            | 不变                                                                                         | `ConversationPanel.test.tsx`                     |
| 停止                                        | 可用                              | —                                                                                                                                                                                            | 取消后仍保留 task 来源，确保终态事件能到达浮窗                                               | `ConversationPanel.test.tsx`                     |
| 重试                                        | 可用                              | —                                                                                                                                                                                            | 不变                                                                                         | `ConversationPanel.test.tsx`                     |
| 复制                                        | 可用                              | —                                                                                                                                                                                            | 不变                                                                                         | —                                                |
| 快捷意图（解释这段 / 总结 / 为什么 / 举例） | 不存在                            | “解释”是独立右键入口                                                                                                                                                                         | 新增快捷按钮，复用同一 chat pipeline                                                         | E2E 断言“解释这段”可见                           |
| 模型选择                                    | **未验证模型不可选**              | 前端要求 `availability === 'available'`；Native Host 把 `unknown` 也当拒绝理由                                                                                                               | 四态语义；仅 `unavailable` 阻断                                                              | `modelCapability.test.ts`（14 项）               |
| 思考模式                                    | 未验证即禁用                      | 要求 `supportsThinking === true`                                                                                                                                                             | 区分 unknown 与 unsupported；unknown 可验证或按安全默认参数使用                              | 同上                                             |
| 验证模型                                    | 不存在                            | —                                                                                                                                                                                            | 新增，用户主动触发一次最小验证请求                                                           | `ConversationPanel.test.tsx`                     |
| 回答范围                                    | 可用                              | —                                                                                                                                                                                            | 不变                                                                                         | E2E                                              |
| 新聊天                                      | **compact 模式下不显示**          | `{!compact && ...}`                                                                                                                                                                          | 两种模式都显示；且同时清除站点绑定                                                           | `ConversationPanel.test.tsx`                     |

## 4. Side Panel

| 控件                          | 审计前状态           | 根因                                                     | 修复                                             | 覆盖                              |
| ----------------------------- | -------------------- | -------------------------------------------------------- | ------------------------------------------------ | --------------------------------- |
| 助手 / 页面 / 笔记 导航       | 可用                 | —                                                        | 不变                                             | E2E                               |
| 新聊天                        | 只重置本地 store     | 未清除站点 active conversation，下一次询问仍会续用旧会话 | 同时调用 `conversation.site.new`                 | `ConversationPanel.test.tsx`      |
| 模型 / 推理强度 / 回答范围    | 同浮窗问题           | 同上                                                     | 同上                                             | `modelCapability.test.ts`         |
| 发送 / Enter / Shift+Enter    | 可用                 | —                                                        | 不变                                             | `ConversationPanel.test.tsx`      |
| 停止 / 重试                   | 可用                 | —                                                        | 不变                                             | `ConversationPanel.test.tsx`      |
| 历史恢复                      | 恢复的是单一全局会话 | `active-conversation.v1` 是单键，跨站点共享              | 按 origin 分键；恢复时以当前标签页 origin 为范围 | `browserAssistantAdapter.test.ts` |
| 来源引用 / 跳转原文           | 可用                 | —                                                        | 不变                                             | —                                 |
| 页面暂停 / 继续 / 取消 / 还原 | 可用                 | —                                                        | 不变                                             | E2E                               |
| 笔记保存                      | 可用                 | —                                                        | 不变                                             | —                                 |

## 5. 右键菜单收敛

审计前六项：翻译、解释、询问研译、添加到术语库、设为永不翻译、保存为笔记。

审计后三项：

- 研译：翻译
- 研译：询问研译
- 添加到术语库

“解释”并入“询问研译”的快捷意图（仍使用 `explain` intent，以保留 AGENT.md 中的解释任务预设）。
“设为永不翻译”与“保存为笔记”不再占用右键菜单：前者是术语库的一种策略，后者在 Side Panel 笔记页完成。

## 6. 遗留

- `selectionLaunch` 仍接受 `explain` intent，作为快捷键与旧入口的兼容路径：它打开询问研译并自动发送解释意图，底层不存在第二套对话体系。
- 生产 Edge 与真实网站的 E2E 用例需要已安装的 Native Host 与网络，默认跳过；本轮在装有 Native Host 的环境中单独验证握手、翻译与助手三项脚本。
