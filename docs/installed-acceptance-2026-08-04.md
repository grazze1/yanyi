# 研译安装态全量验收报告

执行日期：2026-08-04（Asia/Shanghai）

## 结论

自动化可覆盖的安装态、数据库、Native Messaging、真实 DeepSeek、前端、Rust、Edge E2E、安全审计和发布构建均已完成。发现并修复 1 个真实配置缺陷，修正 1 个过时的生产 E2E；另发现 1 个需要产品确认的数据种子差异。Windows GUI 主观视觉、Chrome 开发者模式加载、真实站点长流程、安装升级/卸载仍需人工验收。

## 安装态检查

| 项目                    | 结果   | 证据摘要                                                         |
| ----------------------- | ------ | ---------------------------------------------------------------- |
| Edge Native Host 注册   | 通过   | HKCU 注册存在；仅允许固定 Edge 扩展 ID                           |
| Chrome Native Host 注册 | 通过   | HKCU 注册存在；仅允许固定 Chrome 扩展 ID                         |
| 安装版 Host 完整性      | 通过   | 安装版与此前发布 Host SHA-256 一致                               |
| SQLite 完整性           | 通过   | `integrity_check=ok`、WAL、schema v3、44 张表                    |
| 连接级外键              | 通过   | 审计连接启用后 `foreign_keys=1`                                  |
| 内置数据                | 有差异 | 6 条站点规则、7 个任务预设、7 个顶级学科                         |
| Tauri 进程启动          | 通过   | 新 release 桌面端持续运行 5 秒，无提前退出；测试后仅终止测试进程 |

顶级学科种子只有 7 个，与 `AGENT.md` 明确要求的 8 个顶级学科不一致。当前迁移还加入了“通用学术”，并缺少规范中的部分理工/生命科学分类。这是数据模型/迁移缺陷候选，本轮没有擅自修改已安装用户数据库。

## 真实 DeepSeek 联调

- 用户提供的密钥未在命令输出、报告或版本库中回显。
- 对源码、文档和文本测试产物按密钥精确值扫描，明文命中数为 0；DPAPI 配置文件明文命中为 false。
- 密钥已由 Native Host 使用 Windows DPAPI 保存；解密往返可用，配置文件不含明文。
- 直接 `GET https://api.deepseek.com/models` 返回 HTTP 200。
- Native Host `/models` 返回 `deepseek-v4-flash`、`deepseek-v4-pro`。
- 两次最小流式烟测均通过，每次 18 tokens，共 36 tokens；默认选中 `deepseek-v4-flash`。
- 首次安装版烟测定位到 PowerShell UTF-8 BOM 缺陷：`StandardInput` 会在密钥前写入 U+FEFF，旧 Host 将其加密后导致 401。源码现会去除 BOM 和外围空白，并增加 Rust 回归测试；新 release Host 已使用同一路径复测成功。

## 自动化回归

| 检查                             | 结果                                                |
| -------------------------------- | --------------------------------------------------- |
| `pnpm install --frozen-lockfile` | 通过                                                |
| ESLint                           | 通过，0 error / 0 warning                           |
| TypeScript strict typecheck      | 通过                                                |
| Vitest                           | 6 files / 12 tests 通过                             |
| Prettier                         | 通过                                                |
| 前端 production build            | Desktop、Edge、Chrome 通过                          |
| Rust format                      | 通过                                                |
| Clippy `-D warnings`             | 通过                                                |
| Rust tests                       | 24 tests 通过                                       |
| 安装版 Native Host 握手          | 通过，Host 0.1.0 / protocol 1                       |
| 安装版 Mock SSE                  | 翻译、助手、usage、暂停/恢复/取消通过               |
| 安装版错误矩阵                   | 401/402/429/500/503 脱敏映射通过                    |
| Edge fixture E2E                 | 通过，离线/错误/PDF/150% 缩放                       |
| Edge production E2E              | 通过，真实注册 Host、Popup、Side Panel、Options     |
| `pnpm audit --audit-level high`  | 通过，0 个已知漏洞                                  |
| `cargo audit`                    | 通过，无 RustSec vulnerability；17 个允许的 warning |
| Tauri/NSIS release               | 通过                                                |

生产 Edge E2E 初次运行在“解释”标签页查找只属于“追问”标签页的输入框，导致 45 秒超时；trace 证明产品握手正常。测试已改为显式切换“追问”，并更新过时的设置页标题断言，原生产场景复测约 1.8 秒通过。

RustSec 的 17 个 warning 包含 16 个 unmaintained 依赖和 1 个 `glib` unsound advisory。GTK/glib 链不进入 Windows MSVC 目标；`unic-*` 旧依赖仍经 `tauri-utils -> urlpattern` 进入 Windows 构建，应跟随 Tauri 上游升级追踪。扫描未报告已知 vulnerability。

## 新发布物

| 产物                                                  | SHA-256                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `target/release/yanyi-native-host.exe`                | `160570CB7833A90CFA82873880219D703BF079E9BDE643F7B40D880551B4AFE7` |
| `target/release/yanyi-desktop.exe`                    | `D9483BC6225336A1027486BA9DDD5DC83C28D15C973556B05747A5BAC9CDAD47` |
| `target/release/bundle/nsis/研译_0.1.0_x64-setup.exe` | `7736369AEC4C74273618960BED2FD44ADCD9DDE0811EB314DACF2B84C1F736C5` |

NSIS 大小为 7,099,429 bytes。当前机器已安装的 Host 仍是修复前二进制；必须重新运行新安装包，才能让注册路径使用包含 BOM 修复的 Host。

## 仍需人工完成

1. 重新运行新 NSIS，确认覆盖升级、SmartScreen 提示、安装路径和桌面端启动；随后再确认安装 Host 哈希变为新值。
2. 目视验收 Desktop、托盘、Popup、Side Panel 与 PDF Reader 在 100%/125%/150%、高对比度和 Narrator 下的行为。
3. 在 Edge 对 GitHub、ROS 2、arXiv HTML、NVIDIA、PyTorch 做真实长页翻译，检查公式/代码/链接保护、暂停/继续/取消、三种显示模式和精确还原。
4. Chrome 137+ 需在开发者模式手动加载 `apps/edge-extension/.output/chrome-mv3`；品牌版 Chrome 已移除命令行自动加载，无法由当前 E2E 自动完成。
5. 用文本 PDF 与扫描 PDF 验证 PDF.js 阅读、来源权限和 OCR 禁用提示。
6. 验证升级安装、普通卸载保留数据、显式删除用户数据；删除前先备份。
7. 决定并修复“7 个还是规范 8 个顶级学科”的迁移差异，再做空库和升级库验收。
8. 测试结束后妥善删除或迁移工作区外的明文 API Key 临时文件，并按需要轮换 API Key；本轮未删除用户原文件。

## 网页翻译修复后的发布更新

本报告中“当前机器仍安装旧 Host”和旧发布哈希已由后续修复取代。安装路径中的 Native Host 已直接更新并校验与最新 release 完全一致；新的 Tauri/NSIS 也已重建：

| 产物                                                  | 最新 SHA-256                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `target/release/yanyi-native-host.exe`                | `4FA4847C259C76A6FA095403F83A61C46C5D11A84B286B5633B68B74CF553060` |
| `target/release/yanyi-desktop.exe`                    | `D8B02BDE7A28331F7C44ED1D10C59B91ADAFAD5161F046BD9D6E9DCD45ACC7A6` |
| `target/release/bundle/nsis/研译_0.1.0_x64-setup.exe` | `D828C6F7718343D8CF893EB573DC36A785BBBFB1B995E2D616AE8CD2999ADCE7` |

安装版 Host 路径 `%LOCALAPPDATA%\Yanyi\bin\0.1.0\yanyi-native-host.exe` 的哈希为 `4FA4847C259C76A6FA095403F83A61C46C5D11A84B286B5633B68B74CF553060`。当前不需要再次运行 NSIS；只需在 Edge 扩展页重新加载扩展。网页翻译与设置链路的新验收见 `docs/reports/translation-controls-and-pipeline-fix-2026-08-04.md`。
