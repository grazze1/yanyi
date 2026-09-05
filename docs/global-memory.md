# 全局记忆

## 1. 定位

三者不能混在一起：

| 模块         | 解决的问题                                         |
| ------------ | -------------------------------------------------- |
| 术语库       | 某个词应该怎么翻译                                 |
| 工作区       | 某个项目/主题下有哪些文档和上下文                  |
| **全局记忆** | 用户是谁、偏好什么、希望模型如何回答、长期技术背景 |

审计前 `memories` 表只承载会话派生内容（自动摘要、候选事实），桌面“记忆管理”只能
列出与确认候选，无法新建、编辑、删除或导入。本轮新增 `global_memories` 承载用户
主动维护的全局记忆，原有表与数据保持不变。

## 2. 记忆类型

```text
profile                 我是飞行器设计与工程专业本科生。
preference              专业软件名称默认保留英文。
response_style          技术回答优先解释原理，再给实施步骤。
domain_background       熟悉 Python、ROS 2、PX4 和 Isaac Lab。
translation_preference  框架名默认保留英文。
personal_context        我也在研究细胞培养与显微成像流程。
custom                  其他。
```

若内容实际上是严格术语规则（例如 `reinforcement learning 固定翻译为强化学习`），
导入审阅界面会提示“这更像术语规则，建议改为保存到术语库”，避免重复存储。
判定见 `looks_like_glossary_rule`。

## 3. 作用域

全局记忆默认跨网站、跨 conversation、跨工作区。

但**不会**每次把所有记忆全文塞进 Prompt——那会增加 token，而不是减少：

```text
全局记忆库
  ↓ 相关性检索（FTS5 + 结构化过滤）
只选择与当前任务相关的记忆（默认上限 5 条）
  ↓
注入 Prompt
```

示例：用户记忆包含机器人方向背景与细胞培养经历。询问 ROS / Isaac Lab 时只注入前者；
阅读完全无关的网页时两者都不注入（除非被用户固定）。

## 4. 数据模型

```sql
global_memories
  id / type / title / content
  normalized_content   -- 折叠大小写与空白，用于去重与检索
  enabled              -- 禁用的记忆永不注入
  pinned               -- 固定：始终参与，并构成稳定 Prompt 前缀
  priority             -- -100..100
  source_type          manual | import | conversation | candidate
  source_id
  created_at / updated_at / last_used_at / usage_count

  UNIQUE(type, normalized_content)   -- 同类型同内容只能存在一条

global_memory_tags / global_memory_tag_links
global_memories_fts                  -- FTS5，由触发器保持同步
global_memory_import_jobs / global_memory_candidates
global_memory_snapshots              -- 版本化稳定前缀
```

FTS5 通过 `AFTER INSERT / UPDATE / DELETE` 三个触发器同步，迁移测试验证了插入、
修改后旧词失效、删除后不再命中。

## 5. CRUD

桌面“记忆管理 → 全局记忆”提供：

新建、编辑、删除、启用/禁用、固定、搜索、按类型分类、来源展示、
作用域说明、最后使用时间与使用次数、导入、导出。

Tauri 命令：`global_memory_list` / `create` / `update` / `set_enabled` /
`set_pinned` / `delete` / `tags` / `import_preview` / `import_apply` /
`import_discard` / `import_jobs` / `export` / `snapshot`。

重复内容会被拒绝（`GlobalMemoryError::Duplicate`），因此稳定前缀不会累积重复文本。

## 6. 检索策略

首版使用已有的 SQLite FTS5，不引入向量数据库，也不引入大型 embedding 模型。

```text
当前问题 + 选区 + 页面标题/小节 + 技术标签 + 领域
  ↓ 分词并逐词加引号（页面文本无法注入 FTS 运算符）
FTS5 MATCH（词之间 OR）+ enabled=1 过滤
  ↓ bm25 排序
候选 memory
  ↓ 评分：pinned / priority / type 权重 / FTS 名次
选出少量高相关记忆（默认 5 条）
```

评分要点：

- `pinned` 记忆无条件参与（用户已声明其始终适用），并获得高基准分。
- 类型权重：`profile` / `response_style` > `preference` / `translation_preference` > `domain_background` > 其他。
- `enabled = 0` 永不返回。
- 翻译任务（`intent == "translate"`）不做检索，避免个人偏好干扰精确译文。

安全：`fts_query` 对每个词加引号并剔除内部引号，页面正文中的 `OR`、`NEAR(` 等
只会被当作普通词，不会成为 FTS 运算符。

## 7. 注入位置

```text
[稳定]    System Prompt + 产品规则
          <global_memory version="N">  ← 仅 pinned，顺序固定
[半稳定]  <relevant_user_memory>       ← 本次检索结果
[动态]    <conversation_history>
          <untrusted_page_context>
          用户当前请求
```

稳定部分只在用户修改相关记忆时变化，因此可被 Provider 前缀缓存命中；
检索结果随问题变化，放在其后。详见 `prompt-cache-strategy.md`。

## 8. 隐私

用户主动保存的内容可能包含个人资料，因此：

- 默认只保存在本机 SQLite（`global_memories`）。
- 桌面端明确显示存储位置与统计信息。
- 提供删除（单条）与导出（全部，JSON）。
- 可通过“禁用”停止任何单条记忆参与 Prompt。
- 只上传相关部分，不上传全部记忆。
- 日志不记录记忆正文。

## 9. 使用统计与缓存的关系

`mark_global_memories_used` 会累加 `usage_count` 并更新 `last_used_at`。
这两列**不参与**快照指纹计算，因此使用统计不会让稳定前缀在每次请求后失效。
迁移测试与集成测试都对此做了断言。

## 10. 测试

`crates/database/tests/site_scope_and_memory.rs`：

- 完整 CRUD 与重复拒绝。
- 相关记忆注入、无关记忆不注入、禁用记忆不注入。
- pinned 记忆在无关查询下仍参与。
- 使用统计不影响快照。

`crates/database/src/global_memory.rs` 单测：归一化、术语规则识别、FTS 查询转义、指纹确定性。
