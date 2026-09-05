# 记忆导入

## 1. 原则

**禁止**：上传一个文件 → 模型自动把所有内容无审核写入永久记忆。

导入只产生候选，必须逐条确认后才会保存。

## 2. 流程

```text
用户选择文件
  ↓ 校验扩展名与大小（≤ 512 KiB）
读取文本（必须是合法 UTF-8）
  ↓ 解析为候选
预览（桌面端逐条列出，含类型、内容、重复提示、术语库建议）
  ↓ 用户逐条勾选
确认 → 仅写入被勾选的候选
放弃 → 不写入任何记忆
```

对应命令：

- `global_memory_import_preview(path, defaultType)` → 解析并落库为 `pending` 候选，返回预览。
- `global_memory_import_apply(jobId, acceptedIds)` → 只写入 `acceptedIds`，其余标记 `rejected`。
- `global_memory_import_discard(jobId)` → 全部标记 `rejected`，作业状态 `discarded`。

未勾选的候选一律标记 `rejected`，因此“漏点确认”不会导致意外写入。

## 3. 支持格式

首版支持 `.txt`、`.md`、`.json`（`.markdown` 视为 `.md`）。
未知扩展名直接拒绝，不做内容猜测，避免把二进制文件当文本解析。

本轮不加入 PDF 解析：现有 PDF 能力面向阅读与选区翻译，为导入强行加入复杂 OCR
不符合“最小连贯改动”。

### 3.1 TXT

每个非空行一条记忆，使用界面选择的默认类型。自动去掉列表符号（`-`、`*`、`+`、`•`、`1. `）。

### 3.2 Markdown

在 TXT 规则之上，用标题推断类型并作为候选标题：

| 标题包含               | 类型                     |
| ---------------------- | ------------------------ |
| 翻译偏好 / translation | `translation_preference` |
| 回答风格 / response    | `response_style`         |
| 个人资料 / profile     | `profile`                |
| 背景 / domain          | `domain_background`      |
| 语境 / context         | `personal_context`       |
| 偏好 / preference      | `preference`             |

匹配表按**从具体到宽泛**排序，因此“翻译偏好”不会被“偏好”先命中。

### 3.3 JSON

需要 Schema 验证，格式为：

```json
{
  "memories": [
    { "type": "profile", "content": "我是机器人方向学生" },
    { "type": "translation_preference", "content": "框架名默认保留英文" }
  ]
}
```

- 缺少 `memories` 数组 → `InvalidJson`。
- `type` 不在七种类型中 → `UnsupportedType`，整份文件拒绝（不静默丢弃条目）。
- `title` 可选。

## 4. 限制与校验

| 约束     | 值             | 原因                          |
| -------- | -------------- | ----------------------------- |
| 文件大小 | 512 KiB        | 防止一次粘贴产生上千候选      |
| 候选数量 | 200            | 同上                          |
| 单条内容 | 4 000 字符     | 与 `global_memories` 上限一致 |
| 标题     | 200 字符       | —                             |
| 编码     | UTF-8          | 非 UTF-8 直接拒绝             |
| 路径     | 必须是真实文件 | 目录或不存在的路径被拒绝      |

大小在读取**之前**通过 `std::fs::metadata` 校验，不会先把超大文件读进内存。

## 5. 重复处理

创建作业时，每个候选都会与现有 `global_memories` 比对
`(type, normalized_content)`：

- 命中已有记忆 → 候选状态直接标记 `duplicate`，界面禁用勾选并说明“已存在，不会重复写入”。
- 即使调用方强行把 duplicate 传入 `acceptedIds`，写入语句仍带
  `ON CONFLICT(type, normalized_content) DO NOTHING`，因此数据库层面也不会产生第二份。

## 6. 术语库建议

候选若形如“X 固定翻译为 Y”，`glossary_hint` 置 1，界面提示改存术语库。
这只是建议，用户仍可选择保存为记忆。

## 7. 导出

`global_memory_export` 输出与导入相同形状的 JSON，便于备份与迁移：

```json
{ "memories": [{ "type": "...", "title": "...", "content": "..." }] }
```

桌面端“导出全部”把 JSON 复制到剪贴板，用户自行保存到文件。

## 8. 测试

`crates/database/src/memory_import.rs` 单测：

- 扩展名识别与拒绝。
- TXT 逐行、Markdown 标题分类、JSON Schema 校验。
- 术语规则标记。
- 重复行折叠。
- 超大、非 UTF-8、空内容拒绝。
- 未知默认类型回落到 `custom`。

`crates/database/tests/site_scope_and_memory.rs`：

- 导入后未确认时 `global_memories` 为空。
- 仅确认一条时只写入一条，另一条标记 `rejected`。
- 已存在内容标记 `duplicate`，全选也只写入新的那条。
- 放弃导入不写入任何记忆。

`apps/desktop/src/desktopApi.test.ts`：预览与确认是两步，写入必须携带明确的候选 ID 列表。
