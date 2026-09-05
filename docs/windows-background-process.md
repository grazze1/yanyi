# Windows 后台进程与无控制台策略

## 安装/卸载最终加固（2026-08-09）

- 同版本修复安装可覆盖此前设为只读的 Native Host：新文件先写入同目录暂存路径，替换失败时恢复旧文件，成功后继续保持只读。
- NSIS post-install 与 pre-uninstall hook 现在检查桌面注册命令退出码；注册或清理失败不会再静默显示成功。
- 注销精确删除 Edge/Chrome HKCU Native Messaging 注册、manifest 和 `%LOCALAPPDATA%\Yanyi\bin` 可执行安装物；用户数据库、DPAPI 配置、日志与备份默认保留。
- 自动回归已验证“首次安装→只读目标→同版本替换→卸载 executable→数据库仍存在”。最终 NSIS silent install/repair 已连续两次返回 0；真实可见 NSIS UI、卸载和瞬时闪烁仍保留为人工验收。

更新时间：2026-08-09。

## 进程边界

| 进程                    | release 行为                                                                       | 标准流/窗口规则                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `yanyi-desktop.exe`     | Tauri 管理端，`#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` | 不创建控制台；GUI 由 WebView2 承载                                                                 |
| `yanyi-native-host.exe` | Edge/Chrome Native Messaging Host，同样使用 Windows subsystem                      | 继续读取浏览器继承的 stdin，并向继承 stdout 写 32 位小端长度帧；正常 Host 模式 stdout 禁止普通文本 |
| `reg.exe`               | 桌面端注册/注销 HKCU Native Messaging 清单                                         | 通过 `CommandExt::creation_flags(CREATE_NO_WINDOW)` 启动                                           |
| `explorer.exe`          | 仅在用户主动“打开目录”时启动                                                       | 这是有意可见的交互窗口，不属于后台闪烁                                                             |

Debug 构建保留控制台，便于协议诊断。Native Host 诊断写 stderr 或 `%LOCALAPPDATA%\Yanyi\logs` 下的脱敏轮转日志；单个日志达到 1 MiB 时轮换。`--test-connection` 是显式命令行诊断模式，不代表浏览器 Native Messaging stdout 路径。

## 已验证的代码/构建证据

- 两个 Rust 入口均具有 release-only Windows subsystem 属性。
- 桌面端所有 `reg.exe` 调用经统一 `hidden_command` 包装，并限制为固定 Edge/Chrome HKCU 路径。
- Native Host framing 有输入上限、截断/非法 JSON/未知版本、序列、取消与终态回归；任务级 emitter 使用互斥序列分配，避免多流并发重复 sequence。
- 2026-08-09 最终 Rust 68 tests、Clippy `-D warnings`、三组 Native 脚本、安装版 framing、production Edge handshake 和 Tauri installed smoke 均通过。
- `dumpbin /headers` 确认 Desktop 与 Native Host 均为 subsystem 2（Windows GUI）；安装版桌面主窗口创建且响应正常，Host 哈希与 release 二进制一致。

## 必须人工观察的验收

1. 自动 PE/进程 smoke 已通过；仍需肉眼观察从最终 NSIS 启动桌面端、注册和 Host 重连时是否出现瞬时黑色控制台。
2. production Edge 握手、流式翻译、stale ACK 和 Host framing 已通过；真实人工取消/重连时仍需同步观察 stdout、日志与窗口。
3. silent 注册、同版本修复和覆盖安装已通过；保留数据卸载与完全删除数据卸载仍需人工执行并确认可见提示。
4. debug 二进制允许显式控制台；不得用 debug 结果替代 release 可见性验收。
