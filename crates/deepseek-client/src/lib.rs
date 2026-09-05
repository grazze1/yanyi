use std::collections::HashSet;
use std::fmt;
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::{Client, StatusCode, redirect::Policy};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::watch;
use url::{Host, Url};

pub const DEFAULT_BASE_URL: &str = "https://api.deepseek.com";
pub const MAX_MODEL_LIST_BYTES: usize = 1024 * 1024;
pub const MAX_STREAM_BUFFER_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_AGENT_MESSAGES: usize = 64;
pub const MAX_AGENT_TOOLS: usize = 16;
pub const MAX_TOOL_ARGUMENT_BYTES: usize = 8 * 1024;
pub const MAX_TOOL_RESULT_BYTES: usize = 128 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReasoningEffort {
    High,
    Max,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThinkingMode {
    Enabled,
    Disabled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskPreset {
    pub id: String,
    pub task: String,
    pub model: String,
    pub thinking: ThinkingMode,
    pub reasoning_effort: Option<ReasoningEffort>,
    pub max_output_tokens: u32,
    pub timeout_ms: u64,
    pub streaming: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelCapabilities {
    pub model: String,
    pub capability_status: CapabilityStatus,
    pub supports_thinking: bool,
    pub reasoning_efforts: Vec<ReasoningEffort>,
    pub supports_streaming: bool,
    pub supports_json_output: bool,
    pub supports_tools: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CapabilityStatus {
    Verified,
    Unverified,
}

pub fn model_capabilities(model: &str) -> ModelCapabilities {
    let verified_official_model = matches!(model, "deepseek-v4-flash" | "deepseek-v4-pro");
    ModelCapabilities {
        model: model.to_owned(),
        capability_status: if verified_official_model {
            CapabilityStatus::Verified
        } else {
            CapabilityStatus::Unverified
        },
        supports_thinking: verified_official_model,
        reasoning_efforts: if verified_official_model {
            vec![ReasoningEffort::High, ReasoningEffort::Max]
        } else {
            Vec::new()
        },
        supports_streaming: verified_official_model,
        supports_json_output: verified_official_model,
        supports_tools: verified_official_model,
    }
}

pub fn default_task_presets() -> Vec<TaskPreset> {
    [
        (
            "whole-page",
            "whole_page_translation",
            "deepseek-v4-flash",
            ThinkingMode::Disabled,
            None,
            4_096,
            60_000,
            true,
        ),
        (
            "selected",
            "selected_precise_translation",
            "deepseek-v4-pro",
            ThinkingMode::Disabled,
            None,
            4_096,
            60_000,
            true,
        ),
        (
            "term",
            "term_disambiguation",
            "deepseek-v4-pro",
            ThinkingMode::Enabled,
            Some(ReasoningEffort::High),
            4_096,
            90_000,
            false,
        ),
        (
            "explain",
            "explanation",
            "deepseek-v4-pro",
            ThinkingMode::Enabled,
            Some(ReasoningEffort::High),
            8_192,
            90_000,
            true,
        ),
        (
            "follow-up",
            "deep_follow_up",
            "deepseek-v4-pro",
            ThinkingMode::Enabled,
            Some(ReasoningEffort::Max),
            16_384,
            120_000,
            true,
        ),
        (
            "candidates",
            "candidate_extraction",
            "deepseek-v4-flash",
            ThinkingMode::Disabled,
            None,
            4_096,
            60_000,
            false,
        ),
        (
            "summary",
            "conversation_summary",
            "deepseek-v4-flash",
            ThinkingMode::Disabled,
            None,
            4_096,
            60_000,
            false,
        ),
        (
            "memory",
            "memory_extraction",
            "deepseek-v4-flash",
            ThinkingMode::Disabled,
            None,
            4_096,
            60_000,
            false,
        ),
    ]
    .into_iter()
    .map(
        |(
            id,
            task,
            model,
            thinking,
            reasoning_effort,
            max_output_tokens,
            timeout_ms,
            streaming,
        )| TaskPreset {
            id: id.to_owned(),
            task: task.to_owned(),
            model: model.to_owned(),
            thinking,
            reasoning_effort,
            max_output_tokens,
            timeout_ms,
            streaming,
        },
    )
    .collect()
}

#[derive(Clone)]
pub struct DeepSeekConfig {
    pub base_url: Url,
    api_key: String,
    pub timeout: Duration,
    pub first_token_timeout: Duration,
    pub proxy_url: Option<Url>,
}

impl fmt::Debug for DeepSeekConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DeepSeekConfig")
            .field("base_url", &self.base_url)
            .field("api_key", &"[REDACTED]")
            .field("timeout", &self.timeout)
            .field("first_token_timeout", &self.first_token_timeout)
            .field("proxy_url", &self.proxy_url)
            .finish()
    }
}

impl DeepSeekConfig {
    pub fn new(base_url: &str, api_key: impl Into<String>) -> Result<Self, ClientError> {
        let base_url = Url::parse(base_url).map_err(ClientError::InvalidBaseUrl)?;
        let is_loopback = match base_url.host() {
            Some(Host::Ipv4(address)) => address.is_loopback(),
            Some(Host::Ipv6(address)) => address.is_loopback(),
            Some(Host::Domain(domain)) => domain.eq_ignore_ascii_case("localhost"),
            None => false,
        };
        if base_url.scheme() != "https" && !is_loopback {
            return Err(ClientError::InsecureBaseUrl);
        }
        let api_key = api_key.into();
        if api_key.trim().is_empty() {
            return Err(ClientError::MissingApiKey);
        }
        Ok(Self {
            base_url,
            api_key,
            timeout: Duration::from_secs(60),
            first_token_timeout: Duration::from_secs(30),
            proxy_url: None,
        })
    }

    pub fn with_timeouts(mut self, first_token: Duration, total: Duration) -> Self {
        self.first_token_timeout = first_token;
        self.timeout = total;
        self
    }

    pub fn with_proxy(mut self, proxy_url: Option<&str>) -> Result<Self, ClientError> {
        self.proxy_url = proxy_url
            .map(Url::parse)
            .transpose()
            .map_err(ClientError::InvalidProxyUrl)?;
        self.proxy_url
            .as_ref()
            .map(validate_remote_url)
            .transpose()?;
        Ok(self)
    }
}

pub type ProviderConfig = DeepSeekConfig;

#[derive(Debug, Error)]
pub enum ClientError {
    #[error("DeepSeek API key is missing")]
    MissingApiKey,
    #[error("DeepSeek base URL is invalid: {0}")]
    InvalidBaseUrl(url::ParseError),
    #[error("DeepSeek proxy URL is invalid: {0}")]
    InvalidProxyUrl(url::ParseError),
    #[error("DeepSeek base URL must use HTTPS unless it targets loopback")]
    InsecureBaseUrl,
    #[error("DeepSeek request was cancelled")]
    Cancelled,
    #[error("DeepSeek request timed out")]
    Timeout,
    #[error("DeepSeek returned HTTP {status}")]
    HttpStatus {
        status: StatusCode,
        retry_after_ms: Option<u64>,
    },
    #[error("DeepSeek streaming response ended before [DONE]")]
    EarlyClose,
    #[error("DeepSeek SSE stream is malformed")]
    InvalidSse,
    #[error("DeepSeek response exceeded the configured size limit")]
    ResponseTooLarge,
    #[error("the selected model has no verified tool-calling capability")]
    ToolsUnsupported,
    #[error("the tool-enabled chat request is invalid")]
    InvalidAgentRequest,
    #[error("DeepSeek returned a malformed tool call")]
    InvalidToolCall,
    #[error("DeepSeek SSE JSON is malformed")]
    InvalidSseJson(#[from] serde_json::Error),
    #[error("DeepSeek request failed: {0}")]
    Request(#[from] reqwest::Error),
}

impl ClientError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::MissingApiKey => "api_key_missing",
            Self::Cancelled => "cancelled",
            Self::Timeout => "timeout",
            Self::HttpStatus { status, .. } if *status == StatusCode::UNAUTHORIZED => {
                "api_auth_failed"
            }
            Self::HttpStatus { status, .. } if *status == StatusCode::PAYMENT_REQUIRED => {
                "api_balance_insufficient"
            }
            Self::HttpStatus { status, .. } if *status == StatusCode::TOO_MANY_REQUESTS => {
                "api_rate_limited"
            }
            Self::HttpStatus { .. } => "api_request_failed",
            Self::EarlyClose | Self::InvalidSse | Self::InvalidSseJson(_) => "api_stream_invalid",
            Self::ToolsUnsupported => "api_tools_unsupported",
            Self::InvalidAgentRequest => "api_agent_request_invalid",
            Self::InvalidToolCall => "api_tool_call_invalid",
            _ => "api_network_failed",
        }
    }

    pub fn retryable(&self) -> bool {
        matches!(
            self,
            Self::Timeout
                | Self::Request(_)
                | Self::EarlyClose
                | Self::HttpStatus {
                    status: StatusCode::TOO_MANY_REQUESTS
                        | StatusCode::INTERNAL_SERVER_ERROR
                        | StatusCode::SERVICE_UNAVAILABLE,
                    ..
                }
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Model {
    pub id: String,
    pub object: String,
    pub owned_by: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ModelList {
    pub object: String,
    pub data: Vec<Model>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamEvent {
    Delta(String),
    Usage(StreamUsage),
    Done,
}
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct StreamUsage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
}

#[derive(Clone, PartialEq, Eq)]
pub struct ToolChainId(String);

impl ToolChainId {
    pub fn new(value: impl Into<String>) -> Result<Self, ClientError> {
        let value = value.into();
        if value.trim().is_empty()
            || value.chars().count() > 128
            || !value
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || "_-.:/".contains(character))
        {
            return Err(ClientError::InvalidAgentRequest);
        }
        Ok(Self(value))
    }
}

impl fmt::Debug for ToolChainId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ToolChainId([REDACTED])")
    }
}

/// Hidden model reasoning that can only be carried forward by the in-memory
/// agent types in this crate. It deliberately implements neither `Serialize`
/// nor `Deserialize`, so application persistence cannot accidentally include it.
#[derive(Clone, PartialEq, Eq)]
pub struct EphemeralReasoningContent {
    chain_id: ToolChainId,
    value: String,
}

impl fmt::Debug for EphemeralReasoningContent {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("EphemeralReasoningContent([REDACTED])")
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ChatToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

impl ChatToolDefinition {
    pub fn new(
        name: impl Into<String>,
        description: impl Into<String>,
        parameters: serde_json::Value,
    ) -> Self {
        Self {
            name: name.into(),
            description: description.into(),
            parameters,
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct ChatToolCall {
    id: String,
    name: String,
    arguments_json: String,
}

impl ChatToolCall {
    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn arguments_json(&self) -> &str {
        &self.arguments_json
    }
}

impl fmt::Debug for ChatToolCall {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ChatToolCall")
            .field("id", &self.id)
            .field("name", &self.name)
            .field("arguments_json", &"[REDACTED]")
            .finish()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AgentMessageRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Clone, PartialEq, Eq)]
pub struct AgentChatMessage {
    role: AgentMessageRole,
    content: String,
    reasoning_content: Option<EphemeralReasoningContent>,
    tool_calls: Vec<ChatToolCall>,
    tool_call_id: Option<String>,
}

impl fmt::Debug for AgentChatMessage {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AgentChatMessage")
            .field("role", &self.role)
            .field("content_characters", &self.content.chars().count())
            .field("has_reasoning_content", &self.reasoning_content.is_some())
            .field("tool_call_count", &self.tool_calls.len())
            .field("tool_call_id", &self.tool_call_id)
            .finish()
    }
}

impl AgentChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self::plain(AgentMessageRole::System, content.into())
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self::plain(AgentMessageRole::User, content.into())
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self::plain(AgentMessageRole::Assistant, content.into())
    }

    pub fn tool_result(tool_call_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: AgentMessageRole::Tool,
            content: content.into(),
            reasoning_content: None,
            tool_calls: Vec::new(),
            tool_call_id: Some(tool_call_id.into()),
        }
    }

    fn plain(role: AgentMessageRole, content: String) -> Self {
        Self {
            role,
            content,
            reasoning_content: None,
            tool_calls: Vec::new(),
            tool_call_id: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgentChatRequest {
    pub chain_id: ToolChainId,
    pub model: String,
    pub messages: Vec<AgentChatMessage>,
    pub tools: Vec<ChatToolDefinition>,
    pub thinking: ThinkingMode,
    pub reasoning_effort: Option<ReasoningEffort>,
    pub max_output_tokens: u32,
}

#[derive(Clone, PartialEq, Eq)]
pub struct AgentTurn {
    chain_id: ToolChainId,
    visible_content: String,
    reasoning_content: Option<EphemeralReasoningContent>,
    tool_calls: Vec<ChatToolCall>,
    usage: Option<StreamUsage>,
}

impl fmt::Debug for AgentTurn {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AgentTurn")
            .field(
                "visible_content_characters",
                &self.visible_content.chars().count(),
            )
            .field("has_reasoning_content", &self.reasoning_content.is_some())
            .field("tool_calls", &self.tool_calls)
            .field("usage", &self.usage)
            .finish()
    }
}

impl AgentTurn {
    pub fn visible_content(&self) -> &str {
        &self.visible_content
    }

    pub fn tool_calls(&self) -> &[ChatToolCall] {
        &self.tool_calls
    }

    pub const fn usage(&self) -> Option<&StreamUsage> {
        self.usage.as_ref()
    }

    pub fn into_assistant_message(self) -> AgentChatMessage {
        AgentChatMessage {
            role: AgentMessageRole::Assistant,
            content: self.visible_content,
            reasoning_content: self.reasoning_content,
            tool_calls: self.tool_calls,
            tool_call_id: None,
        }
    }
}

#[derive(Default)]
pub struct SseParser {
    buffer: Vec<u8>,
    data_lines: Vec<String>,
}

impl SseParser {
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<String>, ClientError> {
        if self.buffer.len().saturating_add(chunk.len()) > MAX_STREAM_BUFFER_BYTES {
            return Err(ClientError::ResponseTooLarge);
        }
        self.buffer.extend_from_slice(chunk);
        let mut events = Vec::new();
        while let Some(index) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let mut line = self.buffer.drain(..=index).collect::<Vec<_>>();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            let line = std::str::from_utf8(&line).map_err(|_| ClientError::InvalidSse)?;
            if line.is_empty() {
                if !self.data_lines.is_empty() {
                    events.push(self.data_lines.join("\n"));
                    self.data_lines.clear();
                }
            } else if let Some(data) = line.strip_prefix("data:") {
                self.data_lines.push(data.trim_start().to_owned());
            } else if line.starts_with(':')
                || line.starts_with("event:")
                || line.starts_with("id:")
                || line.starts_with("retry:")
            {
                // Keep-alive and metadata do not affect data-only OpenAI-compatible events.
            } else {
                return Err(ClientError::InvalidSse);
            }
        }
        Ok(events)
    }
}

#[derive(Debug, Deserialize)]
struct Chunk {
    choices: Vec<Choice>,
    usage: Option<StreamUsage>,
}
#[derive(Debug, Deserialize)]
struct Choice {
    delta: Delta,
}
#[derive(Debug, Deserialize)]
struct Delta {
    content: Option<String>,
    reasoning_content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<ProviderToolCallDelta>,
}

#[derive(Debug, Deserialize)]
struct ProviderToolCallDelta {
    index: usize,
    id: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
    function: Option<ProviderFunctionDelta>,
}

#[derive(Debug, Deserialize)]
struct ProviderFunctionDelta {
    name: Option<String>,
    arguments: Option<String>,
}

#[derive(Debug)]
struct AgentDelta {
    content: String,
    reasoning_content: Option<EphemeralReasoningContent>,
    tool_calls: Vec<ProviderToolCallDelta>,
}

#[derive(Debug)]
enum AgentStreamEvent {
    Delta(AgentDelta),
    Usage(StreamUsage),
    Done,
}

fn parse_agent_data_event(
    data: &str,
    chain_id: &ToolChainId,
) -> Result<AgentStreamEvent, ClientError> {
    if data == "[DONE]" {
        return Ok(AgentStreamEvent::Done);
    }
    let chunk: Chunk = serde_json::from_str(data)?;
    if let Some(usage) = chunk.usage {
        return Ok(AgentStreamEvent::Usage(usage));
    }
    let mut content = String::new();
    let mut reasoning_content = String::new();
    let mut tool_calls = Vec::new();
    for choice in chunk.choices {
        if let Some(delta) = choice.delta.content {
            content.push_str(&delta);
        }
        if let Some(delta) = choice.delta.reasoning_content {
            reasoning_content.push_str(&delta);
        }
        tool_calls.extend(choice.delta.tool_calls);
    }
    Ok(AgentStreamEvent::Delta(AgentDelta {
        content,
        reasoning_content: (!reasoning_content.is_empty()).then(|| EphemeralReasoningContent {
            chain_id: chain_id.clone(),
            value: reasoning_content,
        }),
        tool_calls,
    }))
}

#[derive(Default)]
struct PendingToolCall {
    id: String,
    name: String,
    arguments_json: String,
    saw_function_type: bool,
}

struct AgentTurnAccumulator {
    chain_id: ToolChainId,
    visible_content: String,
    reasoning_content: Option<EphemeralReasoningContent>,
    pending_tool_calls: Vec<Option<PendingToolCall>>,
    usage: Option<StreamUsage>,
}

impl AgentTurnAccumulator {
    fn new(chain_id: ToolChainId) -> Self {
        Self {
            chain_id,
            visible_content: String::new(),
            reasoning_content: None,
            pending_tool_calls: Vec::new(),
            usage: None,
        }
    }

    fn push(&mut self, event: AgentStreamEvent) -> Result<Option<StreamEvent>, ClientError> {
        match event {
            AgentStreamEvent::Delta(delta) => {
                self.visible_content.push_str(&delta.content);
                if self.visible_content.len() > MAX_STREAM_BUFFER_BYTES {
                    return Err(ClientError::ResponseTooLarge);
                }
                if let Some(reasoning) = delta.reasoning_content {
                    let target =
                        self.reasoning_content
                            .get_or_insert_with(|| EphemeralReasoningContent {
                                chain_id: self.chain_id.clone(),
                                value: String::new(),
                            });
                    if target.chain_id != reasoning.chain_id {
                        return Err(ClientError::InvalidToolCall);
                    }
                    target.value.push_str(&reasoning.value);
                    if target.value.len() > MAX_STREAM_BUFFER_BYTES {
                        return Err(ClientError::ResponseTooLarge);
                    }
                }
                for tool_call in delta.tool_calls {
                    self.push_tool_call(tool_call)?;
                }
                Ok((!delta.content.is_empty()).then_some(StreamEvent::Delta(delta.content)))
            }
            AgentStreamEvent::Usage(usage) => {
                self.usage = Some(usage.clone());
                Ok(Some(StreamEvent::Usage(usage)))
            }
            AgentStreamEvent::Done => Ok(Some(StreamEvent::Done)),
        }
    }

    fn push_tool_call(&mut self, delta: ProviderToolCallDelta) -> Result<(), ClientError> {
        if delta.index >= MAX_AGENT_TOOLS {
            return Err(ClientError::InvalidToolCall);
        }
        self.pending_tool_calls
            .resize_with(delta.index.saturating_add(1), || None);
        let pending = self.pending_tool_calls[delta.index].get_or_insert_with(Default::default);
        if let Some(kind) = delta.kind {
            if kind != "function" {
                return Err(ClientError::InvalidToolCall);
            }
            pending.saw_function_type = true;
        }
        if let Some(id) = delta.id {
            pending.id.push_str(&id);
        }
        if let Some(function) = delta.function {
            if let Some(name) = function.name {
                pending.name.push_str(&name);
            }
            if let Some(arguments) = function.arguments {
                pending.arguments_json.push_str(&arguments);
            }
        }
        if pending.id.len() > 256
            || pending.name.len() > 64
            || pending.arguments_json.len() > MAX_TOOL_ARGUMENT_BYTES
        {
            return Err(ClientError::ResponseTooLarge);
        }
        Ok(())
    }

    fn finish(self) -> Result<AgentTurn, ClientError> {
        let mut tool_calls = Vec::with_capacity(self.pending_tool_calls.len());
        for pending in self.pending_tool_calls {
            let pending = pending.ok_or(ClientError::InvalidToolCall)?;
            if !pending.saw_function_type
                || !valid_provider_identifier(&pending.id, 256)
                || !valid_provider_identifier(&pending.name, 64)
                || !serde_json::from_str::<serde_json::Value>(&pending.arguments_json)
                    .is_ok_and(|arguments| arguments.is_object())
            {
                return Err(ClientError::InvalidToolCall);
            }
            tool_calls.push(ChatToolCall {
                id: pending.id,
                name: pending.name,
                arguments_json: pending.arguments_json,
            });
        }
        Ok(AgentTurn {
            chain_id: self.chain_id,
            visible_content: self.visible_content,
            reasoning_content: self.reasoning_content,
            tool_calls,
            usage: self.usage,
        })
    }
}

fn parse_data_event(data: &str) -> Result<StreamEvent, ClientError> {
    if data == "[DONE]" {
        return Ok(StreamEvent::Done);
    }
    let chunk: Chunk = serde_json::from_str(data)?;
    if let Some(usage) = chunk.usage {
        return Ok(StreamEvent::Usage(usage));
    }
    Ok(StreamEvent::Delta(
        chunk
            .choices
            .into_iter()
            .filter_map(|choice| choice.delta.content)
            .collect(),
    ))
}

#[derive(Debug, Serialize)]
struct ProviderChatRequest<'a> {
    model: &'a str,
    messages: [ChatMessage<'a>; 2],
    stream: bool,
    stream_options: StreamOptions,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<Thinking>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_effort: Option<ReasoningEffort>,
    max_tokens: u32,
}
#[derive(Debug, Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}
#[derive(Debug, Serialize)]
struct StreamOptions {
    include_usage: bool,
}
#[derive(Debug, Serialize)]
struct Thinking {
    #[serde(rename = "type")]
    kind: ThinkingMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatRequest {
    pub model: String,
    pub system_prompt: String,
    pub user_content: String,
    pub thinking: ThinkingMode,
    pub reasoning_effort: Option<ReasoningEffort>,
    pub max_output_tokens: u32,
}

impl ChatRequest {
    pub fn from_preset(
        preset: &TaskPreset,
        system_prompt: impl Into<String>,
        user_content: impl Into<String>,
    ) -> Self {
        Self {
            model: preset.model.clone(),
            system_prompt: system_prompt.into(),
            user_content: user_content.into(),
            thinking: preset.thinking,
            reasoning_effort: preset.reasoning_effort,
            max_output_tokens: preset.max_output_tokens,
        }
    }
}

fn provider_chat_request(request: &ChatRequest) -> ProviderChatRequest<'_> {
    let capabilities = model_capabilities(&request.model);
    let thinking = capabilities.supports_thinking.then_some(Thinking {
        kind: request.thinking,
    });
    let reasoning_effort = if request.thinking == ThinkingMode::Enabled {
        request
            .reasoning_effort
            .filter(|effort| capabilities.reasoning_efforts.contains(effort))
    } else {
        None
    };
    ProviderChatRequest {
        model: &request.model,
        messages: [
            ChatMessage {
                role: "system",
                content: &request.system_prompt,
            },
            ChatMessage {
                role: "user",
                content: &request.user_content,
            },
        ],
        stream: true,
        stream_options: StreamOptions {
            include_usage: true,
        },
        thinking,
        reasoning_effort,
        max_tokens: request.max_output_tokens,
    }
}

fn provider_agent_chat_request(
    request: &AgentChatRequest,
) -> Result<serde_json::Value, ClientError> {
    validate_agent_chat_request(request)?;
    let capabilities = model_capabilities(&request.model);
    if !request.tools.is_empty() && !capabilities.supports_tools {
        return Err(ClientError::ToolsUnsupported);
    }

    let messages = request
        .messages
        .iter()
        .map(|message| provider_agent_message(message, &request.chain_id))
        .collect::<Result<Vec<_>, _>>()?;
    let mut body = serde_json::json!({
        "model": request.model,
        "messages": messages,
        "stream": true,
        "stream_options": { "include_usage": true },
        "max_tokens": request.max_output_tokens
    });
    let object = body
        .as_object_mut()
        .ok_or(ClientError::InvalidAgentRequest)?;
    if capabilities.supports_thinking {
        object.insert(
            "thinking".to_owned(),
            serde_json::json!({ "type": request.thinking }),
        );
    }
    if request.thinking == ThinkingMode::Enabled
        && let Some(effort) = request
            .reasoning_effort
            .filter(|effort| capabilities.reasoning_efforts.contains(effort))
    {
        object.insert(
            "reasoning_effort".to_owned(),
            serde_json::to_value(effort).map_err(ClientError::InvalidSseJson)?,
        );
    }
    if !request.tools.is_empty() {
        let tools = request
            .tools
            .iter()
            .map(|tool| {
                serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.parameters
                    }
                })
            })
            .collect::<Vec<_>>();
        object.insert("tools".to_owned(), serde_json::Value::Array(tools));
        object.insert("tool_choice".to_owned(), serde_json::json!("auto"));
    }
    Ok(body)
}

fn provider_agent_message(
    message: &AgentChatMessage,
    chain_id: &ToolChainId,
) -> Result<serde_json::Value, ClientError> {
    let role = match message.role {
        AgentMessageRole::System => "system",
        AgentMessageRole::User => "user",
        AgentMessageRole::Assistant => "assistant",
        AgentMessageRole::Tool => "tool",
    };
    let mut value = serde_json::json!({
        "role": role,
        "content": message.content
    });
    let object = value
        .as_object_mut()
        .ok_or(ClientError::InvalidAgentRequest)?;
    if let Some(reasoning_content) = &message.reasoning_content {
        if &reasoning_content.chain_id != chain_id {
            return Err(ClientError::InvalidAgentRequest);
        }
        object.insert(
            "reasoning_content".to_owned(),
            serde_json::Value::String(reasoning_content.value.clone()),
        );
    }
    if !message.tool_calls.is_empty() {
        let tool_calls = message
            .tool_calls
            .iter()
            .map(|call| {
                serde_json::json!({
                    "id": call.id,
                    "type": "function",
                    "function": {
                        "name": call.name,
                        "arguments": call.arguments_json
                    }
                })
            })
            .collect::<Vec<_>>();
        object.insert(
            "tool_calls".to_owned(),
            serde_json::Value::Array(tool_calls),
        );
    }
    if let Some(tool_call_id) = &message.tool_call_id {
        object.insert(
            "tool_call_id".to_owned(),
            serde_json::Value::String(tool_call_id.clone()),
        );
    }
    Ok(value)
}

fn validate_agent_chat_request(request: &AgentChatRequest) -> Result<(), ClientError> {
    if request.messages.is_empty()
        || request.messages.len() > MAX_AGENT_MESSAGES
        || request.tools.len() > MAX_AGENT_TOOLS
        || request.max_output_tokens == 0
    {
        return Err(ClientError::InvalidAgentRequest);
    }
    let mut tool_names = HashSet::with_capacity(request.tools.len());
    for tool in &request.tools {
        if !valid_provider_identifier(&tool.name, 64)
            || tool.description.trim().is_empty()
            || tool.description.chars().count() > 1_024
            || !tool.parameters.is_object()
            || tool.parameters.get("type") != Some(&serde_json::json!("object"))
            || tool.parameters.get("additionalProperties") != Some(&serde_json::json!(false))
            || serde_json::to_vec(&tool.parameters)
                .map_or(true, |encoded| encoded.len() > MAX_TOOL_RESULT_BYTES)
        {
            return Err(ClientError::InvalidAgentRequest);
        }
        if !tool_names.insert(tool.name.as_str()) {
            return Err(ClientError::InvalidAgentRequest);
        }
    }
    let mut pending_tool_call_ids = HashSet::new();
    let mut saw_tool_protocol = false;
    for message in &request.messages {
        if message.content.len() > MAX_TOOL_RESULT_BYTES
            || message.tool_calls.len() > MAX_AGENT_TOOLS
        {
            return Err(ClientError::InvalidAgentRequest);
        }
        if !pending_tool_call_ids.is_empty() && message.role != AgentMessageRole::Tool {
            return Err(ClientError::InvalidAgentRequest);
        }
        match message.role {
            AgentMessageRole::System | AgentMessageRole::User => {
                if message.content.trim().is_empty()
                    || message.reasoning_content.is_some()
                    || !message.tool_calls.is_empty()
                    || message.tool_call_id.is_some()
                {
                    return Err(ClientError::InvalidAgentRequest);
                }
            }
            AgentMessageRole::Assistant => {
                if message.tool_call_id.is_some()
                    || message
                        .reasoning_content
                        .as_ref()
                        .is_some_and(|reasoning| reasoning.chain_id != request.chain_id)
                    || (message.content.is_empty() && message.tool_calls.is_empty())
                {
                    return Err(ClientError::InvalidAgentRequest);
                }
                if !message.tool_calls.is_empty() {
                    saw_tool_protocol = true;
                }
            }
            AgentMessageRole::Tool => {
                if message.content.len() > MAX_TOOL_RESULT_BYTES
                    || message.reasoning_content.is_some()
                    || !message.tool_calls.is_empty()
                    || message
                        .tool_call_id
                        .as_deref()
                        .is_none_or(|id| !valid_provider_identifier(id, 256))
                {
                    return Err(ClientError::InvalidAgentRequest);
                }
                let tool_call_id = message
                    .tool_call_id
                    .as_deref()
                    .ok_or(ClientError::InvalidAgentRequest)?;
                if !pending_tool_call_ids.remove(tool_call_id) {
                    return Err(ClientError::InvalidAgentRequest);
                }
                saw_tool_protocol = true;
            }
        }
        for call in &message.tool_calls {
            if !valid_provider_identifier(&call.id, 256)
                || !valid_provider_identifier(&call.name, 64)
                || call.arguments_json.len() > MAX_TOOL_ARGUMENT_BYTES
                || !serde_json::from_str::<serde_json::Value>(&call.arguments_json)
                    .is_ok_and(|arguments| arguments.is_object())
            {
                return Err(ClientError::InvalidAgentRequest);
            }
            if !tool_names.contains(call.name.as_str())
                || !pending_tool_call_ids.insert(call.id.clone())
            {
                return Err(ClientError::InvalidAgentRequest);
            }
        }
    }
    if !pending_tool_call_ids.is_empty() || (saw_tool_protocol && request.tools.is_empty()) {
        return Err(ClientError::InvalidAgentRequest);
    }
    Ok(())
}

fn valid_provider_identifier(value: &str, maximum_characters: usize) -> bool {
    !value.trim().is_empty()
        && value.chars().count() <= maximum_characters
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "_-.".contains(character))
}

#[derive(Debug, Clone)]
pub struct DeepSeekClient {
    http: Client,
    config: DeepSeekConfig,
}

impl DeepSeekClient {
    pub fn new(config: DeepSeekConfig) -> Result<Self, ClientError> {
        let mut builder = Client::builder()
            .timeout(config.timeout)
            .redirect(Policy::none());
        if let Some(proxy_url) = &config.proxy_url {
            builder = builder.proxy(reqwest::Proxy::all(proxy_url.as_str())?);
        }
        let http = builder.build()?;
        Ok(Self { http, config })
    }

    pub async fn list_models(&self) -> Result<ModelList, ClientError> {
        let endpoint = self
            .config
            .base_url
            .join("models")
            .map_err(ClientError::InvalidBaseUrl)?;
        let response = self
            .http
            .get(endpoint)
            .bearer_auth(&self.config.api_key)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(status_error(&response));
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_MODEL_LIST_BYTES as u64)
        {
            return Err(ClientError::ResponseTooLarge);
        }
        let bytes = response.bytes().await?;
        if bytes.len() > MAX_MODEL_LIST_BYTES {
            return Err(ClientError::ResponseTooLarge);
        }
        serde_json::from_slice(&bytes).map_err(ClientError::InvalidSseJson)
    }

    pub async fn stream_translation<F>(
        &self,
        model: &str,
        system_prompt: &str,
        source_text: &str,
        cancelled: &mut watch::Receiver<bool>,
        on_event: F,
    ) -> Result<(), ClientError>
    where
        F: FnMut(StreamEvent),
    {
        let request = ChatRequest {
            model: model.to_owned(),
            system_prompt: system_prompt.to_owned(),
            user_content: source_text.to_owned(),
            thinking: ThinkingMode::Disabled,
            reasoning_effort: None,
            max_output_tokens: 4_096,
        };
        self.stream_chat(&request, cancelled, on_event).await
    }

    pub async fn stream_chat<F>(
        &self,
        request: &ChatRequest,
        cancelled: &mut watch::Receiver<bool>,
        mut on_event: F,
    ) -> Result<(), ClientError>
    where
        F: FnMut(StreamEvent),
    {
        let endpoint = self
            .config
            .base_url
            .join("chat/completions")
            .map_err(ClientError::InvalidBaseUrl)?;
        let provider_request = provider_chat_request(request);
        let response = self
            .http
            .post(endpoint)
            .bearer_auth(&self.config.api_key)
            .json(&provider_request)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(status_error(&response));
        }
        let mut stream = response.bytes_stream();
        let mut parser = SseParser::default();
        let mut saw_done = false;
        loop {
            if *cancelled.borrow() {
                return Err(ClientError::Cancelled);
            }
            tokio::select! {
                changed = cancelled.changed() => {
                    if changed.is_ok() && *cancelled.borrow() { return Err(ClientError::Cancelled); }
                }
                next = stream.next() => match next {
                    Some(Ok(bytes)) => for data in parser.push(&bytes)? {
                        let event = parse_data_event(&data)?;
                        if matches!(event, StreamEvent::Done) { saw_done = true; }
                        on_event(event);
                    },
                    Some(Err(error)) if error.is_timeout() => return Err(ClientError::Timeout),
                    Some(Err(error)) => return Err(ClientError::Request(error)),
                    None => break,
                }
            }
        }
        if saw_done {
            Ok(())
        } else {
            Err(ClientError::EarlyClose)
        }
    }

    /// Streams only user-visible content and usage through `on_event`, while
    /// returning tool calls plus hidden reasoning in an in-memory `AgentTurn`.
    /// Hidden reasoning never crosses the ordinary `StreamEvent` boundary.
    pub async fn stream_agent_chat<F>(
        &self,
        request: &AgentChatRequest,
        cancelled: &mut watch::Receiver<bool>,
        mut on_event: F,
    ) -> Result<AgentTurn, ClientError>
    where
        F: FnMut(StreamEvent),
    {
        let endpoint = self
            .config
            .base_url
            .join("chat/completions")
            .map_err(ClientError::InvalidBaseUrl)?;
        let provider_request = provider_agent_chat_request(request)?;
        let response = self
            .http
            .post(endpoint)
            .bearer_auth(&self.config.api_key)
            .json(&provider_request)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(status_error(&response));
        }
        let mut stream = response.bytes_stream();
        let mut parser = SseParser::default();
        let mut accumulator = AgentTurnAccumulator::new(request.chain_id.clone());
        let mut saw_done = false;
        loop {
            if *cancelled.borrow() {
                return Err(ClientError::Cancelled);
            }
            tokio::select! {
                changed = cancelled.changed() => {
                    if changed.is_ok() && *cancelled.borrow() {
                        return Err(ClientError::Cancelled);
                    }
                }
                next = stream.next() => match next {
                    Some(Ok(bytes)) => for data in parser.push(&bytes)? {
                        let event = parse_agent_data_event(&data, &request.chain_id)?;
                        if matches!(event, AgentStreamEvent::Done) {
                            saw_done = true;
                        }
                        if let Some(public_event) = accumulator.push(event)? {
                            on_event(public_event);
                        }
                    },
                    Some(Err(error)) if error.is_timeout() => return Err(ClientError::Timeout),
                    Some(Err(error)) => return Err(ClientError::Request(error)),
                    None => break,
                }
            }
        }
        if !saw_done {
            return Err(ClientError::EarlyClose);
        }
        accumulator.finish()
    }
}

fn validate_remote_url(url: &Url) -> Result<(), ClientError> {
    if url.scheme() != "https" {
        return Err(ClientError::InsecureBaseUrl);
    }
    Ok(())
}

fn status_error(response: &reqwest::Response) -> ClientError {
    let retry_after_ms = response
        .headers()
        .get("retry-after")
        .and_then(|header| header.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .map(|seconds| seconds.saturating_mul(1_000));
    ClientError::HttpStatus {
        status: response.status(),
        retry_after_ms,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AgentChatMessage, AgentChatRequest, AgentStreamEvent, AgentTurnAccumulator,
        CapabilityStatus, ChatRequest, ChatToolDefinition, ClientError, DeepSeekConfig,
        ReasoningEffort, SseParser, StreamEvent, ThinkingMode, ToolChainId, default_task_presets,
        model_capabilities, parse_agent_data_event, parse_data_event, provider_agent_chat_request,
        provider_chat_request,
    };

    #[test]
    fn redacts_api_key_from_debug_output() {
        let config = DeepSeekConfig::new("https://api.deepseek.com", "super-secret")
            .expect("valid configuration");
        let debug = format!("{config:?}");
        assert!(!debug.contains("super-secret"));
    }

    #[test]
    fn maps_page_translation_to_flash_without_thinking() {
        let profiles = default_task_presets();
        let profile = profiles
            .iter()
            .find(|profile| profile.task == "whole_page_translation")
            .expect("profile");
        assert_eq!(profile.model, "deepseek-v4-flash");
        assert_eq!(profile.thinking, ThinkingMode::Disabled);
        assert_eq!(profile.reasoning_effort, None);
        let explain = profiles
            .iter()
            .find(|profile| profile.task == "explanation")
            .expect("explanation profile");
        assert_eq!(explain.thinking, ThinkingMode::Enabled);
        assert_eq!(explain.reasoning_effort, Some(ReasoningEffort::High));
    }

    #[test]
    fn parser_handles_split_utf8_keepalive_multiple_events_and_usage() {
        let mut parser = SseParser::default();
        assert!(
            parser
                .push(b": keepalive\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"")
                .expect("chunk")
                .is_empty()
        );
        let events = parser.push("中\"}}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2,\"total_tokens\":3}}\n\ndata: [DONE]\n\n".as_bytes()).expect("chunk");
        assert!(
            matches!(parse_data_event(&events[0]).expect("event"), StreamEvent::Delta(value) if value == "中")
        );
        assert!(matches!(
            parse_data_event(&events[1]).expect("usage"),
            StreamEvent::Usage(_)
        ));
        assert!(matches!(
            parse_data_event(&events[2]).expect("done"),
            StreamEvent::Done
        ));
    }

    #[test]
    fn rejects_plaintext_remote_base_urls() {
        assert!(DeepSeekConfig::new("http://example.com", "key").is_err());
    }
    #[test]
    fn does_not_retry_auth_or_payment_failures() {
        assert!(
            !ClientError::HttpStatus {
                status: reqwest::StatusCode::UNAUTHORIZED,
                retry_after_ms: None
            }
            .retryable()
        );
        assert!(
            !ClientError::HttpStatus {
                status: reqwest::StatusCode::PAYMENT_REQUIRED,
                retry_after_ms: None
            }
            .retryable()
        );
    }

    #[test]
    fn capability_filter_only_sends_supported_reasoning_fields() {
        let enabled = ChatRequest {
            model: "deepseek-v4-pro".to_owned(),
            system_prompt: "system".to_owned(),
            user_content: "user".to_owned(),
            thinking: ThinkingMode::Enabled,
            reasoning_effort: Some(ReasoningEffort::Max),
            max_output_tokens: 512,
        };
        let enabled_json = serde_json::to_value(provider_chat_request(&enabled)).expect("request");
        assert_eq!(enabled_json["thinking"]["type"], "enabled");
        assert_eq!(enabled_json["reasoning_effort"], "max");

        let disabled = ChatRequest {
            thinking: ThinkingMode::Disabled,
            reasoning_effort: Some(ReasoningEffort::Max),
            ..enabled.clone()
        };
        let disabled_json =
            serde_json::to_value(provider_chat_request(&disabled)).expect("request");
        assert_eq!(disabled_json["thinking"]["type"], "disabled");
        assert!(disabled_json.get("reasoning_effort").is_none());

        let unknown = ChatRequest {
            model: "compatible-provider-model".to_owned(),
            thinking: ThinkingMode::Enabled,
            reasoning_effort: Some(ReasoningEffort::High),
            ..enabled
        };
        let unknown_json = serde_json::to_value(provider_chat_request(&unknown)).expect("request");
        assert!(unknown_json.get("thinking").is_none());
        assert!(unknown_json.get("reasoning_effort").is_none());
        assert_eq!(
            model_capabilities(&unknown.model).capability_status,
            CapabilityStatus::Unverified
        );
    }

    #[test]
    fn hidden_reasoning_content_is_never_emitted_as_a_delta() {
        let event = parse_data_event(
            r#"{"choices":[{"delta":{"reasoning_content":"private","content":"visible"}}]}"#,
        )
        .expect("event");
        assert_eq!(event, StreamEvent::Delta("visible".to_owned()));
    }

    fn test_tool() -> ChatToolDefinition {
        ChatToolDefinition::new(
            "search_current_page",
            "Search the current page",
            serde_json::json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "query": { "type": "string" }
                },
                "required": ["query"]
            }),
        )
    }

    fn agent_request(model: &str, chain_id: ToolChainId) -> AgentChatRequest {
        AgentChatRequest {
            chain_id,
            model: model.to_owned(),
            messages: vec![
                AgentChatMessage::system("system"),
                AgentChatMessage::user("question"),
            ],
            tools: vec![test_tool()],
            thinking: ThinkingMode::Enabled,
            reasoning_effort: Some(ReasoningEffort::High),
            max_output_tokens: 512,
        }
    }

    #[test]
    fn rejects_tools_for_models_without_verified_tool_support() {
        let request = agent_request(
            "compatible-provider-model",
            ToolChainId::new("chain-1").expect("chain"),
        );
        assert!(matches!(
            provider_agent_chat_request(&request),
            Err(ClientError::ToolsUnsupported)
        ));
    }

    #[test]
    fn tool_stream_is_assembled_while_reasoning_stays_out_of_public_events() {
        let chain_id = ToolChainId::new("chain-1").expect("chain");
        let first = parse_agent_data_event(
            r#"{"choices":[{"delta":{"reasoning_content":"do not log ","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"search_current_","arguments":"{\"query\":\"private "}}]}}]}"#,
            &chain_id,
        )
        .expect("first event");
        let second = parse_agent_data_event(
            r#"{"choices":[{"delta":{"reasoning_content":"or persist","content":"我会检索页面。","tool_calls":[{"index":0,"function":{"name":"page","arguments":"term\"}"}}]}}]}"#,
            &chain_id,
        )
        .expect("second event");
        let mut accumulator = AgentTurnAccumulator::new(chain_id.clone());
        assert_eq!(accumulator.push(first).expect("first delta"), None);
        assert_eq!(
            accumulator.push(second).expect("second delta"),
            Some(StreamEvent::Delta("我会检索页面。".to_owned()))
        );
        let turn = accumulator.finish().expect("complete turn");
        assert_eq!(turn.visible_content(), "我会检索页面。");
        assert_eq!(turn.tool_calls().len(), 1);
        assert_eq!(turn.tool_calls()[0].name(), "search_current_page");
        assert_eq!(
            turn.tool_calls()[0].arguments_json(),
            r#"{"query":"private term"}"#
        );
        let debug = format!("{turn:?}");
        assert!(!debug.contains("do not log"));
        assert!(!debug.contains("private term"));

        let assistant_message = turn.into_assistant_message();
        let continuation = AgentChatRequest {
            messages: vec![
                AgentChatMessage::system("system"),
                AgentChatMessage::user("question"),
                assistant_message,
                AgentChatMessage::tool_result("call_1", "bounded result"),
            ],
            ..agent_request("deepseek-v4-pro", chain_id)
        };
        let provider = provider_agent_chat_request(&continuation).expect("continuation request");
        assert_eq!(
            provider["messages"][2]["reasoning_content"],
            "do not log or persist"
        );
        assert_eq!(provider["messages"][3]["tool_call_id"], "call_1");
    }

    #[test]
    fn rejects_malformed_or_oversized_tool_arguments() {
        let chain_id = ToolChainId::new("chain-1").expect("chain");
        let event = parse_agent_data_event(
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"search_current_page","arguments":"not-json"}}]}}]}"#,
            &chain_id,
        )
        .expect("event");
        let mut accumulator = AgentTurnAccumulator::new(chain_id);
        assert!(matches!(event, AgentStreamEvent::Delta(_)));
        accumulator.push(event).expect("bounded delta");
        assert!(matches!(
            accumulator.finish(),
            Err(ClientError::InvalidToolCall)
        ));
    }

    #[test]
    fn reasoning_cannot_cross_tool_chain_boundaries() {
        let first_chain = ToolChainId::new("chain-1").expect("first chain");
        let event = parse_agent_data_event(
            r#"{"choices":[{"delta":{"reasoning_content":"hidden","content":"visible"}}]}"#,
            &first_chain,
        )
        .expect("event");
        let mut accumulator = AgentTurnAccumulator::new(first_chain);
        accumulator.push(event).expect("delta");
        let message = accumulator.finish().expect("turn").into_assistant_message();
        let request = AgentChatRequest {
            messages: vec![AgentChatMessage::system("system"), message],
            tools: Vec::new(),
            ..agent_request(
                "deepseek-v4-pro",
                ToolChainId::new("chain-2").expect("second chain"),
            )
        };
        assert!(matches!(
            provider_agent_chat_request(&request),
            Err(ClientError::InvalidAgentRequest)
        ));
    }
}
