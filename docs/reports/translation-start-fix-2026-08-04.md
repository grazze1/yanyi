# 页面翻译无法启动：诊断与修复

日期：2026-08-04

## 用户现象

扩展 Popup 和连接状态可以正常显示，但点击“翻译此页面”后网页没有出现译文。

## 复现与定位

新增的 Edge + 本地 HTTP 页面 + Native Host Mock SSE 纵向 E2E 能稳定复现：Native Host 显示已连接，页面内容脚本能够响应检查消息，但后台没有创建翻译任务路由，页面也没有生成 `data-yanyi-owned="translation"` 节点。

单段真实 DeepSeek 协议烟测通过且不输出译文正文，排除了 API Key、DPAPI、`/models`、SSE 和 Native Host 翻译解析器故障。

根因是目标标签页解析依赖后台猜测“最近页面”，并使用 `tab.url` 判断是否为网页。在仅授予 `activeTab`、没有 `tabs` 或常驻站点权限时，Edge 可以隐藏非当前标签的 URL；请求因此在扫描前返回 `accepted: false`，且错误被 Popup 的周期刷新覆盖。

## 修复

- Popup 在用户点击翻译时显式查询当前活动标签，并把 `tabId` 传给后台。
- 增加最小化 `scripting` 权限；内容脚本改为按用户动作注入，不再在所有匹配网页上常驻注入。
- 后台以明确 `tabId` 为首选，检查已有内容脚本；缺失时通过 `scripting.executeScript` 注入并等待就绪。
- 对同一标签的并发注入去重；标签关闭时清理状态。
- 右键菜单和快捷命令复用相同注入路径。
- 对 `edge://`、扩展商店等禁止注入的页面保留可见错误提示，不再静默恢复为“就绪”。

## 回归证据

- ESLint：通过。
- strict TypeScript：通过。
- Vitest：8 files / 17 tests 通过。
- 新增 4 个内容脚本注入器测试：复用、首次注入、并发去重、受限页面拒绝。
- 新增 Popup Adapter 测试：确认活动标签 ID 被传入 `yanyi.translation.start`。
- Edge 与 Chrome MV3 production build：通过。
- 生产 Manifest：包含 `activeTab` 与 `scripting`，无常驻 `content_scripts`、无强制 `host_permissions`；仍保留可选站点权限。
- 真实 Native Host 单段翻译：通过，输出内容未写入日志。

修复后的 GUI E2E 已保留在 `tests/e2e/extension.spec.ts`，但本轮最后一次 Edge 启动被 Codex GUI 执行额度限制拒绝，无法在代理侧复跑；需要用户在 Edge 扩展页重新加载后执行一次实际页面验证。

## 用户验证

1. 打开 `edge://extensions`。
2. 找到“研译”，点击“重新加载”。
3. 打开普通 `https://` 技术文档页面。
4. 点击研译图标，再点击“翻译此页面”。
5. 页面右上角应出现研译工具条，正文下方应逐段出现译文。

Edge 设置页、扩展商店、`edge://` 内部页面和内置 PDF 查看器不允许普通内容脚本注入；这些页面会显示明确提示，PDF 请使用研译 PDF Reader 或选区翻译入口。

## GitHub / PyTorch 注入失败补充修复

用户重新加载首轮修复后，在 GitHub、PyTorch 等普通 HTTPS 页面看到“无法注入翻译脚本”。检查 Edge 生产构建确认后台实际向 `chrome.scripting.executeScript()` 传入了 `/content-scripts/content.js`。Chromium Scripting API 要求 `files` 是相对于扩展根目录的路径；WXT 生成的 TypeScript 类型则把公开路径建模为带前导斜杠，造成类型通过但运行时路径不符合接口约定。

本轮将运行时路径修正为 `content-scripts/content.js`，并增加窄范围类型兼容注释。生产构建中已确认：

- 后台产物保存的路径为 `content-scripts/content.js`，无前导 `/`。
- `.output/edge-mv3/content-scripts/content.js` 实际存在。
- 注入异常不再被吞掉：文件缺失、站点权限不足和其他注入失败会分别显示可操作提示。
- 新增 2 个运行时路径/错误映射测试；全量结果为 9 files / 19 tests 通过。
- 全仓 strict TypeScript、ESLint、Prettier、Edge production build、Chrome production build 均通过。

由于代理侧 GUI 启动额度限制仍在，本轮无法自动启动 Edge 做最后一次真实站点点击；重新加载扩展后需由用户在 GitHub/PyTorch 页面验证。

## 后续复验说明

上方“无法自动启动 Edge”的限制已在后续任务中解除，不再是当前状态。真实 Edge 已分别在 GitHub 与 PyTorch Documentation 完成注入、翻译首段和还原；最终 Playwright 为 6 passed / 1 skipped。同步定位到更底层的内容脚本 `sendResponse` 语义问题，并完成语言、领域、技术标签持久化及动态 DOM ACK 修复。以 `docs/reports/translation-controls-and-pipeline-fix-2026-08-04.md` 为最新结论。
