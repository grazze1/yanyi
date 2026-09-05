# 浏览器端 UI 验收

> 截图位于 `docs/screenshots/`，均由 Playwright 在真实 Edge 中捕获。

## 1. Popup

| 项                   | 结论 | 证据                                                                  |
| -------------------- | ---- | --------------------------------------------------------------------- |
| 删除“术语库”大按钮   | 通过 | E2E 断言按钮数为 0                                                    |
| 删除“工作区”大按钮   | 通过 | 同上                                                                  |
| 删除“历史”大按钮     | 通过 | 同上                                                                  |
| 删除完整“设置”大按钮 | 通过 | `.secondary-nav` 数量为 0                                             |
| 主要操作明显         | 通过 | `edge-popup-preferences-150.png`：翻译此页面 / 打开侧边栏为底部主操作 |
| 高度更紧凑           | 通过 | 底部四按钮行与图钉按钮移除                                            |
| 不出现无效按钮       | 通过 | 见 `browser-interaction-audit.md`：每个控件都有行为或已删除           |
| 360–400 px 无溢出    | 通过 | E2E 断言 `scrollWidth ≤ clientWidth`（360 / 380 / 420 px）            |
| 溢出菜单             | 通过 | `edge-popup-overflow-menu-150.png`                                    |
| 侧边栏失败提示       | 通过 | 受限页面显示明确原因，不静默失败                                      |

截图：`edge-popup-offline-150.png`、`edge-popup-error-150.png`、`edge-popup-pdf-150.png`、
`edge-popup-scan-report-150.png`、`edge-popup-scan-report-125-420.png`、
`edge-popup-language-picker-150.png`、`edge-popup-preferences-150.png`、
`edge-popup-overflow-menu-150.png`。

## 2. 选区浮窗

| 项                     | 结论 | 证据                                                               |
| ---------------------- | ---- | ------------------------------------------------------------------ |
| 可拖                   | 通过 | E2E 真实鼠标拖动；`data-position-mode` 由 `anchored` → `manual`    |
| 可锚定                 | 通过 | 默认 anchored，滚动与缩放时重新定位                                |
| 恢复自动定位           | 通过 | E2E 点击后回到 anchored                                            |
| 拖动后不超出 viewport  | 通过 | E2E 断言四边均在视口内                                             |
| 拖动后输入框可用       | 通过 | E2E 拖动后填入文本并断言取值                                       |
| 已拖动后滚动保持位置   | 通过 | E2E 滚轮后坐标不变                                                 |
| 125% / 150% 缩放       | 通过 | 浮窗 E2E 在 150% 下运行；扫描报告 E2E 在 125% 下运行               |
| 不选中背后网页文字     | 通过 | 手柄 `touch-action: none` + `user-select: none` + `preventDefault` |
| 拖动区域不与输入框冲突 | 通过 | 仅 header 为手柄；header 内按钮 `pointerdown` 停止冒泡             |
| 鼠标与 pointer 事件    | 通过 | 统一使用 pointer 事件 + `setPointerCapture`                        |
| `Escape` 关闭          | 通过 | `SelectionPopover.test.tsx` + E2E                                  |
| 不破坏网页滚动         | 通过 | 仅手柄拦截手势；正文区域滚动不受影响                               |
| 可展开                 | 通过 | compact / expanded 切换，expanded 提供更大尺寸                     |
| compact 默认           | 通过 | 默认 compact，高级设置不默认塞入小窗                               |
| 不遮挡过多正文         | 通过 | 宽度 380（compact）/ 440（expanded），并按视口收缩                 |

截图：`edge-selection-popover-150.png`（锚定）、`edge-selection-popover-dragged.png`（拖动后）。

## 3. Side Panel

| 项                | 结论 | 证据                                                 |
| ----------------- | ---- | ---------------------------------------------------- |
| 同一 conversation | 通过 | 按 origin 恢复；浮窗展开走 handoff，不重新请求       |
| 新聊天明确        | 通过 | 两种模式都有按钮，并清除站点绑定                     |
| 模型可选          | 通过 | `edge-sidepanel-assistant-150.png`；未验证模型可选   |
| 输入框发送可用    | 通过 | E2E 断言可见；单测覆盖 Enter / Shift+Enter           |
| 历史切换可用      | 通过 | `conversation.site.active.set` 绑定为当前站点 active |
| 320 px 无溢出     | 通过 | E2E 断言 `scrollWidth ≤ clientWidth`                 |

## 4. 桌面端

| 项                                   | 结论 | 证据                                                                       |
| ------------------------------------ | ---- | -------------------------------------------------------------------------- |
| Memory Management 不再是 placeholder | 通过 | `desktop-global-memory-crud-125.png`                                       |
| 可真实 CRUD                          | 通过 | 新建 / 编辑 / 删除 / 启用禁用 / 固定；`desktop-global-memory-edit-125.png` |
| 可导入记忆                           | 通过 | `desktop-global-memory-import-125.png`，候选需逐条确认                     |
| 有 memory source 与 usage 信息       | 通过 | 列表显示来源、优先级、使用次数、最近使用时间                               |
| 稳定前缀可见                         | 通过 | 版本、指纹、固定条数与说明                                                 |

截图：`desktop-global-memory-crud-125.png`、`desktop-global-memory-edit-125.png`、
`desktop-global-memory-import-125.png`、`desktop-history-ledger-125.png`、
`desktop-model-catalog-125.png`。

## 5. 设计一致性

- 沿用既有 design tokens 与 CSS 变量，未引入新的 UI 库或第三方拖拽库（拖拽为自实现，约 60 行）。
- 保持精确开发者工具观感：边框优先于阴影，浅色主题，蓝色主强调色，无渐变与玻璃效果。
- 新增控件均提供可访问名称（`aria-label` / `aria-expanded` / `aria-pressed` / `role="status"`）。
- 快捷意图使用 `role="group"` 并带可访问名称。

## 6. 未覆盖项

- 完整 WCAG 合规需要人工使用辅助技术测试与专家评审，本轮只做了可访问名称、键盘可达性与角色标注的自查。
- 视觉回归基线未变更：本轮新增截图为新文件，未覆盖已有基线。
