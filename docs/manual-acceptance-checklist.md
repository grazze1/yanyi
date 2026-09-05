# 醒后人工验收清单

1. 双击 `target\release\bundle\nsis\研译_0.1.0_x64-setup.exe`，记录 SmartScreen、安装路径、桌面端启动、托盘和卸载项；当前未签名属预期。
2. 在桌面端诊断页确认 Edge/Chrome 注册；若失败，运行 `scripts\Install-NativeHost.ps1 -Browser Edge` 与 `-Browser Chrome`。
3. 在 Edge 开发者模式加载 `apps\edge-extension\.output\edge-mv3`；在 Chrome 开发者模式加载 `chrome-mv3`。分别确认扩展 ID 与 manifest allowlist 一致。
4. 运行 `pnpm run test:e2e:production`（Edge 注册后）；Chrome 需手动验证或安装 Chrome for Testing。
5. 在 GitHub README、ROS 2、arXiv HTML、NVIDIA Developer、PyTorch 各翻译一页，核对代码/公式/链接、动态内容、模式切换、还原、暂停/继续/取消和刷新缓存恢复。
6. 用本地文本 PDF 验证搜索、缩放、当前页/章节翻译、双语和阅读位置；用扫描 PDF 确认 OCR 明确显示禁用且不上传。
7. 在桌面端安全配置有效 Key；确认可能计费后运行 `scripts\Test-DeepSeekConnection.ps1 -ConfirmBilling`，再验证真实取消与 usage。
8. 验证术语修正、候选确认、JSON 导入/导出、工作区、历史、记忆候选、数据库备份/恢复和诊断脱敏。
9. 测试升级覆盖安装；普通卸载应保留 `%LOCALAPPDATA%\Yanyi\data`。仅在有备份时测试 `Uninstall-NativeHost.ps1 -Browser All -DeleteUserData`。
10. 使用 Narrator、键盘、200% 缩放和高对比度复核 Popup、Side Panel、Desktop 和 PDF Reader。
11. 安装项目隔离的 `cargo-audit` 后扫描 RustSec；选择最终 LICENSE、代码签名证书和商店主体/隐私信息。
