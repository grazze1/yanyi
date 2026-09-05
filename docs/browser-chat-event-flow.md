# 浏览器问答事件流

> 本轮 P0：桌面后台已经产生回答，浏览器浮窗仍停在“正在读取当前上下文…”。

## 1. 根因

`background.ts` 使用 `browser.runtime.sendMessage` 广播 assistant 事件：

```text
Native Host → service worker → runtime.sendMessage → ???
```

`runtime.sendMessage` 的投递范围是**扩展页面**：Popup、Side Panel、Options。
它**不会**到达 content script。要到达 content script 必须使用
`browser.tabs.sendMessage(tabId, message, { frameId })`。

选区浮窗通过 `mountSelectionPopover` 挂载在网页的 Shadow DOM 中，属于 content
script。因此：

- 桌面端能看到回答（Native Host 自己写库并输出日志）。
- Side Panel 能看到回答（扩展页面）。
- 浮窗收不到任何 `assistant.*` 事件，`status` 永远停在 `sending`，UI 永远显示初始文案。

这解释了为什么“后台已经有回答，浏览器却一直读取上下文”，也解释了为什么同一个
回答在 Side Panel 正常、在浮窗不正常。

## 2. 修复

新增 `entrypoints/assistant/assistantEventRouting.ts`，把“一个事件要送到哪些界面”
变成纯函数，并在 `background.ts` 中为每个 task 记录来源：

```text
yanyi.assistant.start
  ↓ 记录 { tabId, frameId }（来自 sender.tab / sender.frameId，
    或 Side Panel 场景下的 context.tabId）
assistantTaskIds: Map<taskId, AssistantTaskOrigin>

Native Host 事件
  ↓ broadcastAssistantEvent(taskId, event)
  ├─ runtime.sendMessage  → Popup / Side Panel / Options
  └─ tabs.sendMessage     → 来源 tab/frame 的 content script（浮窗）
```

要点：

- 终态事件（`completed` / `failed` / `cancelled`）**先广播再删除来源记录**，否则终态事件会丢失来源而无法送达浮窗。
- `assistant.cancel` 不立即删除来源，等 Host 回 `assistant.cancelled` 后再删除。
- Native Host 断开时，所有在飞 task 合成 `assistant.failed` 并按同一路径广播，浮窗不会卡死。

## 3. 请求生命周期

统一状态机（`lifecyclePhaseForEvent`）：

```text
idle
  → request_queued     (assistant.accepted)
  → context_collecting (assistant.context.ready，预留)
  → streaming          (assistant.delta)
  → completed          (assistant.completed)
  → failed             (assistant.failed)
  → cancelled          (assistant.cancelled)
```

每个事件都携带 `taskId`；`conversationId` 由 Host 在 `accepted` 与 `completed` 中回传。
浮窗、Side Panel 与 Popup 读取同一份状态语义，不再各自推断。

UI 文案随阶段变化，避免“读取上下文”成为万能兜底：

| 消息状态                               | 文案                |
| -------------------------------------- | ------------------- |
| `sending`（尚未收到 accepted / delta） | 正在读取当前上下文… |
| `streaming` 且内容为空                 | 正在生成回答…       |
| `streaming` 且有内容                   | 直接渲染 Markdown   |

## 4. 迟到事件与重复消费

- `applyAssistantStreamEvent` 在 `accepted` 时校验 `activeAssistantMessageId`，并拒绝与当前 `activeTaskId` 不一致的事件。
- `stream.delta` 要求 `state.activeTaskId === action.taskId`，因此旧 task 的 delta 不会写入新消息。
- `messageIdForTask` 按 `taskId` 定位消息，终态事件即使迟到也只会作用于自己的消息。
- Host 端保留最近 64 条终态事件（`assistantTerminalEvents`）；`loadTerminalEvent` 让在事件投递之后才订阅的界面仍能结算，避免 Port 重连后永久 pending。

## 5. 跨界面一致性

浮窗“展开到 Side Panel”不会重新请求：

```text
浮窗 → saveHandoff(conversationId, messages, activeTaskId, modelSelection)
     → sidePanel.open()
Side Panel → loadHandoff() → handoff.hydrate
           → 若 activeTaskId 存在，用 loadTerminalEvent 结算已完成的回答
```

因此展开时既不会丢失正在生成的回答，也不会重复计费。

## 6. 测试

- `assistantEventRouting.test.ts`：投递目标解析、来源归属、生命周期映射、终态识别（10 项）。
- `ConversationPanel.test.tsx`：accepted / delta / completed / failed / cancelled 的 store 行为，迟到事件过滤。
- E2E `Edge selection popover …`：浮窗在真实 Shadow DOM 中渲染并可交互。
- `pnpm test:native-host:translation`：Mock SSE 下 Host 端 assistant 事件序列完整。
