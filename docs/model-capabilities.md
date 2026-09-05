# 模型能力与验证

## 1. 审计前的问题

“未经验证的模型无法选择”。链路上有两处硬锁：

1. 前端 `ConversationPanel.persist` 要求 `availability === 'available'`，而
   `fallbackModelCatalog()` 与迁移种子行给出的是 `availability: 'unknown'`。
2. Native Host `reject_unavailable_model` 把
   `availability.is_none() && !known_official` 当作拒绝理由。

结果：任何未刷新过 `/models` 的模型，以及任何非官方基线模型，都被永久锁死，
且 UI 只显示“不可用 / 状态未验证”，用户没有任何手段解锁。

## 2. 四态语义

“未经验证”是**状态提示**，不是永久封锁。

| 状态          | 含义                                        | 可否选择           | UI                           |
| ------------- | ------------------------------------------- | ------------------ | ---------------------------- |
| `verified`    | 已确认基本调用与能力                        | 可                 | 无角标                       |
| `unverified`  | 尚未验证                                    | **可**             | `· 未验证`，并提供“验证模型” |
| `unsupported` | 已确认不支持**某项能力**                    | 可（仅禁用该能力） | `思考模式：不支持`           |
| `unavailable` | 模型不存在 / Provider 不可达 / 被服务端拒绝 | 不可               | `· 不可用` + 原因            |

只有 `unavailable` 会阻断请求。研译在任何状态下都不会静默切换模型或供应商。

实现：`entrypoints/assistant/modelCapability.ts`（纯函数，14 项单测）。

## 3. 能力的三值表示

数据库中能力列可为 NULL，用来区分“未检查”与“已确认不支持”：

```text
supports_thinking = 1     → supported
supports_thinking = 0     → unsupported（已确认）
supports_thinking = NULL  → unknown（从未检查）
```

`thinkingSupport()` 据此返回 `supported | unsupported | unknown`。
审计前的代码把 `!== true` 一律视为不支持，把 unknown 误报成 unsupported。

## 4. 推理强度

- 仅在模型有已记录的 `reasoning_efforts` 时显示。
- 能力未知时不伪装成“不支持”，而是显示 `思考模式：未验证` 并提供验证入口。
- `unsupported` 时隐藏强度选择。

## 5. 安全默认参数

Native Host `safe_profile_for_model`：

```text
请求未启用思考         → 原样发送
已验证且支持思考       → 原样发送
已验证但不支持思考     → 去掉 thinking/effort，提示“不支持，本次仅关闭该能力”
未验证                 → 去掉 thinking/effort，提示“尚未验证，使用安全默认参数”
```

模型标识本身从不被替换。提示通过 `assistant.accepted` 的 `capabilityNotice` 回传，
界面可以解释发生了什么，而不是静默降级。

## 6. 用户主动验证

协议：`model.capability.verify` → `model.capability.verified`。

- 只在用户点击“验证模型”时执行，**不做批量探测**，不会偷偷产生大量计费请求。
- 一次最小请求：`max_output_tokens = 16`，极短 system/user 文本。
- 仅在思考能力未知时才附带思考参数（`probeThinking`），因为该探测更贵。
- API Key 始终留在 Host 侧，不进入扩展。

结果写回 `model_catalog`，且只写本次真正观察到的能力：

| 结果                   | availability  | capability_status | supports_thinking  |
| ---------------------- | ------------- | ----------------- | ------------------ |
| 成功                   | `available`   | `verified`        | 本次是否探测了思考 |
| 思考探测被拒且不可重试 | `available`   | `verified`        | `0`（确认不支持）  |
| 其他失败               | `unavailable` | `unverified`      | 不变               |

`record_model_verification` 用 `COALESCE` 保护未探测的能力列，因此一次流式验证
不会顺带断言工具调用能力。

## 7. 模型配置字段

`model_catalog`（迁移 0004 建表，本轮沿用）：

```text
provider_id / model_id / owner
availability            available | unavailable | unknown
capability_status       verified | unverified | manual
supports_thinking       NULL | 0 | 1
reasoning_efforts_json
supports_streaming      NULL | 0 | 1
supports_json_output    NULL | 0 | 1
supports_tools          NULL | 0 | 1
context_window          nullable
metadata_json           记录来源（official_adapter_seed / models_endpoint / user_verification）
last_seen_at / created_at / updated_at
```

能力不硬编码在页面组件中：前端只消费目录记录，`modelCapability.ts` 负责语义。
`/models` 只提供 ID / owner / 可达性，不会覆盖已审核的 `verified` / `manual` 能力
（`upsert_model_catalog` 中的 `CASE WHEN … IN ('verified','manual')`）。

## 8. 选择优先级

```text
单次请求 > 当前 conversation > 当前任务类型默认 > API Profile 默认
```

`model_selection_state` 以 `(scope, scope_id, task)` 为主键，scope 为
`conversation | task | global`。`requestScopedModelSelection` 在发送时按此顺序解析。

任务类型：`page_translation`、`selection_translation`、`chat`、`summary`、
`memory_extraction`（库中对应 `whole_page_translation`、
`selected_precise_translation`、`deep_follow_up`、`explanation`、`term_disambiguation`、
`candidate_extraction` 等 task 键）。

任务预设只是**默认值**：用户可在任何任务上选择任意可用模型，不存在“翻译必须模型 A、
询问必须模型 B”的硬绑定。

## 9. 测试

- `modelCapability.test.ts`：四态判定、可选性、unknown vs unsupported、强度可见性、发送门禁。
- `ConversationPanel.test.tsx`：未验证模型可选、被拒模型不可选、验证按钮参数正确。
- `native-host` 单测：`safe_profile_for_model` 的四种分支。
- `database` 单测：`model_catalog_preserves_verified_capabilities_and_selection_precedence`。
