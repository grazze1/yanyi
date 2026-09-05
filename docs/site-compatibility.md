# 网站兼容性矩阵

更新时间：2026-08-09。这里区分“代码/fixture 已覆盖”“真实站 opt-in 场景存在”和“本轮最终实机已人工确认”，避免把旧提交的通过结果当成最新工作树结论。

| 网站/页面                      | 当前实现                                                                                | 自动化证据                                                                                               | 最终人工边界                                             |
| ------------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| GitHub                         | `SHOW_TEXT` 扫描 README、导航、短标签、链接与表格；代码/URL 保护；动态内容              | GitHub-like fixture；2026-08-09 真实 `github.com/pytorch/pytorch` production-host E2E 注入/翻译/还原通过 | 重新加载最终扩展并刷新旧标签页，确认原生右键与页面工具条 |
| PyTorch Documentation          | 文档正文、导航、表格和动态内容；PyTorch/product profile 与代码保护                      | PyTorch-style fixture；2026-08-09 真实 `docs.pytorch.org` production-host E2E 注入/翻译/还原通过         | 在最终 Host/扩展组合上人工抽查复杂 API 页面              |
| ROS 2 Documentation            | 内置规则、ROS 2 标签、同源文档导航、动态观察                                            | ROS fixture/站点规则和 TextNode 单元回归                                                                 | 真实站尚未执行本轮人工抽查                               |
| arXiv HTML                     | 文章 TextNode；KaTeX/MathJax/MathML/引用保护；bilingual 默认                            | arXiv-like fixture、公式保护单元回归                                                                     | 真实长论文、脚注和公式密集页面待人工抽查                 |
| NVIDIA Developer Documentation | 文档/表格/代码保护与动态观察                                                            | NVIDIA/PyTorch-style fixture、站点规则                                                                   | 真实站登录态/交互式组件待人工抽查                        |
| Read the Docs                  | 通用文档规则、动态观察、代码/公式保护                                                   | 通用 fixture/规则                                                                                        | 不同主题 selector 与窄侧栏需逐站抽查                     |
| 同源 iframe                    | 扫描 iframe 文档；选区保留 frameId                                                      | segmenter 单元与 frame 路由契约                                                                          | Edge 原生右键菜单需人工执行一次                          |
| 跨源 iframe                    | 不绕过同源策略，计为 `unsupported`；选区可使用浏览器 context-menu 文本降级到 Side Panel | fallback 数据契约                                                                                        | 浮窗无法定位时的 Side Panel 路由需人工确认               |
| 开放 Shadow DOM                | 初扫和晚创建 root 均可观察；500 ms 防抖                                                 | 单元回归与真实 Edge MAIN-world late `attachShadow()` E2E                                                 | 站点自定义组件视觉冲突抽查                               |
| 闭合 Shadow DOM                | 明确 `unsupported`，不静默计入可翻译分母                                                | 诊断契约                                                                                                 | 浏览器安全边界，不承诺注入                               |
| Edge 内置 PDF                  | 不进行整页 DOM 改写；支持选区翻译/解释/追问和 PDF reader 入口                           | PDF fallback/入口 fixture                                                                                | 内置 viewer 的三种原生右键命令需人工确认                 |

## 通用注入边界

- 生产 Manifest 以 `activeTab` + `scripting` 按需注入，站点权限为 optional；test build 才固定加入 loopback、GitHub 与 PyTorch host permissions。
- `edge://`、扩展商店、浏览器内部页面和其他受保护页面禁止脚本注入，UI 必须显示不可注入/不支持原因。
- 用户更新扩展后，已经打开的旧标签页必须刷新，才能加载新版 content script；这仍是 GitHub/PyTorch“无法注入翻译脚本”最常见的安装态原因。
- 动态新增内容在首个 page job 已结束时创建新的 delta page job，不复用已封口任务；普通长页继续批次仍复用原逻辑 page job。
