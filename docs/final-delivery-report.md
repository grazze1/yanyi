# 研译最终专项整改交付报告

## 最终安全更正（2026-08-09）

早期快照中“活动 conversation 的有界 context 存于扩展 local storage”已经失效。现在 local storage 只保存无正文的会话指针；页面上下文从 SQLite `message_contexts` 恢复。页面翻译 TaskRoute 只存在于 `storage.session`，并主动清除旧版 local 副本。超长助手回答也不再在 terminal frame 中重复，从而保证 1 MB Native Messaging 边界内终态可达。详见 `docs/security-review.md`。

报告快照：2026-08-09。当前状态是**本地最终交付**：整改代码、迁移、截图、全量自动回归、生产构建、安装版修复安装与本地注册均已完成；辅助技术现场走查、完整卸载、签名和商店发布仍需人工授权或观察，因此不宣称公开发布完成。

## 1. 本轮交付

| 领域         | 已落地结果                                                                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 整页扫描     | 可见 `TextNode` 全文发现；短控件、链接、导航、表格、同源 iframe、开放 Shadow DOM；保护/忽略/预算/不支持原因可诊断                                                     |
| 安全渲染     | `replace` 原 `nodeValue` 原子写回；`below`/`bilingual` 才附加自有节点；快照还原；迟到结果按页面会话/哈希拒绝                                                          |
| 长页/动态页  | 视口优先但不限制首次全文发现；普通续批复用 page job；最终批次后的 MutationObserver 内容创建独立 delta page job；SPA 导航隔离                                          |
| 会话         | 选区浮窗与 Side Panel 统一时间线、stream reducer 和发送表单；停止、重试、编辑重发、复制、笔记、术语、引用与“新聊天”                                                   |
| 重启恢复     | session handoff 延续活跃流；扩展 local storage 只保存 conversation ID、KnowledgeMode 与时间；正文、上下文和 citations 从 SQLite 分页恢复                              |
| 上下文工具   | `get_selection_context`、`get_containing_component`、`get_adjacent_paragraphs`、`get_current_section`、`search_current_page`、`get_page_metadata`、`search_workspace` |
| 模型控制     | 三种 KnowledgeMode；model catalog；能力 verified/unverified/manual；选择优先级；浮窗/Side Panel/桌面详细模型控制；无跨供应商自动回退                                  |
| 数据         | SQLite v4、WAL/FK/FTS5、page jobs、conversation/message 生命周期、contexts、citations、model catalog/selection、8 个顶级学科                                          |
| Windows/发布 | Tauri 2、release Native Host、Windows subsystem、`CREATE_NO_WINDOW` 注册、NSIS、clean 白名单、release-content audit、生产 fixture 隔离                                |

## 2. 架构结果

```text
页面 TextNode / 选区
  → Edge MV3 content script / Shadow DOM UI
  → service worker（tab/frame/page/job 路由）
  → Native Messaging v1（长度帧、序列、取消、超时）
  → Rust Host（上下文工具、模型能力、验证、脱敏）
  → DeepSeek 或本地 Mock
  → SQLite v4 / FTS5 / DPAPI
  → 原子 DOM commit 或统一会话恢复
```

内容脚本不能直接调用 Native Host；所有请求都经 service worker。页面、选区和模型输出均视为不可信数据。

## 3. 数据库升级

| migration | 作用                                                                                      |
| --------- | ----------------------------------------------------------------------------------------- |
| 0001      | 基础业务表、索引、FTS5                                                                    |
| 0002      | 翻译任务/缓存、记忆、PDF/OCR、配置与完整产品表                                            |
| 0003      | 初始分类、子领域、6 组内置站点规则                                                        |
| 0004      | page jobs；会话/消息生命周期；contexts/citations；model catalog/selection；8 顶级学科校准 |

前三个 migration 未被修改。数据库打开时检测旧 `user_version`，升级前执行 WAL checkpoint 与 SQLite backup；迁移事务失败时保留原文件。安装库的 2026-08-09 只读审计结果：

```json
{
  "builtInWebsiteRules": 6,
  "foreignKeys": 1,
  "integrity": "ok",
  "journalMode": "wal",
  "tables": 49,
  "taskPresets": 8,
  "topLevelDomains": 8,
  "userVersion": 4
}
```

## 4. 协议与任务语义

- `protocolVersion` 保持 1；新增 page job、scan report、conversation CRUD、model catalog/selection 等类型。
- 页面 job 聚合多个 Native task；批次通过 `pageJobId + batchIndex + finalBatch` 约束。最终批次后的动态内容使用新的 delta job，避免违反“每个 job 只有一个 final batch”的数据库约束。
- Host 对 1 MiB 输入、900 KiB 安全响应、非法/截断 JSON、未知版本、序列、取消和超时执行校验；stdout 正常模式只允许协议帧。
- 回答与 citations 原子写入；旧 `message_sources` 继续兼容读取，不能可靠关联的历史会话保留 legacy。

## 5. DeepSeek 最小真实 smoke

真实请求只复用用户已通过 DPAPI 配置的凭据，脚本需显式 `YANYI_CONFIRM_BILLING=1`；下列记录不含 Key、Prompt、选区或回答正文。

| 检查                 | 结果                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------- |
| `/models` + 最小连接 | 通过；可用模型包含 `deepseek-v4-flash`、`deepseek-v4-pro`；761 ms；18 tokens           |
| 整页翻译最小请求     | 通过；34 个输出字符；保护占位符保持；未输出明文正文/Key                                |
| 助手工具链           | Pro / High / page_only；触发 `get_selection_context`；76 个回答字符；historySaved=true |
| 引用恢复             | 完成事件公开 1 条引用；`conversation.get` 从 SQLite 恢复 2 条规范化引用                |
| 隐藏推理             | 公共事件、持久消息和恢复对象均无 `reasoning_content`                                   |

模型目录事实依据 [DeepSeek `/models`](https://api-docs.deepseek.com/api/list-models/)；thinking/tool-chain 参数与临时 reasoning 规则依据 [DeepSeek Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)。`/models` 不提供完整能力字段，因此代码不会把列表响应当作能力证明。

## 6. 安全与供应链

- DPAPI、HTTPS/loopback 约束、拒绝重定向、参数化 SQL、固定 allowed origins、CSP、安全 Markdown、上下文工具 schema、大小上限和日志脱敏均已实现。
- `pnpm audit --prod --audit-level high` 未发现已知生产依赖漏洞。
- `cargo-audit 0.22.2` 扫描 528 个锁定 crate 未发现 vulnerability；保留 17 条维护性/unsound warning，详见 `docs/security-review.md`。
- 生产 popup 已脱离 fixture 依赖路径；发布审计额外扫描 fixture 标识和疑似明文 API Key。

## 7. 测试状态

最终回归结果：Prettier、ESLint、严格 TypeScript、Vitest 23 files / 114 tests、Rust 68 tests、Rustfmt、Clippy `-D warnings`、Native Host 三组脚本和 production build 全部通过。Playwright 完整 opt-in 为 9 passed / 1 skipped，覆盖生产 Edge、fixture UI、Native 翻译、stale DOM ACK、GitHub 与 PyTorch；唯一跳过项是 branded Chrome 137+ 已禁用自动化 `--load-extension`。完整命令、数据库隔离证据和产物哈希见 `docs/test-results.md`。

## 8. 候选构建产物

| 产物             | 当前路径                                                           |
| ---------------- | ------------------------------------------------------------------ |
| Edge unpacked    | `apps/edge-extension/.output/edge-mv3`                             |
| Edge ZIP         | `apps/edge-extension/.output/yanyiedge-extension-0.1.0-edge.zip`   |
| Chrome unpacked  | `apps/edge-extension/.output/chrome-mv3`                           |
| Chrome ZIP       | `apps/edge-extension/.output/yanyiedge-extension-0.1.0-chrome.zip` |
| Desktop          | `target/release/yanyi-desktop.exe`                                 |
| Native Host      | `target/release/yanyi-native-host.exe`                             |
| NSIS             | `target/release/bundle/nsis/研译_0.1.0_x64-setup.exe`              |
| Native manifests | `%LOCALAPPDATA%\Yanyi\NativeMessagingHosts\{edge,chrome}`          |

这些文件已于 2026-08-09 最终重建并通过 release-content、ZIP 深度审计和安装态 smoke。NSIS 已在既有安装目录上连续执行两次 silent install/repair，均返回 0；真实数据库和 DPAPI 配置保留。

## 9. 仍需人工完成

1. 在 Edge 原生右键菜单验证普通页、跨源 iframe 和内置 PDF 的三种命令，并确认浮窗展开 Side Panel 后仍是同一流任务。
2. 在 Windows 125%/150%/200%、Narrator、高对比度、纯键盘和中文 IME 环境走查 popup、选区浮窗、Side Panel 与桌面端。
3. PE header 已确认 Desktop/Host 均为 Windows GUI subsystem，自动进程 smoke 无控制台；仍需肉眼观察安装、注册和启动全过程是否存在瞬时闪窗。
4. silent 覆盖安装已通过；仍需人工执行 NSIS 可见界面的全新安装、默认保留数据卸载和显式完全删除数据卸载。
5. Chrome 开发者模式人工加载、商店 ID、签名证书、许可证最终选择、商店发布和自动更新信任链需用户另行授权。

## 10. 已知限制

- 跨源 iframe、闭合 Shadow DOM、浏览器保护页面明确 `unsupported`；内置 PDF 不承诺整页重写。
- popup 目前使用任务型模型预设；详细 Provider/模型/thinking/effort 控制位于浮窗、Side Panel 和桌面端。
- `componentId`、page profile 与 DOM role 已进入翻译上下文，但 provider 仍以 segment 为基本调用；完整组件级结构化批处理尚未收口。
- `search_current_page` 搜索当前授权上下文包，不是完整 DOM/全文持久索引。
- TBX 解析和大型本地 OCR 引擎未实现。

## 11. Git 状态

- 分支：`codex/final-remediation`；基线：`46ea556 chore: capture pre-remediation baseline`。
- 本报告随本轮最终交付提交一并纳入；根目录 6 张重复设计图已在哈希核对后删除，正式 `docs/design-assets` 保留。
- 未 push、未创建 PR、未签名、未发布商店；未提交用户数据库、日志或 API Key。
