pub mod secrets;

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;
pub const DATABASE_SCHEMA_VERSION: u32 = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCategory {
    Configuration,
    Authentication,
    Balance,
    RateLimit,
    Network,
    Timeout,
    Provider,
    Protocol,
    Placeholder,
    PageChanged,
    Permission,
    NativeHost,
    Database,
    Import,
    Pdf,
    Cancelled,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuredError {
    pub category: ErrorCategory,
    pub code: String,
    pub user_message: String,
    pub diagnostic_message: String,
    pub retryable: bool,
    pub suggested_action: Option<String>,
    pub source: String,
    pub task_id: Option<String>,
    pub segment_id: Option<String>,
    pub timestamp: String,
}
