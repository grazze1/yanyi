# 网页翻译、语言与领域设置链路修复报告

日期：2026-08-04（Asia/Shanghai）

## 结论

用户报告的 3 个问题均已复现、定位、修复并完成真实 Edge 验收：

1. GitHub、PyTorch 等网页现在能够按用户动作注入内容脚本并完成翻译、显示与还原。
2. 源语言和目标语言改为后台权威、按标签页保存；快速连续选择和 Popup 周期刷新不会再跳回英语。
3. 领域、技术标签、显示模式和模型预设使用同一持久化链路，并实际进入 Native Host 请求、DeepSeek 提示词和缓存上下文。

## 根因

- Edge/Chrome 消息监听器同步返回对象不能可靠地成为 `tabs.sendMessage` 响应。内容脚本已执行，但后台收到 `undefined`，误报“无法注入翻译脚本”。
- Popup 每 350 ms 用固定 fixture 快照覆盖 Zustand 本地状态；语言、领域、标签和模型没有对应后台写接口。
- 启动翻译时目标语言、模型和部分领域参数曾被硬编码；SQLite 站点策略查询也漏读 `tags_json`。
- 快速连续保存可能被较旧响应或状态轮询覆盖。
- 动态网页的 DOM 若在模型返回前变化，内容端会拒绝原子提交，但后台此前仍记为完成并写缓存。
- 长段落拆分后，每个片段曾错误携带整段的全部代码、链接和引用占位符，导致 Native 校验失败。
- 全部片段失败仍曾发送 `translation.completed`；Native Host 断线后也不会主动恢复连接。

## 主要修复

### 内容脚本与页面安全

- 内容脚本消息监听器改为显式 `sendResponse`，握手检查可返回真实页面 URL。
- Native 片段完成事件串行处理；只有页面严格返回 `{ rendered: true }` 后才增加完成数和写入浏览器恢复缓存。
- DOM 指纹变化、通信失败或非法 ACK 会保留原文、标记失败并显示可操作诊断。
- 缓存恢复也必须通过相同 DOM ACK。
- 长段落按每个拆分片段实际出现的占位符生成 `placeholders` 和节点映射，保留顺序与重复引用。

### 设置权威与前后端贯通

- 新增 tab-scoped `TranslationPreferences`：源语言、目标语言、模式、主领域、技术标签、模型预设。
- Popup Adapter 的读取和更新都携带活动 `tabId`；后台校验字段、数量与长度后写入 `storage.session`。
- Popup 使用乐观更新、串行保存队列、revision 防旧响应和轮询 in-flight 防护。
- 翻译请求现在携带 `sourceLanguage`、`targetLanguage`、`domainId`、`technicalTags` 和所选模型预设。
- Rust 提示词和缓存上下文包含语言、领域和排序去重后的标签。
- SQLite 站点策略真实返回 GitHub/PyTorch 的领域与标签。

### 任务与连接可靠性

- Pause、resume、cancel、restore 均绑定明确 `tabId`；缺少标签身份或路由不匹配时拒绝执行。
- Side Panel 状态和控制也查询当前活动标签，不再误操作另一页任务。
- 新任务启动前取消旧的活动任务；标签关闭或导航时取消并清理旧路由。
- Native 控制消息发送成功后才提交状态；页面确认还原后才删除路由。
- Native Host 断线采用 1–30 秒指数退避，并由 Popup/Side Panel 状态查询触发自愈重连。
- Native 终态区分 completed、partial 和 all-segments-failed；全失败发送 `translation.failed`。

## 自动化与真实验收

| 检查                                | 结果                                               |
| ----------------------------------- | -------------------------------------------------- |
| TypeScript strict typecheck         | 通过，根配置 + 8 个 workspace                      |
| ESLint                              | 通过，0 error / 0 warning                          |
| Prettier                            | 通过                                               |
| Vitest                              | 11 files / 35 tests 通过                           |
| Rust tests                          | 28 tests 通过                                      |
| `cargo fmt --check`                 | 通过                                               |
| Clippy `-D warnings`                | 通过                                               |
| Edge / Chrome MV3 production build  | 通过                                               |
| 真实 DeepSeek 最小翻译              | 通过；34 个输出字符，不输出译文或密钥正文          |
| Edge production Native Host 握手    | 通过                                               |
| Edge 本地 HTTP 翻译与还原           | 通过                                               |
| 动态 DOM 拒绝 ACK 安全场景          | 通过；0 段误计完成、无译文 DOM、原文保留、缓存为空 |
| GitHub `github.com/pytorch/pytorch` | 注入、翻译首段、提示词请求、还原均通过             |
| PyTorch Documentation               | 注入、翻译首段、提示词请求、还原均通过             |
| 最终 Playwright                     | 6 passed / 1 skipped（品牌 Chrome 自动加载限制）   |
| Tauri / NSIS release                | 通过                                               |

真实站点测试使用真实 Edge、已注册的安装版 Native Host 和本地 Mock SSE，不产生远程翻译费用；另有一次独立、最小的真实 DeepSeek 请求验证配置和服务。

## 权限与安装状态

- 生产 Manifest 无强制 `host_permissions`，继续使用 `activeTab` 与可选 HTTP/HTTPS 权限。
- GitHub/PyTorch 常驻权限仅存在于 test build。
- 安装版 Native Host 已替换为本轮 release，SHA-256：`4FA4847C259C76A6FA095403F83A61C46C5D11A84B286B5633B68B74CF553060`。
- 新 NSIS：`target/release/bundle/nsis/研译_0.1.0_x64-setup.exe`，SHA-256：`D828C6F7718343D8CF893EB573DC36A785BBBFB1B995E2D616AE8CD2999ADCE7`。

## UI 审查

`frontend-design-review` 与最新 Vercel Web Interface Guidelines 复核通过：语言选择器有明确源/目标标签，技术标签输入有名称、禁用拼写检查和示例占位文本；按钮使用语义元素、图标为装饰时隐藏、焦点可见、原生 select 显式设置前景/背景，并支持 reduced motion。150% 截图：

- `docs/screenshots/edge-popup-language-picker-150.png`
- `docs/screenshots/edge-popup-preferences-150.png`

## 仍需用户执行

在 `edge://extensions` 对“研译”点击一次“重新加载”，并刷新已经打开的 GitHub/PyTorch 标签页，使 Edge 载入新的扩展产物。当前安装版 Native Host 已更新，不要求再次运行安装程序。

## 后续非阻断项

- 当前整页翻译仍是单活动任务模型；在另一标签启动翻译会安全取消前一任务，不支持两个标签同时整页翻译。
- 顶级学科种子仍为 7 个，与 `AGENT.md` 的 8 个分类存在既有迁移差异，需要单独 ADR 和升级迁移。
- 浏览器恢复缓存后续应再纳入权威术语库版本、网站规则版本和完整模型 profile token，避免规则更新后复用旧译文。
- 品牌 Chrome 137+ 不支持命令行自动加载 unpacked 扩展，仍需开发者模式人工验收。
