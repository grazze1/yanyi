# Windows 发布

执行 `scripts/Build-WindowsRelease.ps1`。脚本先运行质量门禁，再构建 Native Host、Edge/Chrome 扩展和 Tauri NSIS。Tauri `useLocalToolsDir` 将 NSIS 缓存在项目 `target/.tauri`，避免污染用户工具目录。

产物：`target/release/yanyi-native-host.exe`、`target/release/yanyi-desktop.exe`、`target/release/bundle/nsis/研译_0.1.0_x64-setup.exe`。源码已采用 Apache-2.0 公开。正式安装包与商店发布前仍需取得代码签名证书、验证安装/升级/卸载并更新商店隐私信息。
