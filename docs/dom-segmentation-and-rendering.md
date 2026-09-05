# DOM 分段与可逆渲染

- 候选：h1–h6、p、li、blockquote、figcaption、caption、th、td、dt、dd。
- 排除：隐藏、编辑器、输入控件、script/style、pre/code、扩展自有节点、纯数字/标点/URL/路径和过短文本。
- ID：`pageSessionId:ordinal:part:normalizedSourceHash`；优先级按当前视口计算。
- 文本以 800 字符为目标、1200 为硬上限；页面上限为 160 段/96,000 字符。
- 占位符形如 `__YANYI_CODE_0__`，输出必须完整且原序匹配。无效输出不会写 DOM。
- 翻译容器只以 `data-yanyi-owned="translation"` 注入；replace 模式只隐藏源块的呈现，不覆盖源文本；below/bilingual 保留源文；restore 可重复调用。

MutationObserver 忽略本扩展容器，只将外部修改标记为 stale。渲染前还校验原节点指纹。翻译文本不使用 `innerHTML`；可恢复片段只使用文本节点和保护节点克隆。
