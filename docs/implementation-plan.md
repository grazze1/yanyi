# 最终专项整改实施计划与状态

更新时间：2026-08-09。原则：增量整改、协议 v1 兼容、迁移 append-only、不跨供应商自动回退。

## 浏览器交互、会话与全局记忆重构（本轮）

| 阶段                                | 状态 | 结果                                                                                    |
| ----------------------------------- | ---- | --------------------------------------------------------------------------------------- |
| A. 审计                             | 完成 | `docs/browser-interaction-audit.md`：三个界面逐控件根因表；六项根因全部定位到具体层     |
| B. 统一 Conversation / Request 状态 | 完成 | `assistantEventRouting.ts` 纯函数化投递目标；per-task 来源记录；统一生命周期语义        |
| C. 浏览器问答同步                   | 完成 | 事件投递到来源 tab/frame；终态先广播后清理；UI 文案按阶段区分                           |
| D. 同站点 active conversation       | 完成 | 迁移 0005；`site_active_conversations`；Host 自行校验 origin；浏览器端按 origin 分键    |
| E. 解释并入询问                     | 完成 | 右键菜单收敛为三项；快捷意图复用同一 pipeline；保留 explain 任务预设                    |
| F. Popover                          | 完成 | 拖拽手柄、anchored/manual、viewport 夹取、恢复锚定、compact/expanded                    |
| G. 模型能力                         | 完成 | 四态语义、安全默认参数、用户主动验证、仅禁用不支持能力                                  |
| H. Popup 清理                       | 完成 | 删除四个管理端大按钮，改为溢出菜单                                                      |
| I. 全局记忆                         | 完成 | schema、CRUD、导入候选确认、FTS5 检索、稳定快照、缓存策略                               |
| J. 完整回归                         | 完成 | lint / typecheck / test / build / e2e / cargo fmt / clippy / test；Native Host 三组脚本 |

未执行项（已在 `docs/test-results.md` 与交付报告中记录）：新的 Windows release 包、
真实付费 API 调用、Tauri debug/release 实机启动。

| 阶段                  | 状态             | 当前结果                                                                                                            |
| --------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1. 安全基线与架构决策 | 完成             | 分支 `codex/final-remediation`；基线 `46ea556`；ADR-0003 已校准                                                     |
| 2. 扫描覆盖与原位渲染 | 完成             | `SHOW_TEXT`、稳定节点身份、保护规则、快照、原子 `nodeValue`、同源 iframe/open Shadow DOM                            |
| 3. 长页与动态页面     | 完成             | 页面逻辑任务、多 Native 批次、诊断闭包、续批游标、SPA 隔离、MutationObserver delta job                              |
| 4. 会话与数据库       | 完成             | migration 0004、会话 CRUD/分页、统一 store、重启恢复、atomic exchange + citations、legacy 兼容                      |
| 5. Knowledge/模型     | 完成             | 三种 knowledge mode、七个受限工具、临时 reasoning、model catalog、能力校验与选择优先级                              |
| 6. 质量/Windows/清理  | 完成             | 页面 profile、输出验证、Windows GUI subsystem、`CREATE_NO_WINDOW`、clean/release/ZIP audit、fixture 与 E2E 数据隔离 |
| 7. UI 复审与截图      | 完成             | popup/浮窗/Side Panel/桌面页面已按固定 Skills 流程复审，报告与截图已更新                                            |
| 8. 全量自动回归       | 完成             | Vitest 114、Rust 68、Playwright 9 passed / 1 skipped；Native、production、live-site、Tauri/NSIS 均通过              |
| 9. 人工/发布验收      | 部分完成，待用户 | silent repair 与自动无窗口 smoke 已过；原生右键、辅助技术、可见卸载、代码签名与商店发布待人工                       |

## 收口准则

1. 全量门禁不得删除测试、放宽 strict/Clippy 或绕过发布审计。
2. 真实 DeepSeek 只执行用户已授权的最小 smoke；脚本必须显式设置计费确认变量，且不得输出 Key 或回答正文。
3. release-content audit 必须在最终生产构建后执行；构建产物不得含测试 fixture、日志、数据库、Markdown、环境文件或疑似 Key。
4. 自动化无法可靠驱动的 Edge 原生菜单、辅助技术和 Windows 窗口可见性进入人工清单，不以单元测试替代。
5. 当前未强制完成的产品增强为：popup 逐项模型控制、真正组件级结构化 provider 批处理、整页检索索引、TBX 与 OCR 引擎。
