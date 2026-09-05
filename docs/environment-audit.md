# 环境审计

审核日期：2026-08-09（Asia/Shanghai）。

## 隔离工具链

| 工具          | 版本                     | 位置                                     |
| ------------- | ------------------------ | ---------------------------------------- |
| Node.js       | 24.18.0                  | `D:\Anaconda\envs\yanyi-dev`             |
| pnpm          | 11.19.0                  | `D:\Anaconda\envs\yanyi-dev\Library\bin` |
| Python        | 3.12.13                  | `D:\Anaconda\envs\yanyi-dev`             |
| rustc / Cargo | 1.97.1                   | `%PROJECT_ROOT%\.devtools\cargo`         |
| Rust target   | `x86_64-pc-windows-msvc` | 项目内 rustup toolchain                  |

pnpm store、Rust/Cargo home、NSIS 工具缓存、WXT/Vite/Cargo 构建产物均位于 Conda 环境或项目目录；未修改全局 Node、pnpm、Rust、Conda 或 Git 配置。

## 允许的系统组件

- Visual Studio Build Tools 2022 `17.14.37` 安装于 `C:\BuildTools`，状态 complete、无需重启。
- Windows SDK `10.0.26100.0`。
- Microsoft Edge `151.0.4129.72`；WebView2 Runtime `151.0.4129.72` 已存在，未重复安装。

这是本项目唯一使用的系统级开发依赖集合；本轮未安装新的系统级工具。

## 仓库与安装态

- 分支：`codex/final-remediation`；整改前安全基线：`46ea556`；本轮最终交付将建立本地提交，未 push。
- 当前安装库：`%LOCALAPPDATA%\Yanyi\data\yanyi.db`。只读审计结果为 `integrity=ok`、`user_version=4`、WAL、FK 启用、49 张表、8 个顶级学科、6 条内置站点规则、8 个任务预设。
- 已生成并审计 Edge/Chrome MV3 与 ZIP、`yanyi-native-host.exe`、`yanyi-desktop.exe`、`研译_0.1.0_x64-setup.exe`；当前为未签名的本地最终交付，不等同于商店公开发行版。
- NSIS silent install/repair 在既有安装目录上连续两次通过；Edge/Chrome HKCU 清单已刷新到安装版 Host，allowed origins 固定，Host 哈希与 release 一致。

## 密钥处理

用户授权的 DeepSeek Key 已通过 stdin 导入并由 Windows DPAPI 保存；测试和文档没有回显 Key。用户提供的工作区外明文源文件仍由用户控制，本任务未删除或提交，最终应由用户安全删除或轮换。
