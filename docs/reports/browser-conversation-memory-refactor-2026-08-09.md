# 研译本轮重构交付报告

> 分支：`codex/final-remediation`
> 日期：2026-08-09（Asia/Shanghai）
> 环境：`source scripts/yanyi-env.sh`（Node 24.18.0 + pnpm 11.19.0 来自 conda `yanyi-dev`，Rust 1.97.1 来自项目内 `.devtools`）

## 0. 环境说明（与用户指令的差异）

用户指定 conda 环境为 `UI`。实测该环境为 Node 25.8.2 且不含 pnpm，而本仓库
`package.json` 限定 `node >=24 <25` 并在 `.npmrc` 设置 `engine-strict=true`，
因此 `UI` 环境无法完成 `pnpm install`。本轮沿用仓库自带脚本
`scripts/Enter-YanyiDev.ps1` 指定的 `yanyi-dev` 环境（Node 24.18.0 + pnpm 11.19.0），
并新增等价的 bash 版本 `scripts/yanyi-env.sh` 供非 PowerShell 会话使用。
若确实需要在 `UI` 环境下工作，需要先把该环境的 Node 降到 24.x 并安装 pnpm 11。

## 1. Root Cause

| 问题                 | 根因                                                                                                                                                                                                                                                           | 修复                                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 打开 Side Panel 无效 | Popup 经 `runtime.sendMessage` 让 service worker 调用 `sidePanel.open()`。该 API 要求用户手势，消息往返后手势已丢失，调用被静默拒绝                                                                                                                            | Popup 在自身 click handler 内直接调用 API；content script 保留 service worker 兜底；失败时区分受限页面 / 无窗口 / 需重试并显示原因 |
| 回答不同步（P0）     | `background.ts` 用 `runtime.sendMessage` 广播 assistant 事件。该 API 只能到达扩展页面（Popup / Side Panel / Options），**永远不会到达 content script**。选区浮窗运行在 content script 的 Shadow DOM 中，因此收不到 `assistant.delta/completed`，永久停在初始态 | 按 task 记录来源 tab/frame，事件同时经 `runtime.sendMessage` 与 `tabs.sendMessage` 投递；终态事件先广播后清理来源                  |
| 会话重复创建         | 无站点作用域：`active-conversation.v1` 是单个全局键；`conversationId` 缺失时 Native Host 直接新建会话                                                                                                                                                          | `site_scope = URL origin`；`site_active_conversations` 每站点一行；浏览器端按 origin 分键；只有“新聊天”创建新会话                  |
| 模型无法选择         | 前端要求 `availability === 'available'`；Native Host 把 `availability.is_none() && !known_official` 也当拒绝理由。目录种子行初始为 `unknown`，导致模型被永久锁死                                                                                               | 四态语义；仅 `unavailable` 阻断；未验证可选并使用安全默认参数；新增用户主动的最小能力验证                                          |
| Memory placeholder   | 只有 `memory_list` / `memory_candidate_list` / `memory_candidate_set_state`，没有新建、编辑、删除、导入                                                                                                                                                        | 新增 `global_memories` 及标签、FTS5、导入作业与候选、版本化快照；桌面端提供真实 CRUD 与导入审阅                                    |
| 浮窗不可拖动         | `SelectionPopover` 只按锚点计算位置，完全没有拖拽实现                                                                                                                                                                                                          | header 作为拖拽手柄；anchored / manual 双模式；viewport 夹取；恢复锚定；compact / expanded                                         |

## 2. Browser Interaction Audit

完整逐控件表见 `docs/browser-interaction-audit.md`。摘要：

- Popup 19 项控件：14 项保持、1 项修复（打开侧边栏）、1 项改造（`⋯` 溢出菜单）、5 项删除（术语库 / 工作区 / 历史 / 设置四个大按钮 + 重复的图钉按钮）。
- 选区浮窗 17 项：新增 4 项（拖动、恢复锚定、展开、快捷意图）、修复 4 项（回答同步、模型选择、思考模式、compact 下的新聊天）。
- Side Panel 10 项：修复 2 项（新聊天清除站点绑定、历史恢复按站点范围）。
- 右键菜单从六项收敛为三项。

结论：不存在“看起来可用但点击无效果”的控件。每个可见控件要么有真实行为，要么已删除。

## 3. Chat Event Flow

详见 `docs/browser-chat-event-flow.md`。

```text
yanyi.assistant.start → 记录 { tabId, frameId }
Native Host 事件 → broadcastAssistantEvent
                   ├─ runtime.sendMessage → Popup / Side Panel / Options
                   └─ tabs.sendMessage    → 来源 tab/frame（浮窗）
```

统一生命周期：`idle → request_queued → context_collecting → streaming → completed | failed | cancelled`。
迟到事件按 `taskId` 过滤；终态事件保留最近 64 条供迟到订阅者结算；Host 断开时所有在飞 task 合成 `assistant.failed`。

UI 文案不再用“读取上下文”兜底：`sending` 显示“正在读取当前上下文…”，
`streaming` 且无内容显示“正在生成回答…”。

## 4. Conversation Model

- **site scope**：`scheme + host + port`。Rust `database::site_origin` 与 TypeScript `siteOriginOf` 规则一致。Host **不信任**扩展传来的 `siteOrigin`，自行从 `context.url` 推导并比对。
- **active conversation**：`site_active_conversations` 每 origin 一行；已归档/已删除会话不会被复用；跨页面同 origin 续用同一会话，但每条消息保存自己的 `page_url` / `page_title`。
- **new chat**：唯一结束当前站点会话的路径。同时清除浏览器端引用与 Host 端绑定，compact 与完整模式都可见。

## 5. Popover

- **定位**：默认锚定选区，滚动与缩放时重新推导；`anchoredPosition` 负责上下翻转与视口夹取。
- **拖动**：header 为手柄，pointer 事件 + `setPointerCapture`；`touch-action: none` 与 `preventDefault` 阻止选中背后文字；手柄内按钮 `pointerdown` 停止冒泡，不与固定/展开/关闭冲突；已拖动后滚动不再移动；`manualPosition` 在窗口变化后重新夹取。
- **Side Panel 展开**：先 `saveHandoff`（含 conversationId、消息、activeTaskId、模型选择）再打开，Side Panel 用 `loadTerminalEvent` 结算，**不重新发起请求**。

## 6. Model Capability

- **verification**：`model.capability.verify` → `model.capability.verified`。仅用户触发，一次最小请求（`max_output_tokens = 16`），不做批量探测，API Key 不进入扩展。结果只写入本次真正观察到的能力列。
- **unverified**：可选、可验证、可按安全默认参数直接使用。UI 显示“未验证”，不锁死。
- **unsupported**：只禁用对应能力（例如思考模式），不禁用整个模型。
- **unavailable**：唯一阻断状态，并给出原因；从不静默切换模型或供应商。
- **reasoning**：仅在模型有已记录 efforts 时显示；能力未知时显示“思考模式：未验证”并提供验证入口。
- **优先级**：单次请求 > 当前 conversation > 任务类型默认 > API Profile 默认。任务预设只是默认值。

## 7. Global Memory

- **schema**：`global_memories`（七种类型、`normalized_content` 去重、enabled / pinned / priority / source / usage）、`global_memory_tags` + 链接表、`global_memories_fts`（触发器同步）、`global_memory_import_jobs` + `global_memory_candidates`、`global_memory_snapshots`。
- **CRUD**：新建、编辑、删除、启用/禁用、固定、搜索、按类型筛选、来源与使用统计、导出。重复内容被拒绝。
- **import**：TXT / MD / JSON；解析→预览→逐条确认→保存；未确认不写入；重复候选标记 `duplicate` 且数据库层双重防重；术语规则给出改存术语库的建议。
- **retrieval**：FTS5 + 结构化过滤 + 评分（pinned / priority / 类型权重 / BM25 名次），默认注入 ≤ 5 条；`enabled = 0` 永不注入；翻译任务不检索。

## 8. Cache

- **provider prefix**：稳定前缀 = System Prompt + 固定记忆快照，小节顺序固定、条目按 `priority DESC, id ASC` 排序，不含 timestamp / 随机 ID / 使用计数。
- **local result cache**：沿用翻译缓存键（source + role + domain + glossary version + model + prompt version），术语版本变化即失效。
- **memory retrieval cache**：检索为本地 FTS5，无 API 成本；同一请求内只检索一次。
- **token / API 优化**：只注入相关记忆而非整库；稳定前缀提高前缀缓存命中；能力验证仅单次最小请求；未验证模型用安全默认参数避免被拒重试；同站会话复用减少上下文重建。
- 明确不为缓存牺牲正确性：不省略必要上下文、不无条件注入全部记忆、不复用过期页面上下文、不忽略术语库版本变化。

## 9. Browser/App Boundary

- **删除**：Popup 底部术语库 / 工作区 / 历史 / 设置四个大按钮；重复的图钉按钮。
- **保留**：连接状态、翻译此页面、打开 Side Panel、翻译模式、页面语言、领域与标签、模型预设、翻译状态与扫描报告。
- **新职责**：`⋯` 溢出菜单提供“打开研译管理端”与“诊断”，并说明管理功能在桌面端。桌面 App 负责 API、模型配置、全局记忆、术语库、工作区、历史管理、网站规则、数据导入导出、日志、诊断、数据库。

## 10. Database Migrations

| migration                               | purpose                                                                                                                                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0005_site_scope_and_global_memory.sql` | 站点作用域会话（`conversations.site_origin` / `last_page_url` / `last_page_title`、`site_active_conversations`、`message_contexts` 页面列）+ 全局记忆（`global_memories`、标签与链接、FTS5 及三个同步触发器、导入作业与候选、版本化快照）；schema 版本 4 → 5 |

规则遵守情况：新增而非修改历史迁移；`open()` 在升级前自动 `VACUUM INTO` 备份；
升级测试覆盖 v1→v5、v2→v5、v3→v5、v4→v5 四条路径，断言备份存在、legacy 数据保留、
新表齐全、legacy 会话未被并入任何站点作用域；无法可靠归并的旧 conversation 保持
`site_origin = NULL`，不被删除也不被错误复用。

## 11. Tests

| command                                                 | result                                          | coverage                                                           |
| ------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                        | 通过                                            | 锁文件无漂移，未新增依赖                                           |
| `pnpm format:check`                                     | 通过                                            | Prettier 无差异                                                    |
| `pnpm lint`                                             | 通过                                            | ESLint 0 error / 0 warning                                         |
| `pnpm typecheck`                                        | 通过                                            | 根配置 + 8 个 workspace                                            |
| `pnpm test`                                             | 通过；27 files / **167** tests（基线 23 / 114） | 事件路由、侧边栏手势、浮窗几何、模型能力、站点作用域、桌面记忆 API |
| `pnpm build`                                            | 通过                                            | Desktop Vite + Edge MV3 production                                 |
| `cargo fmt --all -- --check`                            | 通过                                            | —                                                                  |
| `cargo clippy --workspace --all-targets -- -D warnings` | 通过                                            | 0 error                                                            |
| `cargo test --workspace`                                | 通过；**100** tests（基线 68）                  | 迁移升级、站点作用域、全局记忆、导入、快照、Host 能力与 Prompt     |
| `pnpm test:native-host`                                 | 通过                                            | 长度帧与握手                                                       |
| `pnpm test:native-host:translation`                     | 通过                                            | 翻译/助手 Mock SSE                                                 |
| `pnpm test:native-host:errors`                          | 通过                                            | 401/402/429/500/503 脱敏                                           |
| `pnpm test:e2e`                                         | 通过；4 passed / 6 skipped                      | 浮窗真实拖动、Popup 管理端按钮为 0、扫描报告、TextNode 覆盖        |

未通过删除测试或放宽检查来达标：本轮只修改了 2 个既有测试的断言，两者都是因为
被测行为被**故意**改变（模型不再被锁死；active conversation 改为按站点分键），
并在同一测试中补充了更强的断言。

跳过的 6 项 E2E 需要已安装 Native Host 或外网访问；三组 Native Host 脚本已单独覆盖 Host 侧行为。

## 12. Screenshots

`docs/screenshots/`：

- 新 Popup 与溢出菜单：`edge-popup-preferences-150.png`、`edge-popup-overflow-menu-150.png`
- 可用模型选择 / 未验证模型状态：`edge-sidepanel-assistant-150.png`、`desktop-model-catalog-125.png`
- 可拖动 Popover：`edge-selection-popover-150.png`（锚定）、`edge-selection-popover-dragged.png`（拖动后）
- Side Panel：`edge-sidepanel-assistant-150.png`
- Memory CRUD：`desktop-global-memory-crud-125.png`、`desktop-global-memory-edit-125.png`
- Memory import：`desktop-global-memory-import-125.png`
- 同站点连续聊天与新聊天：以数据库集成测试断言（1 会话 → 新聊天后 2 会话）；UI 侧由 Side Panel 与浮窗截图体现

## 13. Known Limitations

1. **未执行真实付费 API 调用**。能力验证功能已实现并有单测覆盖分支逻辑，但未对真实 Provider 触发计费请求。
2. **未产出新的 Windows release 包**，因此 `Build-WindowsRelease.ps1` 与 `pnpm test:release-contents` 沿用上一轮结论。
3. **未做 Tauri debug/release 实机启动**。桌面 Rust 侧通过 `cargo build` 与 `clippy`，前端通过 typecheck 与 Vite build，记忆界面通过 Playwright 对 Vite dev server 的截图验证。
4. **6 项 E2E 按设计跳过**（需安装版 Native Host 或外网）。
5. `assistant.context.ready` 事件类型已在生命周期中预留，但 Host 目前不发送该事件；浏览器以 `sending` → `streaming` 两段式呈现，功能上不缺失。
6. 记忆内容为本机明文 SQLite，与会话、术语库一致。若要求静态加密，应作为独立 ADR 覆盖整库。
7. 完整 WCAG 合规需人工使用辅助技术测试与专家评审；本轮只做了可访问名称、键盘可达性与角色标注自查。
8. 本轮未实现“用户手动绑定多个域名到一个工作区”，按提示词要求不自动混合不同网站。

## 14. Git Status

- branch：`codex/final-remediation`
- uncommitted：是（本轮全部改动尚未提交，等待用户确认后再创建提交）
- new dependencies：无新增外部依赖。`database` crate 新增 `url`，但 `url` 早已是 workspace 依赖（`context-engine`、`deepseek-client` 已在使用）；拖拽为自实现，未引入第三方拖拽库
- removed dependencies：无
- global environment changed：no（未修改 conda 环境、未安装全局包；新增的 `scripts/yanyi-env.sh` 只影响当前 shell）
- real paid API executed：no
