# 架构

扩展只负责页面扫描、受控渲染和交互；所有供应商网络请求都通过 Native Messaging 进入 Rust Host。Host 校验 1 MB 帧、协议版本和任务状态，调用 DeepSeek-compatible 客户端并读写共享 SQLite。桌面端通过 Tauri commands 管理同一数据库与 DPAPI 配置。

模块边界：`translator-core` 定义版本和密钥接口；`deepseek-client` 处理模型列表、SSE、错误和网络边界；`context-engine` 处理站点规则与引用；`glossary-engine` 处理术语优先级；`memory-engine` 处理确认与检索权重；`database` 负责 migration/repository；`native-host` 负责跨进程编排。

生产数据路径为 `%LOCALAPPDATA%\Yanyi`。构建工具、Rust、pnpm store 与缓存均位于仓库或 Conda 环境。
