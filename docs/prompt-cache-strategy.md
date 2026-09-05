# Prompt 与缓存策略

## 1. 需求的正确理解

用户希望“提高缓存命中率，减少 API 消耗”。

这**不能**被理解为“把更多记忆塞进 Prompt”——那会增加 token，反而更贵。
正确做法是让 Prompt 中**可缓存的部分保持稳定**，并让重复输入命中本地缓存。

## 2. 三类缓存

### A. Provider 前缀缓存

DeepSeek 兼容 Provider 对相同前缀可复用。为提高命中率：

- System Prompt 文本稳定。
- 全局规则顺序稳定。
- 序列化稳定（固定小节顺序，条目按 `priority DESC, id ASC` 排序）。
- **不把 timestamp、随机 ID、使用计数放进稳定前缀**。
- 常用固定记忆形成版本化稳定前缀。
- 动态页面内容放到后部。

Prompt 分层：

```text
[稳定]
  System Prompt（角色 + 知识模式规则 + 不可信数据声明）
  <global_memory version="N">
    用户固定资料：…
    用户固定偏好：…
    回答风格与背景：…
  </global_memory>

[半稳定]
  <relevant_user_memory>  ← 本次检索出的少量相关记忆
  （会话摘要，沿用既有 conversation_summaries）

[动态]
  <conversation_history>
  <untrusted_page_context>   ← 当前页面、当前选区
  用户当前请求
```

小节顺序由 `stable_memory_prefix` 固定，测试断言
`用户固定资料 < 用户固定偏好 < 回答风格与背景`。

### B. 本地结果缓存

翻译缓存键（沿用既有实现）：

```text
source text + role + page domain + glossary version + model + prompt version
```

相同输入优先命中本地翻译缓存，不再请求 API。
术语库版本变化会使缓存失效，因此确认新译法后不会继续返回旧译文。

### C. 记忆检索缓存

短时间内相似查询可复用检索结果。本轮的检索本身是本地 SQLite FTS5 查询，
不产生 API 调用，因此缓存收益是延迟而非费用；实现上以“同一请求内只检索一次”
为界，避免同一次回答中重复检索。

## 3. 稳定记忆快照

```sql
global_memory_snapshots
  version               PRIMARY KEY，单调递增
  fingerprint           UNIQUE，内容指纹
  stable_profile
  stable_preferences
  stable_response_style
  memory_count
  is_current            仅一行为 1（部分唯一索引保证）
  created_at
```

行为：

- 只有用户修改相关记忆（新建 / 编辑 / 删除 / 启用 / 禁用 / 固定 / 导入确认）时才重建。
- 重建时保留历史行，因此 `version` 不会被回收重用。
- 指纹相同则**复用原有 version**：把记忆改回旧状态时，前缀与其缓存键一并回到旧值。
- 读取走 `WHERE is_current = 1`，是一次索引命中，不需要每次重算指纹。

指纹算法：FNV-1a 64 位，逐小节喂入并插入分隔字节，因此
`["ab", ""]` 与 `["a", "b"]` 不会碰撞（有单测断言）。

## 4. 不为缓存牺牲正确性

明确不做：

- 为保持 Prompt 完全相同而省略必要上下文。
- 无条件注入所有记忆。
- 复用已经过期的网页上下文（每条消息保存自己的 `page_url`，跨页面续聊不复用旧页面上下文）。
- 因缓存命中而忽略术语库版本变化。

翻译任务不注入相关记忆检索结果，避免个人偏好污染精确译文；固定记忆仍在稳定前缀中，
因为那是用户明确声明始终适用的内容。

## 5. Token 与 API 优化来源

| 措施                             | 效果                          |
| -------------------------------- | ----------------------------- |
| 只注入相关记忆（默认 ≤ 5 条）    | 避免整库注入带来的 token 膨胀 |
| 稳定前缀不含易变值               | 提高 Provider 前缀缓存命中率  |
| 固定记忆与检索记忆分层           | 前缀稳定的同时保留任务相关性  |
| 翻译本地缓存                     | 相同段落零 API 调用           |
| 能力验证仅用户触发且单次最小请求 | 不产生批量计费探测            |
| 未验证模型使用安全默认参数       | 避免因参数被拒而重试          |
| 会话按站点复用                   | 减少重复上下文重建            |

## 6. 测试

- `fingerprint_is_deterministic_and_order_sensitive`（单测）。
- `snapshot_is_deterministic_and_only_changes_when_memories_change`（集成）：重复读取字节相同；记录使用不改变快照；编辑固定记忆后指纹与版本都变化。
- `stable_memory_prefix_is_deterministic_and_free_of_volatile_values`（native-host）：无 `taskId` / `capturedAt`，小节顺序固定。
- `an_empty_memory_library_contributes_nothing_to_the_prompt`：空库时 System Prompt 与基线完全一致。
- `relevant_memory_is_placed_after_the_stable_prefix_not_inside_it`：检索结果位于页面上下文之前、稳定前缀之后；无结果时整块消失。
- 既有 `translation_cache_and_task_state_are_durable` 覆盖翻译缓存与术语版本失效。
