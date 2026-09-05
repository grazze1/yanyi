use std::{future::Future, pin::Pin};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;
use url::Url;

pub const MAX_TOOL_ARGUMENT_BYTES: usize = 8 * 1024;
pub const MAX_TOOL_RESULT_BYTES: usize = 128 * 1024;
const MAX_TOOL_CALL_ID_CHARACTERS: usize = 128;
const MAX_CONTEXT_ID_CHARACTERS: usize = 256;
const MAX_QUERY_CHARACTERS: usize = 500;
const MAX_RESULT_CITATIONS: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextToolName {
    GetSelectionContext,
    GetContainingComponent,
    GetAdjacentParagraphs,
    GetCurrentSection,
    SearchCurrentPage,
    GetPageMetadata,
    SearchWorkspace,
}

impl ContextToolName {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::GetSelectionContext => "get_selection_context",
            Self::GetContainingComponent => "get_containing_component",
            Self::GetAdjacentParagraphs => "get_adjacent_paragraphs",
            Self::GetCurrentSection => "get_current_section",
            Self::SearchCurrentPage => "search_current_page",
            Self::GetPageMetadata => "get_page_metadata",
            Self::SearchWorkspace => "search_workspace",
        }
    }

    pub fn from_provider_name(value: &str) -> Option<Self> {
        match value {
            "get_selection_context" => Some(Self::GetSelectionContext),
            "get_containing_component" => Some(Self::GetContainingComponent),
            "get_adjacent_paragraphs" => Some(Self::GetAdjacentParagraphs),
            "get_current_section" => Some(Self::GetCurrentSection),
            "search_current_page" => Some(Self::SearchCurrentPage),
            "get_page_metadata" => Some(Self::GetPageMetadata),
            "search_workspace" => Some(Self::SearchWorkspace),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContextToolPolicy {
    pub name: ContextToolName,
    pub maximum_characters: usize,
    pub requires_page_session: bool,
    pub requires_workspace: bool,
}

pub const CONTEXT_TOOL_POLICIES: [ContextToolPolicy; 7] = [
    ContextToolPolicy {
        name: ContextToolName::GetSelectionContext,
        maximum_characters: 12_000,
        requires_page_session: true,
        requires_workspace: false,
    },
    ContextToolPolicy {
        name: ContextToolName::GetContainingComponent,
        maximum_characters: 20_000,
        requires_page_session: true,
        requires_workspace: false,
    },
    ContextToolPolicy {
        name: ContextToolName::GetAdjacentParagraphs,
        maximum_characters: 20_000,
        requires_page_session: true,
        requires_workspace: false,
    },
    ContextToolPolicy {
        name: ContextToolName::GetCurrentSection,
        maximum_characters: 60_000,
        requires_page_session: true,
        requires_workspace: false,
    },
    ContextToolPolicy {
        name: ContextToolName::SearchCurrentPage,
        maximum_characters: 30_000,
        requires_page_session: true,
        requires_workspace: false,
    },
    ContextToolPolicy {
        name: ContextToolName::GetPageMetadata,
        maximum_characters: 4_000,
        requires_page_session: true,
        requires_workspace: false,
    },
    ContextToolPolicy {
        name: ContextToolName::SearchWorkspace,
        maximum_characters: 30_000,
        requires_page_session: false,
        requires_workspace: true,
    },
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextToolRequest {
    pub name: ContextToolName,
    pub page_session_id: Option<String>,
    pub workspace_id: Option<String>,
    pub query: Option<String>,
    pub maximum_characters: usize,
}

pub fn authorize_context_tool(
    request: &ContextToolRequest,
    active_page_session_id: Option<&str>,
    active_workspace_id: Option<&str>,
) -> Result<ContextToolPolicy, &'static str> {
    let policy = CONTEXT_TOOL_POLICIES
        .iter()
        .find(|policy| policy.name == request.name)
        .copied()
        .ok_or("unknown_tool")?;
    if request.maximum_characters == 0 || request.maximum_characters > policy.maximum_characters {
        return Err("result_limit_invalid");
    }
    if policy.requires_page_session {
        let Some(request_page_session_id) = request.page_session_id.as_deref() else {
            return Err("page_session_mismatch");
        };
        if active_page_session_id != Some(request_page_session_id)
            || !valid_opaque_id(request_page_session_id, MAX_CONTEXT_ID_CHARACTERS)
        {
            return Err("page_session_mismatch");
        }
    }
    if policy.requires_workspace {
        let Some(request_workspace_id) = request.workspace_id.as_deref() else {
            return Err("workspace_mismatch");
        };
        if active_workspace_id != Some(request_workspace_id)
            || !valid_opaque_id(request_workspace_id, MAX_CONTEXT_ID_CHARACTERS)
        {
            return Err("workspace_mismatch");
        }
    }
    if matches!(
        request.name,
        ContextToolName::SearchCurrentPage | ContextToolName::SearchWorkspace
    ) && request
        .query
        .as_deref()
        .is_none_or(|query| query.trim().is_empty() || query.chars().count() > MAX_QUERY_CHARACTERS)
    {
        return Err("query_invalid");
    }
    Ok(policy)
}

/// OpenAI-compatible function definition for a locally authorized context tool.
///
/// The schemas intentionally set `additionalProperties` to `false`. Model output
/// is still validated into the typed argument enum below; the schema is guidance,
/// not a security boundary.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

pub fn context_tool_definitions() -> Vec<ContextToolDefinition> {
    CONTEXT_TOOL_POLICIES
        .iter()
        .map(|policy| ContextToolDefinition {
            name: policy.name.as_str().to_owned(),
            description: tool_description(policy.name).to_owned(),
            parameters: tool_parameters_schema(*policy),
        })
        .collect()
}

fn tool_description(name: ContextToolName) -> &'static str {
    match name {
        ContextToolName::GetSelectionContext => {
            "Return the current selection with its complete sentence and source anchor."
        }
        ContextToolName::GetContainingComponent => {
            "Return the bounded UI or document component containing the current anchor."
        }
        ContextToolName::GetAdjacentParagraphs => {
            "Return a bounded number of paragraphs adjacent to the current anchor."
        }
        ContextToolName::GetCurrentSection => {
            "Return the current section and its heading hierarchy from the active page."
        }
        ContextToolName::SearchCurrentPage => {
            "Search indexed text in the active page session and return anchored matches."
        }
        ContextToolName::GetPageMetadata => {
            "Return bounded metadata for the active page without returning the full page."
        }
        ContextToolName::SearchWorkspace => {
            "Search the explicitly authorized workspace using local indexed retrieval."
        }
    }
}

fn tool_parameters_schema(policy: ContextToolPolicy) -> Value {
    let page_session = json!({
        "type": "string",
        "minLength": 1,
        "maxLength": MAX_CONTEXT_ID_CHARACTERS,
        "description": "The active page session identifier supplied by the application."
    });
    let workspace = json!({
        "type": "string",
        "minLength": 1,
        "maxLength": MAX_CONTEXT_ID_CHARACTERS,
        "description": "The workspace identifier explicitly authorized for this conversation."
    });
    let maximum_characters = json!({
        "type": "integer",
        "minimum": 1,
        "maximum": policy.maximum_characters,
        "description": "Hard maximum number of Unicode characters to return."
    });
    let query = json!({
        "type": "string",
        "minLength": 1,
        "maxLength": MAX_QUERY_CHARACTERS
    });
    let properties = match policy.name {
        ContextToolName::GetSelectionContext | ContextToolName::GetPageMetadata => json!({
            "pageSessionId": page_session,
            "maximumCharacters": maximum_characters
        }),
        ContextToolName::GetContainingComponent => json!({
            "pageSessionId": page_session,
            "anchorNodeId": {
                "type": "string",
                "minLength": 1,
                "maxLength": MAX_CONTEXT_ID_CHARACTERS
            },
            "maximumCharacters": maximum_characters
        }),
        ContextToolName::GetAdjacentParagraphs => json!({
            "pageSessionId": page_session,
            "anchorNodeId": {
                "type": "string",
                "minLength": 1,
                "maxLength": MAX_CONTEXT_ID_CHARACTERS
            },
            "before": { "type": "integer", "minimum": 0, "maximum": 5 },
            "after": { "type": "integer", "minimum": 0, "maximum": 5 },
            "maximumCharacters": maximum_characters
        }),
        ContextToolName::GetCurrentSection => json!({
            "pageSessionId": page_session,
            "sectionId": {
                "type": "string",
                "minLength": 1,
                "maxLength": MAX_CONTEXT_ID_CHARACTERS
            },
            "maximumCharacters": maximum_characters
        }),
        ContextToolName::SearchCurrentPage => json!({
            "pageSessionId": page_session,
            "query": query,
            "limit": { "type": "integer", "minimum": 1, "maximum": 20 },
            "maximumCharacters": maximum_characters
        }),
        ContextToolName::SearchWorkspace => json!({
            "workspaceId": workspace,
            "query": query,
            "limit": { "type": "integer", "minimum": 1, "maximum": 20 },
            "maximumCharacters": maximum_characters
        }),
    };
    let required = match policy.name {
        ContextToolName::GetSelectionContext
        | ContextToolName::GetContainingComponent
        | ContextToolName::GetAdjacentParagraphs
        | ContextToolName::GetCurrentSection
        | ContextToolName::SearchCurrentPage
        | ContextToolName::GetPageMetadata => {
            if matches!(policy.name, ContextToolName::SearchCurrentPage) {
                json!(["pageSessionId", "query", "maximumCharacters"])
            } else {
                json!(["pageSessionId", "maximumCharacters"])
            }
        }
        ContextToolName::SearchWorkspace => {
            json!(["workspaceId", "query", "maximumCharacters"])
        }
    };
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": properties,
        "required": required
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextToolInvocation {
    pub call_id: String,
    pub name: String,
    pub arguments_json: String,
}

#[derive(Debug, Clone, Copy)]
pub struct ContextToolAuthority<'a> {
    pub active_page_session_id: Option<&'a str>,
    pub active_workspace_id: Option<&'a str>,
    pub allowed_tools: &'a [ContextToolName],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ValidatedContextToolArguments {
    GetSelectionContext {
        page_session_id: String,
        maximum_characters: usize,
    },
    GetContainingComponent {
        page_session_id: String,
        anchor_node_id: Option<String>,
        maximum_characters: usize,
    },
    GetAdjacentParagraphs {
        page_session_id: String,
        anchor_node_id: Option<String>,
        before: u8,
        after: u8,
        maximum_characters: usize,
    },
    GetCurrentSection {
        page_session_id: String,
        section_id: Option<String>,
        maximum_characters: usize,
    },
    SearchCurrentPage {
        page_session_id: String,
        query: String,
        limit: u8,
        maximum_characters: usize,
    },
    GetPageMetadata {
        page_session_id: String,
        maximum_characters: usize,
    },
    SearchWorkspace {
        workspace_id: String,
        query: String,
        limit: u8,
        maximum_characters: usize,
    },
}

impl ValidatedContextToolArguments {
    pub const fn maximum_characters(&self) -> usize {
        match self {
            Self::GetSelectionContext {
                maximum_characters, ..
            }
            | Self::GetContainingComponent {
                maximum_characters, ..
            }
            | Self::GetAdjacentParagraphs {
                maximum_characters, ..
            }
            | Self::GetCurrentSection {
                maximum_characters, ..
            }
            | Self::SearchCurrentPage {
                maximum_characters, ..
            }
            | Self::GetPageMetadata {
                maximum_characters, ..
            }
            | Self::SearchWorkspace {
                maximum_characters, ..
            } => *maximum_characters,
        }
    }

    pub fn page_session_id(&self) -> Option<&str> {
        match self {
            Self::GetSelectionContext {
                page_session_id, ..
            }
            | Self::GetContainingComponent {
                page_session_id, ..
            }
            | Self::GetAdjacentParagraphs {
                page_session_id, ..
            }
            | Self::GetCurrentSection {
                page_session_id, ..
            }
            | Self::SearchCurrentPage {
                page_session_id, ..
            }
            | Self::GetPageMetadata {
                page_session_id, ..
            } => Some(page_session_id),
            Self::SearchWorkspace { .. } => None,
        }
    }

    pub fn workspace_id(&self) -> Option<&str> {
        match self {
            Self::SearchWorkspace { workspace_id, .. } => Some(workspace_id),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedContextToolCall {
    pub call_id: String,
    pub name: ContextToolName,
    pub arguments: ValidatedContextToolArguments,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextToolCitation {
    pub source_id: String,
    pub label: String,
    pub excerpt: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextToolOutput {
    pub content: String,
    pub citations: Vec<ContextToolCitation>,
    pub page_session_id: Option<String>,
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextToolResult {
    pub call_id: String,
    pub name: ContextToolName,
    pub content: String,
    pub citations: Vec<ContextToolCitation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ContextToolProviderError {
    #[error("context provider rejected the request: {code}")]
    Rejected { code: String },
    #[error("context provider is temporarily unavailable")]
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ContextToolError {
    #[error("unknown context tool")]
    UnknownTool,
    #[error("context tool is not authorized for this request")]
    ToolNotAuthorized,
    #[error("context tool call identifier is invalid")]
    InvalidCallId,
    #[error("context tool arguments are invalid")]
    InvalidArguments,
    #[error("context tool requested an invalid result size")]
    InvalidResultLimit,
    #[error("context tool page session does not match the active page")]
    PageSessionMismatch,
    #[error("context tool workspace does not match the active workspace")]
    WorkspaceMismatch,
    #[error("context tool provider returned a result for the wrong scope")]
    ProviderScopeMismatch,
    #[error("context tool provider returned too much data")]
    ResultTooLarge,
    #[error(transparent)]
    Provider(#[from] ContextToolProviderError),
}

impl ContextToolError {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::UnknownTool => "context_tool_unknown",
            Self::ToolNotAuthorized => "context_tool_unauthorized",
            Self::InvalidCallId => "context_tool_call_id_invalid",
            Self::InvalidArguments => "context_tool_arguments_invalid",
            Self::InvalidResultLimit => "context_tool_result_limit_invalid",
            Self::PageSessionMismatch => "context_tool_page_session_mismatch",
            Self::WorkspaceMismatch => "context_tool_workspace_mismatch",
            Self::ProviderScopeMismatch => "context_tool_provider_scope_mismatch",
            Self::ResultTooLarge => "context_tool_result_too_large",
            Self::Provider(_) => "context_tool_provider_failed",
        }
    }
}

pub trait ContextToolProvider: Send + Sync {
    fn execute<'a>(
        &'a self,
        call: &'a ValidatedContextToolCall,
    ) -> Pin<
        Box<dyn Future<Output = Result<ContextToolOutput, ContextToolProviderError>> + Send + 'a>,
    >;
}

#[derive(Debug)]
pub struct ContextToolExecutor<P> {
    provider: P,
}

impl<P> ContextToolExecutor<P>
where
    P: ContextToolProvider,
{
    pub const fn new(provider: P) -> Self {
        Self { provider }
    }

    pub fn provider(&self) -> &P {
        &self.provider
    }

    pub async fn execute(
        &self,
        invocation: &ContextToolInvocation,
        authority: ContextToolAuthority<'_>,
    ) -> Result<ContextToolResult, ContextToolError> {
        let call = validate_context_tool_call(invocation, authority)?;
        let output = self.provider.execute(&call).await?;
        validate_context_tool_output(&call, &output)?;
        Ok(ContextToolResult {
            call_id: call.call_id,
            name: call.name,
            content: output.content,
            citations: output.citations,
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PageArguments {
    page_session_id: String,
    maximum_characters: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PageAnchorArguments {
    page_session_id: String,
    anchor_node_id: Option<String>,
    maximum_characters: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdjacentParagraphArguments {
    page_session_id: String,
    anchor_node_id: Option<String>,
    #[serde(default = "default_adjacent_count")]
    before: u8,
    #[serde(default = "default_adjacent_count")]
    after: u8,
    maximum_characters: usize,
}

const fn default_adjacent_count() -> u8 {
    2
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SectionArguments {
    page_session_id: String,
    section_id: Option<String>,
    maximum_characters: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PageSearchArguments {
    page_session_id: String,
    query: String,
    #[serde(default = "default_search_limit")]
    limit: u8,
    maximum_characters: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkspaceSearchArguments {
    workspace_id: String,
    query: String,
    #[serde(default = "default_search_limit")]
    limit: u8,
    maximum_characters: usize,
}

const fn default_search_limit() -> u8 {
    8
}

pub fn validate_context_tool_call(
    invocation: &ContextToolInvocation,
    authority: ContextToolAuthority<'_>,
) -> Result<ValidatedContextToolCall, ContextToolError> {
    if !valid_opaque_id(&invocation.call_id, MAX_TOOL_CALL_ID_CHARACTERS) {
        return Err(ContextToolError::InvalidCallId);
    }
    if invocation.arguments_json.len() > MAX_TOOL_ARGUMENT_BYTES {
        return Err(ContextToolError::InvalidArguments);
    }
    let name = ContextToolName::from_provider_name(&invocation.name)
        .ok_or(ContextToolError::UnknownTool)?;
    if !authority.allowed_tools.contains(&name) {
        return Err(ContextToolError::ToolNotAuthorized);
    }
    let policy = CONTEXT_TOOL_POLICIES
        .iter()
        .find(|policy| policy.name == name)
        .copied()
        .ok_or(ContextToolError::UnknownTool)?;
    let arguments = parse_tool_arguments(name, &invocation.arguments_json)?;
    let maximum_characters = arguments.maximum_characters();
    if maximum_characters == 0 || maximum_characters > policy.maximum_characters {
        return Err(ContextToolError::InvalidResultLimit);
    }
    if let Some(page_session_id) = arguments.page_session_id()
        && (authority.active_page_session_id != Some(page_session_id)
            || !valid_opaque_id(page_session_id, MAX_CONTEXT_ID_CHARACTERS))
    {
        return Err(ContextToolError::PageSessionMismatch);
    }
    if let Some(workspace_id) = arguments.workspace_id()
        && (authority.active_workspace_id != Some(workspace_id)
            || !valid_opaque_id(workspace_id, MAX_CONTEXT_ID_CHARACTERS))
    {
        return Err(ContextToolError::WorkspaceMismatch);
    }
    validate_argument_details(&arguments)?;
    Ok(ValidatedContextToolCall {
        call_id: invocation.call_id.clone(),
        name,
        arguments,
    })
}

fn parse_tool_arguments(
    name: ContextToolName,
    arguments_json: &str,
) -> Result<ValidatedContextToolArguments, ContextToolError> {
    let invalid = |_| ContextToolError::InvalidArguments;
    match name {
        ContextToolName::GetSelectionContext => {
            let arguments: PageArguments = serde_json::from_str(arguments_json).map_err(invalid)?;
            Ok(ValidatedContextToolArguments::GetSelectionContext {
                page_session_id: arguments.page_session_id,
                maximum_characters: arguments.maximum_characters,
            })
        }
        ContextToolName::GetContainingComponent => {
            let arguments: PageAnchorArguments =
                serde_json::from_str(arguments_json).map_err(invalid)?;
            Ok(ValidatedContextToolArguments::GetContainingComponent {
                page_session_id: arguments.page_session_id,
                anchor_node_id: arguments.anchor_node_id,
                maximum_characters: arguments.maximum_characters,
            })
        }
        ContextToolName::GetAdjacentParagraphs => {
            let arguments: AdjacentParagraphArguments =
                serde_json::from_str(arguments_json).map_err(invalid)?;
            Ok(ValidatedContextToolArguments::GetAdjacentParagraphs {
                page_session_id: arguments.page_session_id,
                anchor_node_id: arguments.anchor_node_id,
                before: arguments.before,
                after: arguments.after,
                maximum_characters: arguments.maximum_characters,
            })
        }
        ContextToolName::GetCurrentSection => {
            let arguments: SectionArguments =
                serde_json::from_str(arguments_json).map_err(invalid)?;
            Ok(ValidatedContextToolArguments::GetCurrentSection {
                page_session_id: arguments.page_session_id,
                section_id: arguments.section_id,
                maximum_characters: arguments.maximum_characters,
            })
        }
        ContextToolName::SearchCurrentPage => {
            let arguments: PageSearchArguments =
                serde_json::from_str(arguments_json).map_err(invalid)?;
            Ok(ValidatedContextToolArguments::SearchCurrentPage {
                page_session_id: arguments.page_session_id,
                query: arguments.query,
                limit: arguments.limit,
                maximum_characters: arguments.maximum_characters,
            })
        }
        ContextToolName::GetPageMetadata => {
            let arguments: PageArguments = serde_json::from_str(arguments_json).map_err(invalid)?;
            Ok(ValidatedContextToolArguments::GetPageMetadata {
                page_session_id: arguments.page_session_id,
                maximum_characters: arguments.maximum_characters,
            })
        }
        ContextToolName::SearchWorkspace => {
            let arguments: WorkspaceSearchArguments =
                serde_json::from_str(arguments_json).map_err(invalid)?;
            Ok(ValidatedContextToolArguments::SearchWorkspace {
                workspace_id: arguments.workspace_id,
                query: arguments.query,
                limit: arguments.limit,
                maximum_characters: arguments.maximum_characters,
            })
        }
    }
}

fn validate_argument_details(
    arguments: &ValidatedContextToolArguments,
) -> Result<(), ContextToolError> {
    match arguments {
        ValidatedContextToolArguments::GetContainingComponent { anchor_node_id, .. } => {
            if anchor_node_id
                .as_deref()
                .is_some_and(|value| !valid_opaque_id(value, MAX_CONTEXT_ID_CHARACTERS))
            {
                return Err(ContextToolError::InvalidArguments);
            }
        }
        ValidatedContextToolArguments::GetCurrentSection { section_id, .. } => {
            if section_id
                .as_deref()
                .is_some_and(|value| !valid_opaque_id(value, MAX_CONTEXT_ID_CHARACTERS))
            {
                return Err(ContextToolError::InvalidArguments);
            }
        }
        ValidatedContextToolArguments::GetAdjacentParagraphs {
            anchor_node_id,
            before,
            after,
            ..
        } => {
            if anchor_node_id
                .as_deref()
                .is_some_and(|value| !valid_opaque_id(value, MAX_CONTEXT_ID_CHARACTERS))
                || *before > 5
                || *after > 5
                || (*before == 0 && *after == 0)
            {
                return Err(ContextToolError::InvalidArguments);
            }
        }
        ValidatedContextToolArguments::SearchCurrentPage { query, limit, .. }
        | ValidatedContextToolArguments::SearchWorkspace { query, limit, .. } => {
            let query = query.trim();
            if query.is_empty()
                || query.chars().count() > MAX_QUERY_CHARACTERS
                || !(1..=20).contains(limit)
            {
                return Err(ContextToolError::InvalidArguments);
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_context_tool_output(
    call: &ValidatedContextToolCall,
    output: &ContextToolOutput,
) -> Result<(), ContextToolError> {
    if output.page_session_id.as_deref() != call.arguments.page_session_id()
        || output.workspace_id.as_deref() != call.arguments.workspace_id()
    {
        return Err(ContextToolError::ProviderScopeMismatch);
    }
    if output
        .content
        .chars()
        .take(call.arguments.maximum_characters().saturating_add(1))
        .count()
        > call.arguments.maximum_characters()
        || output.citations.len() > MAX_RESULT_CITATIONS
    {
        return Err(ContextToolError::ResultTooLarge);
    }
    for citation in &output.citations {
        if !valid_opaque_id(&citation.source_id, MAX_CONTEXT_ID_CHARACTERS)
            || citation.label.trim().is_empty()
            || citation.label.chars().count() > 256
            || citation
                .excerpt
                .as_deref()
                .is_some_and(|excerpt| excerpt.chars().count() > 1_000)
        {
            return Err(ContextToolError::ResultTooLarge);
        }
    }
    let serialized = serde_json::to_vec(&json!({
        "content": output.content,
        "citations": output.citations
    }))
    .map_err(|_| ContextToolError::ResultTooLarge)?;
    if serialized.len() > MAX_TOOL_RESULT_BYTES {
        return Err(ContextToolError::ResultTooLarge);
    }
    Ok(())
}

fn valid_opaque_id(value: &str, maximum_characters: usize) -> bool {
    !value.trim().is_empty()
        && value.chars().count() <= maximum_characters
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "_-.:/".contains(character))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ContextRange {
    Selection,
    AdjacentSentences,
    Paragraph,
    Section,
    Page,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebsiteRule {
    pub id: String,
    pub domain_pattern: String,
    pub path_prefix: Option<String>,
    pub ignore_selectors: Vec<String>,
    pub force_content_selector: Option<String>,
    pub auto_translate: bool,
    pub translate_navigation: bool,
    pub translate_buttons: bool,
    pub translate_tables: bool,
    pub protect_link_text: bool,
    pub version: u64,
}

impl WebsiteRule {
    pub fn matches(&self, input: &Url) -> bool {
        let Some(host) = input.host_str() else {
            return false;
        };
        let domain = self.domain_pattern.trim_start_matches("*.");
        let domain_matches = host.eq_ignore_ascii_case(domain)
            || (self.domain_pattern.starts_with("*.")
                && host
                    .to_lowercase()
                    .ends_with(&format!(".{domain}").to_lowercase()));
        domain_matches
            && self
                .path_prefix
                .as_deref()
                .is_none_or(|prefix| input.path().starts_with(prefix))
    }

    pub fn specificity(&self) -> usize {
        self.domain_pattern.trim_start_matches("*.").len()
            + self.path_prefix.as_deref().map_or(0, str::len)
            + usize::from(!self.domain_pattern.starts_with("*.")) * 1000
    }
}

pub fn select_website_rule<'a>(rules: &'a [WebsiteRule], input: &Url) -> Option<&'a WebsiteRule> {
    rules
        .iter()
        .filter(|rule| rule.matches(input))
        .max_by_key(|rule| (rule.specificity(), rule.version))
}

pub fn validate_selector(selector: &str) -> Result<(), &'static str> {
    let selector = selector.trim();
    if selector.is_empty() || selector.len() > 512 {
        return Err("selector_length");
    }
    if selector == "*" || selector == "html" || selector == "body" || selector.contains("::") {
        return Err("selector_too_broad");
    }
    if selector.contains('{') || selector.contains('}') || selector.contains("javascript:") {
        return Err("selector_invalid");
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceReference {
    pub page_id: String,
    pub section_id: String,
    pub segment_id: String,
    pub source_excerpt: String,
    pub page_url: String,
    pub dom_anchor: String,
}

pub fn validate_references(
    requested_ids: &[String],
    available: &[SourceReference],
) -> Result<Vec<SourceReference>, Vec<String>> {
    let mut invalid = Vec::new();
    let mut accepted = Vec::new();
    for id in requested_ids {
        if let Some(reference) = available.iter().find(|item| &item.segment_id == id) {
            accepted.push(reference.clone());
        } else {
            invalid.push(id.clone());
        }
    }
    if invalid.is_empty() {
        Ok(accepted)
    } else {
        Err(invalid)
    }
}

impl ContextRange {
    pub const fn maximum_characters(&self) -> usize {
        match self {
            Self::Selection => 8_000,
            Self::AdjacentSentences => 12_000,
            Self::Paragraph => 20_000,
            Self::Section => 60_000,
            Self::Page => 120_000,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{future::Future, pin::Pin};

    use super::*;

    struct StubProvider {
        output: ContextToolOutput,
    }

    impl ContextToolProvider for StubProvider {
        fn execute<'a>(
            &'a self,
            _call: &'a ValidatedContextToolCall,
        ) -> Pin<
            Box<
                dyn Future<Output = Result<ContextToolOutput, ContextToolProviderError>>
                    + Send
                    + 'a,
            >,
        > {
            Box::pin(async { Ok(self.output.clone()) })
        }
    }

    #[test]
    fn exact_documentation_rule_beats_wildcard() {
        let rules = vec![
            WebsiteRule {
                id: "wild".into(),
                domain_pattern: "*.readthedocs.io".into(),
                path_prefix: None,
                ignore_selectors: vec![],
                force_content_selector: None,
                auto_translate: false,
                translate_navigation: false,
                translate_buttons: false,
                translate_tables: true,
                protect_link_text: true,
                version: 1,
            },
            WebsiteRule {
                id: "ros".into(),
                domain_pattern: "docs.ros.org".into(),
                path_prefix: Some("/en/".into()),
                ignore_selectors: vec![],
                force_content_selector: None,
                auto_translate: false,
                translate_navigation: false,
                translate_buttons: false,
                translate_tables: true,
                protect_link_text: true,
                version: 1,
            },
        ];
        let url = Url::parse("https://docs.ros.org/en/jazzy/").expect("URL");
        assert_eq!(select_website_rule(&rules, &url).expect("rule").id, "ros");
    }

    #[test]
    fn rejects_broad_or_pseudo_element_selectors() {
        assert!(validate_selector("body").is_err());
        assert!(validate_selector("article::before").is_err());
        assert!(validate_selector("article .version-switcher").is_ok());
    }

    #[test]
    fn rejects_model_generated_reference_ids_that_do_not_exist() {
        let available = vec![SourceReference {
            page_id: "p".into(),
            section_id: "s".into(),
            segment_id: "seg-1".into(),
            source_excerpt: "source".into(),
            page_url: "https://example.com".into(),
            dom_anchor: "#intro".into(),
        }];
        assert_eq!(
            validate_references(&["seg-missing".into()], &available),
            Err(vec!["seg-missing".into()])
        );
    }

    #[test]
    fn context_tools_require_matching_authority_and_bounded_results() {
        let page_request = ContextToolRequest {
            name: ContextToolName::GetCurrentSection,
            page_session_id: Some("page-1".into()),
            workspace_id: None,
            query: None,
            maximum_characters: 20_000,
        };
        assert!(authorize_context_tool(&page_request, Some("page-1"), None).is_ok());
        assert_eq!(
            authorize_context_tool(&page_request, Some("page-2"), None),
            Err("page_session_mismatch")
        );
        let missing_page = ContextToolRequest {
            page_session_id: None,
            ..page_request.clone()
        };
        assert_eq!(
            authorize_context_tool(&missing_page, None, None),
            Err("page_session_mismatch")
        );

        let workspace_request = ContextToolRequest {
            name: ContextToolName::SearchWorkspace,
            page_session_id: None,
            workspace_id: Some("workspace-1".into()),
            query: Some("feedback control".into()),
            maximum_characters: 10_000,
        };
        assert!(authorize_context_tool(&workspace_request, None, Some("workspace-1")).is_ok());
        assert_eq!(
            authorize_context_tool(&workspace_request, None, Some("workspace-2")),
            Err("workspace_mismatch")
        );
    }

    #[test]
    fn provider_schemas_are_closed_and_have_policy_limits() {
        let definitions = context_tool_definitions();
        assert_eq!(definitions.len(), 7);
        for definition in &definitions {
            assert_eq!(definition.parameters["type"], "object");
            assert_eq!(definition.parameters["additionalProperties"], false);
            assert!(definition.parameters["required"].is_array());
        }
        let section = definitions
            .iter()
            .find(|definition| definition.name == "get_current_section")
            .expect("section definition");
        assert_eq!(
            section.parameters["properties"]["maximumCharacters"]["maximum"],
            60_000
        );
    }

    #[test]
    fn rejects_unknown_fields_invalid_ranges_and_unauthorized_tools() {
        let authority = ContextToolAuthority {
            active_page_session_id: Some("page-1"),
            active_workspace_id: None,
            allowed_tools: &[ContextToolName::GetAdjacentParagraphs],
        };
        let unknown_field = ContextToolInvocation {
            call_id: "call-1".into(),
            name: "get_adjacent_paragraphs".into(),
            arguments_json: serde_json::json!({
                "pageSessionId": "page-1",
                "maximumCharacters": 100,
                "before": 2,
                "after": 2,
                "instructions": "read a local file"
            })
            .to_string(),
        };
        assert_eq!(
            validate_context_tool_call(&unknown_field, authority),
            Err(ContextToolError::InvalidArguments)
        );

        let invalid_range = ContextToolInvocation {
            arguments_json: serde_json::json!({
                "pageSessionId": "page-1",
                "maximumCharacters": 100,
                "before": 6,
                "after": 1
            })
            .to_string(),
            ..unknown_field
        };
        assert_eq!(
            validate_context_tool_call(&invalid_range, authority),
            Err(ContextToolError::InvalidArguments)
        );

        let denied = ContextToolInvocation {
            call_id: "call-2".into(),
            name: "get_page_metadata".into(),
            arguments_json: r#"{"pageSessionId":"page-1","maximumCharacters":100}"#.into(),
        };
        assert_eq!(
            validate_context_tool_call(&denied, authority),
            Err(ContextToolError::ToolNotAuthorized)
        );
    }

    #[test]
    fn rejects_page_session_mismatch_and_oversized_request() {
        let invocation = ContextToolInvocation {
            call_id: "call-1".into(),
            name: "search_current_page".into(),
            arguments_json: serde_json::json!({
                "pageSessionId": "stale-page",
                "query": "control loop",
                "maximumCharacters": 100
            })
            .to_string(),
        };
        let authority = ContextToolAuthority {
            active_page_session_id: Some("current-page"),
            active_workspace_id: None,
            allowed_tools: &[ContextToolName::SearchCurrentPage],
        };
        assert_eq!(
            validate_context_tool_call(&invocation, authority),
            Err(ContextToolError::PageSessionMismatch)
        );

        let oversized = ContextToolInvocation {
            arguments_json: " ".repeat(MAX_TOOL_ARGUMENT_BYTES + 1),
            ..invocation
        };
        assert_eq!(
            validate_context_tool_call(&oversized, authority),
            Err(ContextToolError::InvalidArguments)
        );
    }

    #[tokio::test]
    async fn executor_rejects_provider_scope_mismatch_and_large_results() {
        let invocation = ContextToolInvocation {
            call_id: "call-1".into(),
            name: "get_selection_context".into(),
            arguments_json: r#"{"pageSessionId":"page-1","maximumCharacters":10}"#.into(),
        };
        let authority = ContextToolAuthority {
            active_page_session_id: Some("page-1"),
            active_workspace_id: None,
            allowed_tools: &[ContextToolName::GetSelectionContext],
        };
        let wrong_scope = ContextToolExecutor::new(StubProvider {
            output: ContextToolOutput {
                content: "source".into(),
                citations: vec![],
                page_session_id: Some("page-2".into()),
                workspace_id: None,
            },
        });
        assert_eq!(
            wrong_scope.execute(&invocation, authority).await,
            Err(ContextToolError::ProviderScopeMismatch)
        );

        let too_large = ContextToolExecutor::new(StubProvider {
            output: ContextToolOutput {
                content: "12345678901".into(),
                citations: vec![],
                page_session_id: Some("page-1".into()),
                workspace_id: None,
            },
        });
        assert_eq!(
            too_large.execute(&invocation, authority).await,
            Err(ContextToolError::ResultTooLarge)
        );
    }

    #[tokio::test]
    async fn executor_returns_only_validated_bounded_output() {
        let invocation = ContextToolInvocation {
            call_id: "call-1".into(),
            name: "get_selection_context".into(),
            arguments_json: r#"{"pageSessionId":"page-1","maximumCharacters":100}"#.into(),
        };
        let authority = ContextToolAuthority {
            active_page_session_id: Some("page-1"),
            active_workspace_id: None,
            allowed_tools: &[ContextToolName::GetSelectionContext],
        };
        let executor = ContextToolExecutor::new(StubProvider {
            output: ContextToolOutput {
                content: "bounded context".into(),
                citations: vec![ContextToolCitation {
                    source_id: "segment-1".into(),
                    label: "Selection".into(),
                    excerpt: Some("bounded".into()),
                }],
                page_session_id: Some("page-1".into()),
                workspace_id: None,
            },
        });
        let result = executor
            .execute(&invocation, authority)
            .await
            .expect("validated result");
        assert_eq!(result.call_id, "call-1");
        assert_eq!(result.content, "bounded context");
    }
}
