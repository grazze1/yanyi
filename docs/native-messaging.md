# Native Messaging 与注册

Edge 与 Chrome 使用不同固定开发 ID 和不同 manifest，均只允许对应 `chrome-extension://<id>/`。安装器把 Host 复制到 `%LOCALAPPDATA%\Yanyi\bin\<version>` 并设只读，再写 HKCU 注册。正式注册不引用 `target/debug`。

诊断：`scripts/Test-NativeHostRegistration.ps1`；注册：`Install-NativeHost.ps1`；卸载：`Uninstall-NativeHost.ps1`。Host 崩溃时扩展进入离线状态，未完成页面原文不会被覆盖。
