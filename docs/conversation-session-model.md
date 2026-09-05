# 会话作用域模型

## 1. 目标

阅读会话属于**网站**，不属于单次选区。

```text
同一网站
  → 默认使用该网站当前 active conversation
  → 多次选区、多次询问都追加到同一聊天
  → 只有用户点击“新聊天”才创建新的 conversation
```

## 2. 站点的定义

`site_scope = URL origin = scheme + host + port`

不使用任何模糊字符串匹配。

| 页面                                                    | origin                                     |
| ------------------------------------------------------- | ------------------------------------------ |
| `https://developer.nvidia.com/blog/post-a?x=1#f`        | `https://developer.nvidia.com`             |
| `https://developer.nvidia.com/blog/post-b`              | `https://developer.nvidia.com`（同一站点） |
| `https://docs.pytorch.org/stable/`                      | `https://docs.pytorch.org`（不同站点）     |
| `http://example.com/a` vs `https://example.com/a`       | 不同（scheme 不同）                        |
| `https://example.com/a` vs `https://example.com:8443/a` | 不同（port 不同）                          |
| `about:blank`、`file://…`、`edge://settings`            | 无 origin，不参与站点作用域                |

实现：Rust `database::site_origin`，TypeScript `siteOriginOf`。两侧规则一致，且
Native Host **不信任**扩展传来的 `siteOrigin`——它会自行从 `context.url` 推导并比对，
不一致时按“无站点作用域”处理。这样页面内容无法把两个不相关网站合并到同一会话。

本轮不自动混合不同域名。未来可支持用户手动把多个域名绑定到一个工作区。

## 3. 会话选择逻辑

```text
询问研译
  ↓
new_chat == true ?
  ├─ 是 → 创建 conversation，绑定为该 origin 的 active
  └─ 否 → 读取该 origin 的 active conversation
          ├─ 存在（且状态为 active/legacy）→ 追加消息
          └─ 不存在 → 创建 conversation，绑定为该 origin 的 active
```

已归档（archived）或已删除的会话不会被当作 active 复用：
`active_conversation_for_site` 用 `JOIN conversations` 过滤状态。

## 4. 数据模型

迁移 `0005_site_scope_and_global_memory.sql`：

```sql
conversations
  + site_origin      -- 该会话所属站点
  + last_page_url    -- 最近一次使用的页面
  + last_page_title

site_active_conversations
  site_origin      PRIMARY KEY   -- 每个站点至多一个 active conversation
  conversation_id  → conversations(id) ON DELETE CASCADE
  knowledge_mode
  created_at / updated_at

message_contexts
  + page_url       -- 每条消息保存自己的页面上下文
  + page_title
  + site_origin
```

浏览器端存储也从单键改为按 origin 分键：

```text
旧：yanyi.assistant.active-conversation.v1          （单个全局引用）
新：yanyi.assistant.active-conversation-by-site.v1  （origin → 引用）
```

旧键在读取时被丢弃并删除：它的值无法归属到任何站点，保留会导致错误复用。
映射按 `savedAt` 倒序裁剪到最近 100 个站点，防止长期浏览无限增长。
存储内容只有 `conversationId` / `knowledgeMode` / `savedAt`，不含页面正文，也不含
完整 URL（完整 URL 可能带 token）。

## 5. 跨页面

用户从 `developer.nvidia.com/page-A` 跳转到 `developer.nvidia.com/page-B`：

- 仍使用同一 conversation。
- 每条消息保存自己的 `page_url` / `page_title` / `selection` / `section` / 来源片段 / 时间戳。
- `conversations.last_page_url` 只用于列表展示与恢复提示。

因此旧页面上下文不会被当作新页面的当前上下文：Prompt 中的
`<untrusted_page_context>` 始终来自本次请求，而不是会话级缓存。

## 6. 用户切换历史会话

打开某个历史 conversation 时，通过 `conversation.site.active.set` 把它设为当前站点
的 active conversation，直到用户选择另一个或点击“新聊天”。

## 7. “新聊天”

这是**唯一**结束当前站点会话的路径：

```text
新聊天
  → adapter.clearActiveConversation(pageUrl)
      ├─ 删除浏览器端该 origin 的引用
      └─ conversation.site.new → Host 删除 site_active_conversations 行
  → store.dispatch({ type: 'conversation.new' })
```

“新聊天”在 compact（浮窗）与完整（Side Panel）两种模式下都可见。审计前它被
`{!compact && …}` 隐藏，浮窗用户无法开始新会话。

## 8. 验证

`crates/database/tests/site_scope_and_memory.rs`：

- 同一 origin 连续 5 次询问 → 1 个 conversation。
- 之后点击“新聊天” → 2 个 conversation。
- 不同 origin 不共享 active conversation。
- 已归档会话不会被复用为 active。

`browserAssistantAdapter.test.ts`：

- 引用按 origin 存取；同站不同页面命中同一引用。
- 不同站点互不影响；无 origin 的页面不参与。
- `start` 请求携带 `siteOrigin`。
- 清除时通知 Host 开始新会话。

`ConversationPanel.test.tsx`：指针写入带页面 URL；“新聊天”触发清除。
