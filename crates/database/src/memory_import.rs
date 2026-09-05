//! Parsing imported files into reviewable global-memory candidates.
//!
//! Import never writes to `global_memories`. It produces candidates that the user
//! confirms one by one, so a file can never silently become permanent memory.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::global_memory::{MEMORY_TYPES, looks_like_glossary_rule, normalize_memory_content};

/// Hard cap on an imported file. Keeps parsing bounded and prevents a large paste
/// from turning into thousands of candidates.
pub const MAX_IMPORT_BYTES: usize = 512 * 1024;
pub const MAX_CANDIDATES: usize = 200;
const MAX_CANDIDATE_CHARS: usize = 4_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportFormat {
    Txt,
    Md,
    Json,
}

impl ImportFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Txt => "txt",
            Self::Md => "md",
            Self::Json => "json",
        }
    }

    /// Resolves a format from a file name. Unknown extensions are rejected rather
    /// than guessed, so an unexpected binary is never parsed as text.
    pub fn from_file_name(name: &str) -> Option<Self> {
        let lowered = name.trim().to_lowercase();
        if lowered.ends_with(".txt") {
            Some(Self::Txt)
        } else if lowered.ends_with(".md") || lowered.ends_with(".markdown") {
            Some(Self::Md)
        } else if lowered.ends_with(".json") {
            Some(Self::Json)
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedCandidate {
    #[serde(rename = "type")]
    pub memory_type: String,
    pub title: String,
    pub content: String,
    pub normalized_content: String,
    /// True when the text reads like a strict terminology rule that belongs in the
    /// glossary. Surfaced as a hint; the user still decides.
    pub glossary_hint: bool,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ImportError {
    #[error("imported file exceeds the {MAX_IMPORT_BYTES} byte limit")]
    TooLarge,
    #[error("imported file is not valid UTF-8 text")]
    NotUtf8,
    #[error("imported file contained no usable memory entries")]
    Empty,
    #[error("invalid JSON import: {0}")]
    InvalidJson(String),
    #[error("unsupported memory type in import: {0}")]
    UnsupportedType(String),
}

#[derive(Debug, Deserialize)]
struct JsonImport {
    memories: Vec<JsonMemory>,
}

#[derive(Debug, Deserialize)]
struct JsonMemory {
    #[serde(rename = "type")]
    memory_type: String,
    content: String,
    #[serde(default)]
    title: String,
}

/// Parses raw file bytes into candidates.
///
/// Plain text uses one entry per non-empty line; Markdown additionally treats
/// list items as entries and uses the nearest heading as a default type hint;
/// JSON requires the documented `{"memories":[{"type","content"}]}` shape.
pub fn parse_import(
    bytes: &[u8],
    format: ImportFormat,
    default_type: &str,
) -> Result<Vec<ParsedCandidate>, ImportError> {
    if bytes.len() > MAX_IMPORT_BYTES {
        return Err(ImportError::TooLarge);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| ImportError::NotUtf8)?;
    let fallback_type = if MEMORY_TYPES.contains(&default_type) {
        default_type
    } else {
        "custom"
    };
    let candidates = match format {
        ImportFormat::Json => parse_json(text)?,
        ImportFormat::Md => parse_markdown(text, fallback_type),
        ImportFormat::Txt => parse_lines(text, fallback_type),
    };
    let mut deduplicated: Vec<ParsedCandidate> = Vec::new();
    for candidate in candidates {
        if deduplicated.iter().any(|existing| {
            existing.memory_type == candidate.memory_type
                && existing.normalized_content == candidate.normalized_content
        }) {
            continue;
        }
        deduplicated.push(candidate);
        if deduplicated.len() >= MAX_CANDIDATES {
            break;
        }
    }
    if deduplicated.is_empty() {
        return Err(ImportError::Empty);
    }
    Ok(deduplicated)
}

fn candidate(memory_type: &str, title: &str, content: &str) -> Option<ParsedCandidate> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return None;
    }
    let bounded: String = trimmed.chars().take(MAX_CANDIDATE_CHARS).collect();
    Some(ParsedCandidate {
        memory_type: memory_type.to_owned(),
        title: title.trim().chars().take(200).collect(),
        normalized_content: normalize_memory_content(&bounded),
        glossary_hint: looks_like_glossary_rule(&bounded),
        content: bounded,
    })
}

fn parse_lines(text: &str, default_type: &str) -> Vec<ParsedCandidate> {
    text.lines()
        .filter_map(|line| candidate(default_type, "", strip_bullet(line)))
        .collect()
}

/// Maps a Markdown heading onto a memory type when it names one of the known
/// categories, so a structured export keeps its classification.
fn type_from_heading(heading: &str) -> Option<&'static str> {
    let folded = heading.trim().to_lowercase();
    // Ordered most specific first: "翻译偏好" must not be matched by "偏好".
    const MAPPING: [(&str, &str); 12] = [
        ("翻译偏好", "translation_preference"),
        ("translation", "translation_preference"),
        ("回答风格", "response_style"),
        ("response", "response_style"),
        ("个人资料", "profile"),
        ("profile", "profile"),
        ("背景", "domain_background"),
        ("domain", "domain_background"),
        ("语境", "personal_context"),
        ("context", "personal_context"),
        ("偏好", "preference"),
        ("preference", "preference"),
    ];
    MAPPING
        .iter()
        .find(|(needle, _)| folded.contains(needle))
        .map(|(_, memory_type)| *memory_type)
}

fn parse_markdown(text: &str, default_type: &str) -> Vec<ParsedCandidate> {
    let mut current_type = default_type;
    let mut current_heading = String::new();
    let mut candidates = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(heading) = trimmed.strip_prefix('#') {
            let title = heading.trim_start_matches('#').trim();
            current_heading = title.to_owned();
            current_type = type_from_heading(title).unwrap_or(default_type);
            continue;
        }
        if let Some(parsed) = candidate(current_type, &current_heading, strip_bullet(trimmed)) {
            candidates.push(parsed);
        }
    }
    candidates
}

fn strip_bullet(line: &str) -> &str {
    let trimmed = line.trim();
    for prefix in ["- ", "* ", "+ ", "• "] {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            return rest;
        }
    }
    // Numbered list items such as "1. text".
    if let Some(position) = trimmed.find(". ")
        && position <= 2
        && trimmed[..position].chars().all(char::is_numeric)
    {
        return &trimmed[position + 2..];
    }
    trimmed
}

fn parse_json(text: &str) -> Result<Vec<ParsedCandidate>, ImportError> {
    let parsed: JsonImport =
        serde_json::from_str(text).map_err(|error| ImportError::InvalidJson(error.to_string()))?;
    let mut candidates = Vec::new();
    for memory in parsed.memories {
        if !MEMORY_TYPES.contains(&memory.memory_type.as_str()) {
            return Err(ImportError::UnsupportedType(memory.memory_type));
        }
        if let Some(entry) = candidate(&memory.memory_type, &memory.title, &memory.content) {
            candidates.push(entry);
        }
    }
    Ok(candidates)
}

#[cfg(test)]
mod tests {
    use super::{ImportError, ImportFormat, MAX_IMPORT_BYTES, parse_import};

    #[test]
    fn detects_supported_formats_and_rejects_others() {
        assert_eq!(
            ImportFormat::from_file_name("a.TXT"),
            Some(ImportFormat::Txt)
        );
        assert_eq!(ImportFormat::from_file_name("a.md"), Some(ImportFormat::Md));
        assert_eq!(
            ImportFormat::from_file_name("a.markdown"),
            Some(ImportFormat::Md)
        );
        assert_eq!(
            ImportFormat::from_file_name("a.json"),
            Some(ImportFormat::Json)
        );
        assert_eq!(ImportFormat::from_file_name("a.pdf"), None);
        assert_eq!(ImportFormat::from_file_name("a.exe"), None);
    }

    #[test]
    fn plain_text_becomes_one_candidate_per_line() {
        let candidates = parse_import(
            "我是飞行器设计专业本科生\n\n- 专业软件名称保留英文\n".as_bytes(),
            ImportFormat::Txt,
            "profile",
        )
        .expect("parse text");
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].content, "我是飞行器设计专业本科生");
        assert_eq!(candidates[1].content, "专业软件名称保留英文");
        assert!(
            candidates
                .iter()
                .all(|entry| entry.memory_type == "profile")
        );
    }

    #[test]
    fn markdown_headings_classify_entries() {
        let markdown = "# 回答风格\n- 先给结论再解释\n\n# 翻译偏好\n- 框架名默认保留英文\n";
        let candidates =
            parse_import(markdown.as_bytes(), ImportFormat::Md, "custom").expect("parse markdown");
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].memory_type, "response_style");
        assert_eq!(candidates[0].title, "回答风格");
        assert_eq!(candidates[1].memory_type, "translation_preference");
    }

    #[test]
    fn json_import_requires_the_documented_schema() {
        let json = r#"{"memories":[{"type":"profile","content":"我是机器人方向学生"},
                                   {"type":"translation_preference","content":"框架名默认保留英文"}]}"#;
        let candidates =
            parse_import(json.as_bytes(), ImportFormat::Json, "custom").expect("parse json");
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].memory_type, "profile");

        let wrong_shape = parse_import(br#"{"items":[]}"#, ImportFormat::Json, "custom");
        assert!(matches!(wrong_shape, Err(ImportError::InvalidJson(_))));

        let bad_type = parse_import(
            br#"{"memories":[{"type":"secrets","content":"x"}]}"#,
            ImportFormat::Json,
            "custom",
        );
        assert_eq!(
            bad_type,
            Err(ImportError::UnsupportedType("secrets".to_owned()))
        );
    }

    #[test]
    fn glossary_style_entries_are_flagged_for_the_glossary_instead() {
        let candidates = parse_import(
            "reinforcement learning 固定翻译为强化学习".as_bytes(),
            ImportFormat::Txt,
            "translation_preference",
        )
        .expect("parse text");
        assert!(candidates[0].glossary_hint);
    }

    #[test]
    fn duplicate_lines_collapse_to_one_candidate() {
        let candidates = parse_import(
            "保留英文框架名\n保留英文框架名\n  保留英文框架名  \n".as_bytes(),
            ImportFormat::Txt,
            "preference",
        )
        .expect("parse text");
        assert_eq!(candidates.len(), 1);
    }

    #[test]
    fn oversized_and_invalid_input_is_refused() {
        let oversized = vec![b'a'; MAX_IMPORT_BYTES + 1];
        assert_eq!(
            parse_import(&oversized, ImportFormat::Txt, "custom"),
            Err(ImportError::TooLarge)
        );
        assert_eq!(
            parse_import(&[0xff, 0xfe, 0xfd], ImportFormat::Txt, "custom"),
            Err(ImportError::NotUtf8)
        );
        assert_eq!(
            parse_import(b"   \n\n  \n", ImportFormat::Txt, "custom"),
            Err(ImportError::Empty)
        );
    }

    #[test]
    fn unknown_default_type_falls_back_to_custom() {
        let candidates =
            parse_import(b"plain entry", ImportFormat::Txt, "not-a-type").expect("parse text");
        assert_eq!(candidates[0].memory_type, "custom");
    }
}
