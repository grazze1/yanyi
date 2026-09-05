# 从源码配置 Windows 开发环境

先安装 Conda，以及 Microsoft C++ Build Tools 的“使用 C++ 的桌面开发”工作负载和
Windows SDK。已有 WebView2 可直接使用。

在项目根目录打开支持 `conda` 命令的 PowerShell：

```powershell
conda env create -f environment.yml
conda activate yanyi-dev
npm install --global pnpm@11.19.0
```

最后一条命令仅在已激活的 Conda 环境内安装 pnpm。执行前可用 `Get-Command npm`
确认它来自该环境。

Rust 使用项目级安装。在运行官方 Windows `rustup-init.exe` 安装器之前，先在同一
PowerShell 会话设置路径：

```powershell
$env:RUSTUP_HOME = Join-Path $PWD '.devtools\rustup'
$env:CARGO_HOME = Join-Path $PWD '.devtools\cargo'
```

从 Rust 官方安装页面取得 `rustup-init.exe` 后，在这个会话中运行该可执行文件，参数为
`-y --no-modify-path --profile minimal --default-toolchain 1.97.1`。例如，安装器已放入
项目 `.devtools` 时：

```powershell
& .\.devtools\rustup-init.exe -y --no-modify-path --profile minimal --default-toolchain 1.97.1
& .\scripts\Enter-YanyiDev.ps1
node --version
pnpm --version
cargo --version
```

随后执行 [README](../README.md) 的构建与注册步骤。`Enter-YanyiDev.ps1` 必须在当前
PowerShell 会话调用；通过新建 `powershell -File` 子进程调用时，环境变量不会回传。

普通浏览器使用只需要已构建并注册的 Native Host。首次连接会创建 SQLite 数据库，
不需要另外安装或启动数据库服务器。打包安装器参见 [Windows 发布](release.md)。
