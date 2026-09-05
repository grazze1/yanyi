# ADR-0001：第二阶段网页翻译纵向切片

状态：已采纳（2026-08-03）

网页页面事实始终保留在原 DOM 中。内容脚本仅扫描安全语义块，将代码、数学、链接、URL、路径和引用替换为有序类型化占位符；Native Host 只接收该文本和占位符 token。SSE delta 仅用于任务进度，只有 `translation.segment.completed` 能经过占位符验证并通过 `createTextNode` / `cloneNode` 原子写入带 `data-yanyi-owned` 的翻译容器。

跨进程仍使用协议 v1：新增翻译事件而未改变握手或旧 `request.cancel`。后台按 `tabId + frameId + pageSessionId + taskId` 路由，并把不含页面文本的运行元数据保存在 `storage.session`，抵抗 MV3 Service Worker 休眠。

Native Host 对每个任务采用最多 2 个并发分段、视口优先、暂停/取消和有限重试。DeepSeek 与 localhost Mock 使用相同 `POST /chat/completions` SSE 解析器。真实密钥仅以 DPAPI 密文存于 `%LOCALAPPDATA%\Yanyi\config\deepseek.dpapi.json`。

不新增 `tabs` 或主机权限；Edge 真正的浏览器 Action 弹窗天然拥有当前页的 `activeTab`。Playwright 直接导航 popup.html 不能完整模拟这项浏览器授予，因此完整页面动作保留人工验收，协议、Native Host 和 DOM 两端均有自动测试。
