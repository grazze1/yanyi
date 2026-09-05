# 正式安全审查与威胁模型

## 2026-08-09 浏览器交互、会话与全局记忆重构增补

本节优先于下方所有较早快照。本轮未发现 P0；新增面的控制如下。

| 边界                    | 控制与证据                                                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assistant 事件跨界投递  | 事件按 task 来源投递到 `tabs.sendMessage(tabId, …, { frameId })`，来源仅来自 `sender.tab` 或调用方上下文中的 `tabId`，不接受页面自行声明的目标。扩展页面广播范围不变。                                                                                                                |
| 站点作用域来源          | Native Host **不信任**扩展传来的 `siteOrigin`：它用 `database::site_origin` 从 `context.url` 自行推导并比对，不一致时按“无站点作用域”处理。因此页面内容无法把两个不相关网站合并到同一会话。`conversation.site.*` 三个处理器同样自行校验 origin，拒绝非 http(s)。                      |
| 站点会话本地存储        | 浏览器 local storage 只保存 `origin → { conversationId, knowledgeMode, savedAt }`，不含页面正文，也不含完整 URL（完整 URL 可能带 token）。映射裁剪到最近 100 个站点。旧的单键 `active-conversation.v1` 在读取时删除，避免跨站错误复用。定向测试断言存储内容不含 `secret` 与路径片段。 |
| 全局记忆存储            | 用户主动保存的内容可能包含个人资料，因此默认只写入本机 SQLite `global_memories`；桌面端显示存储位置、来源与使用统计；提供单条删除、全部导出与逐条禁用。日志不记录记忆正文。                                                                                                           |
| 记忆进入 Prompt 的范围  | 只注入固定（pinned）记忆构成的稳定前缀，加上按当前问题检索出的少量相关记忆（默认 ≤ 5 条）。`enabled = 0` 永不注入。翻译任务不做检索。不存在“整库注入”路径。                                                                                                                           |
| 记忆导入                | 大小上限 512 KiB，且在读取**之前**用 `metadata` 校验，不会先把超大文件读进内存；必须是合法 UTF-8；扩展名白名单 `.txt/.md/.json`，未知扩展名拒绝而非猜测；JSON 需符合文档 Schema，未知 `type` 整份拒绝；候选数量上限 200，单条 4 000 字符。目录或不存在的路径被拒绝。                  |
| 导入不得自动落库        | `import_preview` 只生成候选；写入必须携带明确的候选 ID 列表；未勾选者标记 `rejected`；重复内容在候选阶段标记 `duplicate`，且写入语句带 `ON CONFLICT DO NOTHING`，双重保证不会重复写入。集成测试覆盖“未确认时库为空”“放弃导入不写入”。                                                 |
| FTS 注入                | 检索查询对每个词加引号并剔除内部引号，页面正文中的 `OR`、`NEAR(` 等只会成为普通词，不会成为 FTS5 运算符。单测断言 `a OR* NEAR(` 被转义为普通词。                                                                                                                                      |
| 模型能力验证            | 仅在用户点击时执行**一次最小请求**（`max_output_tokens = 16`），不做批量探测，不会偷偷产生大量计费请求。API Key 仍只在 Host 侧，不进入扩展。结果只写入本次真正观察到的能力列，`COALESCE` 保护未探测项，避免把流式验证结果误当作工具能力结论。                                         |
| 未验证模型              | 改为可选并使用安全默认参数（不发送未验证的 thinking/effort），但**模型标识从不被替换**，不静默切换模型或供应商；调整原因通过 `assistant.accepted.capabilityNotice` 明示。                                                                                                             |
| Prompt cache            | 稳定前缀不含 timestamp、请求 ID 或使用计数（native-host 单测断言不含 `taskId` / `capturedAt`）；使用统计不参与快照指纹，因此不会因统计写入而泄漏行为节奏或使缓存失效。Prompt cache 不保存 API Key。                                                                                   |
| 浏览器权限              | 未新增任何浏览器权限；`wxt.config.ts` 的 permissions 列表未变化。                                                                                                                                                                                                                     |
| Native Messaging stdout | 未新增任何 stdout 写入路径；新增处理器全部经既有 `emit` / `error_response` 输出协议帧。                                                                                                                                                                                               |
| Markdown / XSS          | 未改动渲染路径；助手内容仍由 React 文本节点构造，禁用原始 HTML。新增的记忆内容在桌面端同样以文本节点渲染。                                                                                                                                                                            |

保留风险与后续动作：

- 记忆内容目前不加密，与其余用户数据（会话、术语库）保持一致的本机明文 SQLite 策略。若后续要求静态加密，应作为独立 ADR 覆盖整库而非仅记忆表。
- 能力验证会向 Provider 发送一次真实请求。已通过“仅用户触发 + 最小 token”限制成本，但无法做到零成本验证；界面已说明这是一次真实请求。
- 完整 WCAG 合规仍需人工使用辅助技术测试与专家评审。

---

## 2026-08-09 最终专项整改增补

本增补优先于下方较早快照。最终代码审计未发现 P0；本轮识别的 P1 已完成修复并进入最终全量回归，详细命令与数量见 `docs/test-results.md`。

| 边界                    | 最终控制与证据                                                                                                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 扩展临时页面数据        | `TaskRoute` 不再进入 `browser.storage.local`。页面 URL、页面画像和 `completedByHash` 译文仅写入 `storage.session`，可跨 MV3 Service Worker 休眠恢复，但不会跨浏览器会话长期保留；启动、读取和写入都会删除旧版 local key。3 个 route-storage 回归覆盖 session 写入、legacy 丢弃与终止清理。 |
| 活动会话恢复            | 扩展 local storage 只保留 `conversationId`、`knowledgeMode`、`savedAt`，不再复制 selection、URL、标题、消息或引用。最新安全上下文由 SQLite `message_contexts` 经 `conversation.get` 恢复；URL query/fragment 在返回 UI 前移除。相关 Adapter/Side Panel/数据库定向测试通过。                |
| 选区一次性投递          | 选区浮窗成功打开后立即清除待投递数据；只有 Side Panel fallback 写入带随机 `launchToken` 的 session 数据。`yanyi.selection.consume` 串行执行 get→remove，避免多消费者重复读取。                                                                                                             |
| Native 1 MB 帧          | 2 MiB 助手答案不会在 `assistant.completed` 中重复发送；终态仅携带 `answerCharacters`/`answerIncluded=false`，UI 保留已收到的流式 delta。小答案继续携带完整 answer。2 个 Rust 回归分别验证超长终态可写入小于 1 MB 的帧及小答案兼容。                                                        |
| DPAPI、日志与 reasoning | API Key 仅以 Windows DPAPI 密文保存；扩展、SQLite、运行日志与 release 不含明文 Key。Native 日志只接受固定生命周期事件。`reasoning_content` 只存在于同一内存工具调用链，不进入流事件、Debug、SQLite、引用或长期记忆。                                                                       |
| Markdown/XSS            | 助手 Markdown 由 React 文本节点构造，禁止原始 HTML；链接只接受 `http:`/`https:`，并设置 `noopener noreferrer`。页面翻译使用 `nodeValue`/`textContent`，无生产 `dangerouslySetInnerHTML`、`eval` 或远程脚本路径。                                                                           |
| Native allowlist/关联   | Edge/Chrome 公钥计算出的扩展 ID 分别与 allowlist 的 `ajpiobadehjdkionkgfkpipjfgdgopjn`、`clneblfdkkemjfehjgolimihblegcice` 一致。协议限制 1 MB 输入、版本、类型、请求关联、任务序列、超时与取消。                                                                                          |
| Provider 选择           | Native 只接受已配置的 `deepseek` Provider/API Profile；不可用或未审计模型显式失败，不自动切换供应商。HTTPS 是远程 Base URL/代理的最低要求，loopback 仅用于本地 Mock。                                                                                                                      |
| Release 内容            | 审计现在覆盖 desktop dist、desktop resources、Edge 和 Chrome production 输出；任何预期 root 缺失即失败，避免“未构建也通过”。当前四个 root 未发现 test/fixture/db/log/env/Markdown、生产 fixture 标识、`reasoning_content` 或疑似明文 `sk-` Key。                                           |
| 安装与卸载              | 重复注册先暂存 Host，并可从失败替换回滚；支持覆盖只读的同版本 Host。NSIS 检查注册/注销退出码。卸载精确移除 HKCU、manifest 与 `%LOCALAPPDATA%\Yanyi\bin`，保留 data/config/log/backups。                                                                                                    |
| clean 边界              | 清理目标仍为仓库内显式白名单；新增 canonical path 与逐级 symlink/junction 检查，防止中间目录联接把 `rm` 引向工作区外。普通目标和外部 junction 拒绝测试均通过。                                                                                                                             |

最终验证摘要：Vitest 23 files / 114 tests、Rust 68 tests、Playwright 9 passed / 1 skipped，另含 Edge/test-fixtures strict typecheck、Clippy `-D warnings`、Native 三组脚本、release 四 root/ZIP 审计、安装版 framing 和 NSIS silent repair。缺失 release root 的负向测试按预期失败。未读取、输出或复制工作区外的明文 API Key 文件。

保留的人工边界：silent 覆盖安装与自动无窗口 smoke 已通过；NSIS 可见全新安装/两类卸载、瞬时闪烁观察、签名、商店 ID/发布和真实浏览器辅助技术检查仍需人工完成。

审查快照：2026-08-09。结论：未发现阻止本机未签名候选版测试的已知高危代码问题；代码签名、商店信任链、原生安装/卸载和辅助技术仍需人工验收。

## 威胁与控制

| 威胁                      | 已实现控制                                                                                                                                           | 保留风险 / 后续动作                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 页面 Prompt Injection     | 页面/选区标记为不可信；system prompt 与数据分离；三种 KnowledgeMode；本地工具白名单、JSON Schema、页面/工作区会话校验、4 轮上限                      | 继续维护注入 fixture；页面文本仍可能影响模型内容质量                                 |
| 隐藏推理泄露              | `reasoning_content` 使用不可直接序列化的临时封装；只在同一 tool chain 内存回传；流事件、Debug、会话、引用与长期记忆均过滤                            | Provider 行为变化时需补协议回归                                                      |
| 模型输出注入              | 页面提交使用 `nodeValue`/`textContent`；聊天安全 Markdown 禁原始 HTML并限制链接协议；源码无生产 `dangerouslySetInnerHTML`/`eval`/远程脚本            | 新增 Markdown 扩展或代码高亮器时必须重新审查                                         |
| DOM 损坏/迟到写入         | 原文快照；完整分片验证后原子提交；tab/frame/page session/job/node/hash 关联；失败保留原文；自有节点从 observer 排除                                  | 跨源 iframe/闭合 Shadow DOM 只能标为不支持                                           |
| Native Messaging spoofing | 固定 Edge/Chrome 开发 ID allowlist；协议 v1 校验；32 位小端帧；1 MB 输入和 900 KiB 安全响应上限；任务序列锁、取消与超时                              | 商店 ID 变化时必须同步清单与注册脚本                                                 |
| API Key 泄露              | 扩展不接触 Key；Host/桌面端 stdin 配置；Windows DPAPI；Authorization/Key/正文/译文/推理日志脱敏                                                      | DPAPI 不能防御同一 Windows 用户下已被攻陷的进程；工作区外明文源文件应由用户删除/轮换 |
| 会话与引用隐私            | SQLite 本地存储；回答与引用事务写入；local storage 只保留会话 ID/模式/时间，正文与 context 从 SQLite 恢复；选区 launch token 位于 session 且一次消费 | 同一 Windows 用户仍可读取本地 SQLite；敏感项目应使用“新聊天”、归档或删除策略         |
| 数据库/迁移/导入          | 参数化 SQL、FK/WAL/FTS5、append-only migration；v1-v3 升级前 checkpoint + SQLite backup；导入 canonicalize、扩展名/大小/格式校验                     | 用户仍可主动导入语义错误或不可信备份；正式破坏性操作必须提示                         |
| 模型目录能力欺骗          | `/models` 只导入 ID/owner/可用性；能力由审计 adapter/人工配置提供；未知项未验证；不支持字段不发送；不可用模型不自动换供应商                          | 兼容第三方 endpoint 的人工能力声明属于用户信任边界                                   |
| SSRF/Base URL/代理        | 远程 endpoint 要求 HTTPS；Mock 只允许 loopback；拒绝重定向；响应/上下文大小受限                                                                      | 用户显式配置的 HTTPS 服务可看到发送内容                                              |
| 路径与卸载                | 导出位于 Yanyi 数据边界；导入路径规范化；clean 仅仓库白名单；卸载只操作精确 HKCU/`%LOCALAPPDATA%\Yanyi` 目标并默认保留数据                           | 完全删除数据选项仍需用户确认和人工安装器验收                                         |
| PDF/OCR                   | PDF 大小上限；可选来源权限；OCR 默认 disabled；不上传页面图像                                                                                        | PDF.js 是复杂解析器，需随上游安全更新；内置 PDF 不执行整页 DOM 重写                  |
| 权限/CSP                  | MV3 常驻权限最小化；站点权限为 optional，测试构建才加入固定 host；extension CSP 禁外部脚本/对象                                                      | `activeTab`、`scripting`、`nativeMessaging` 是核心能力，用户文档需解释               |
| 发布内容污染              | 生产 fixture 动态隔离；release audit 拒绝测试/fixture/log/db/Markdown/env，并扫描 fixture 标识与疑似 `sk-` Key                                       | 每次最终生产构建后必须重跑审计                                                       |
| Windows 子进程            | release Windows subsystem；后台 `reg.exe` 使用 `CREATE_NO_WINDOW`；Native Host stdout 只允许协议帧，日志脱敏轮转                                     | 无控制台闪烁仍需要 release 进程树/实机观察                                           |

## 供应链复验

- `pnpm audit --prod --audit-level high`：2026-08-09 未发现已知生产依赖漏洞。
- `cargo-audit 0.22.2`：2026-08-09 扫描 `Cargo.lock` 的 528 个 crate，未发现 vulnerability；报告 17 条允许 warning，其中 16 条 unmaintained、1 条 `glib 0.18.5` unsound。GTK/glib 警告来自非 Windows 目标依赖图，`unic-*`/`proc-macro-error` 等仍需跟随 Tauri/上游升级，不能视为已消除。
- pnpm/Cargo 使用精确锁文件；项目级 Skills 的来源、commit、许可证和审阅日期记录在 `docs/skills-lock.md`。

## 真实 API 与数据复验

- 真实 `/models`、最小翻译和最小助手请求均通过用户显式授权执行；脚本需要 `YANYI_CONFIRM_BILLING=1` 才会调用计费接口。
- 报告只记录模型、耗时、token 数、字符数、占位符/引用/reasoning 布尔结果，不记录 Key、选区、Prompt 或回答正文。
- 助手回答与规范化 citations 在一个事务中保存，随后通过 `conversation.get` 从 SQLite 恢复；公开事件与恢复结果均未出现 `reasoning_content`。

## 发布前必须复核

1. 最终 production roots、ZIP、secret scan、framing、序列、取消和错误脱敏已通过；发布任何新构建后必须重复这些门禁。
2. 人工执行 NSIS 可见全新安装与两类卸载，核对 allowed origins、HKCU、瞬时闪窗和数据保留语义。
3. 获得商店 ID 和签名证书后重新生成并审查信任链；当前未签名产物不得作为公开发行版。
