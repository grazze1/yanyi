//! Global memory: who the user is, what they prefer, and how they want answers
//! written.
//!
//! Deliberately separate from the glossary (how a term is translated) and from
//! workspaces (which documents belong to a project). Two rules shape this module:
//!
//! 1. Nothing is persisted without an explicit user action. Imports produce
//!    reviewable candidates, never direct writes.
//! 2. Retrieval selects only memories relevant to the current task. The whole
//!    library is never appended to a prompt, because that raises token cost
//!    instead of lowering it.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::DatabaseError;

pub const MEMORY_TYPES: [&str; 7] = [
    "profile",
    "preference",
    "response_style",
    "domain_background",
    "translation_preference",
    "personal_context",
    "custom",
];

const MAX_TITLE_CHARS: usize = 200;
const MAX_CONTENT_CHARS: usize = 4_000;

/// Folds content for duplicate detection: trimmed, lowercased, whitespace collapsed.
pub fn normalize_memory_content(content: &str) -> String {
    content
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// True when the text looks like a strict "translate X as Y" rule. Such entries
/// belong in the glossary, where they bind translation output, rather than being
/// duplicated as free-text memory.
pub fn looks_like_glossary_rule(content: &str) -> bool {
    let folded = content.trim();
    if folded.chars().count() > 120 {
        return false;
    }
    const MARKERS: [&str; 6] = [
        "固定翻译为",
        "固定译为",
        "统一翻译为",
        "译为",
        "翻译成",
        "must be translated as",
    ];
    MARKERS.iter().any(|marker| folded.contains(marker))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct GlobalMemoryRecord {
    pub id: String,
    #[sqlx(rename = "type")]
    #[serde(rename = "type")]
    pub memory_type: String,
    pub title: String,
    pub content: String,
    pub enabled: bool,
    pub pinned: bool,
    pub priority: i64,
    pub source_type: String,
    pub source_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_used_at: Option<String>,
    pub usage_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalMemoryInput {
    #[serde(rename = "type")]
    pub memory_type: String,
    #[serde(default)]
    pub title: String,
    pub content: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub priority: i64,
    #[serde(default)]
    pub tags: Vec<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct GlobalMemoryCandidateRecord {
    pub id: String,
    pub job_id: String,
    #[sqlx(rename = "type")]
    #[serde(rename = "type")]
    pub memory_type: String,
    pub title: String,
    pub content: String,
    pub state: String,
    pub glossary_hint: bool,
    pub ordinal: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct GlobalMemoryImportJobRecord {
    pub id: String,
    pub source_name: String,
    pub source_format: String,
    pub source_bytes: i64,
    pub state: String,
    pub candidate_count: i64,
    pub accepted_count: i64,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// A memory selected by retrieval, with the score that selected it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievedGlobalMemory {
    pub memory: GlobalMemoryRecord,
    pub score: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalMemorySnapshot {
    pub version: i64,
    pub fingerprint: String,
    pub stable_profile: String,
    pub stable_preferences: String,
    pub stable_response_style: String,
    pub memory_count: i64,
}

#[derive(Debug, Error)]
pub enum GlobalMemoryError {
    #[error("unsupported memory type: {0}")]
    UnsupportedType(String),
    #[error("memory content must not be empty")]
    EmptyContent,
    #[error("memory content exceeds the {MAX_CONTENT_CHARS} character limit")]
    ContentTooLong,
    #[error("an identical memory of this type already exists")]
    Duplicate,
    #[error("memory was not found")]
    NotFound,
    #[error(transparent)]
    Database(#[from] DatabaseError),
}

use thiserror::Error;

fn validate(input: &GlobalMemoryInput) -> Result<(String, String, String), GlobalMemoryError> {
    if !MEMORY_TYPES.contains(&input.memory_type.as_str()) {
        return Err(GlobalMemoryError::UnsupportedType(
            input.memory_type.clone(),
        ));
    }
    let content = input.content.trim();
    if content.is_empty() {
        return Err(GlobalMemoryError::EmptyContent);
    }
    if content.chars().count() > MAX_CONTENT_CHARS {
        return Err(GlobalMemoryError::ContentTooLong);
    }
    let title: String = input.title.trim().chars().take(MAX_TITLE_CHARS).collect();
    Ok((title, content.to_owned(), normalize_memory_content(content)))
}

impl super::Repository {
    /// Creates one global memory. Rejects duplicates within the same type so the
    /// stable prompt prefix cannot accumulate repeated text.
    pub async fn create_global_memory(
        &self,
        input: GlobalMemoryInput,
    ) -> Result<String, GlobalMemoryError> {
        let (title, content, normalized) = validate(&input)?;
        let id = Uuid::new_v4().to_string();
        let mut transaction = self.pool().begin().await.map_err(DatabaseError::Connect)?;
        let existing: Option<String> = sqlx::query_scalar(
            "SELECT id FROM global_memories WHERE type=? AND normalized_content=?",
        )
        .bind(&input.memory_type)
        .bind(&normalized)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(DatabaseError::Connect)?;
        if existing.is_some() {
            return Err(GlobalMemoryError::Duplicate);
        }
        sqlx::query(
            "INSERT INTO global_memories(id,type,title,content,normalized_content,enabled,pinned,priority,source_type,source_id,created_at,updated_at) \
             VALUES(?,?,?,?,?,?,?,?,'manual',NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        )
        .bind(&id)
        .bind(&input.memory_type)
        .bind(&title)
        .bind(&content)
        .bind(&normalized)
        .bind(input.enabled)
        .bind(input.pinned)
        .bind(input.priority.clamp(-100, 100))
        .execute(&mut *transaction)
        .await
        .map_err(DatabaseError::Connect)?;
        for tag in normalized_tags(&input.tags) {
            attach_tag(&mut transaction, &id, &tag).await?;
        }
        transaction.commit().await.map_err(DatabaseError::Connect)?;
        self.invalidate_global_memory_snapshot().await?;
        Ok(id)
    }

    pub async fn update_global_memory(
        &self,
        id: &str,
        input: GlobalMemoryInput,
    ) -> Result<(), GlobalMemoryError> {
        let (title, content, normalized) = validate(&input)?;
        let mut transaction = self.pool().begin().await.map_err(DatabaseError::Connect)?;
        let conflicting: Option<String> = sqlx::query_scalar(
            "SELECT id FROM global_memories WHERE type=? AND normalized_content=? AND id<>?",
        )
        .bind(&input.memory_type)
        .bind(&normalized)
        .bind(id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(DatabaseError::Connect)?;
        if conflicting.is_some() {
            return Err(GlobalMemoryError::Duplicate);
        }
        let affected = sqlx::query(
            "UPDATE global_memories SET type=?,title=?,content=?,normalized_content=?,enabled=?,pinned=?,priority=?, \
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
        )
        .bind(&input.memory_type)
        .bind(&title)
        .bind(&content)
        .bind(&normalized)
        .bind(input.enabled)
        .bind(input.pinned)
        .bind(input.priority.clamp(-100, 100))
        .bind(id)
        .execute(&mut *transaction)
        .await
        .map_err(DatabaseError::Connect)?
        .rows_affected();
        if affected == 0 {
            return Err(GlobalMemoryError::NotFound);
        }
        sqlx::query("DELETE FROM global_memory_tag_links WHERE memory_id=?")
            .bind(id)
            .execute(&mut *transaction)
            .await
            .map_err(DatabaseError::Connect)?;
        for tag in normalized_tags(&input.tags) {
            attach_tag(&mut transaction, id, &tag).await?;
        }
        transaction.commit().await.map_err(DatabaseError::Connect)?;
        self.invalidate_global_memory_snapshot().await?;
        Ok(())
    }

    pub async fn set_global_memory_enabled(
        &self,
        id: &str,
        enabled: bool,
    ) -> Result<(), GlobalMemoryError> {
        let affected = sqlx::query(
            "UPDATE global_memories SET enabled=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
        )
        .bind(enabled)
        .bind(id)
        .execute(self.pool())
        .await
        .map_err(DatabaseError::Connect)?
        .rows_affected();
        if affected == 0 {
            return Err(GlobalMemoryError::NotFound);
        }
        self.invalidate_global_memory_snapshot().await?;
        Ok(())
    }

    pub async fn set_global_memory_pinned(
        &self,
        id: &str,
        pinned: bool,
    ) -> Result<(), GlobalMemoryError> {
        let affected = sqlx::query(
            "UPDATE global_memories SET pinned=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
        )
        .bind(pinned)
        .bind(id)
        .execute(self.pool())
        .await
        .map_err(DatabaseError::Connect)?
        .rows_affected();
        if affected == 0 {
            return Err(GlobalMemoryError::NotFound);
        }
        self.invalidate_global_memory_snapshot().await?;
        Ok(())
    }

    pub async fn delete_global_memory(&self, id: &str) -> Result<(), GlobalMemoryError> {
        let affected = sqlx::query("DELETE FROM global_memories WHERE id=?")
            .bind(id)
            .execute(self.pool())
            .await
            .map_err(DatabaseError::Connect)?
            .rows_affected();
        if affected == 0 {
            return Err(GlobalMemoryError::NotFound);
        }
        self.invalidate_global_memory_snapshot().await?;
        Ok(())
    }

    /// Lists memories for the management UI, including disabled ones.
    pub async fn list_global_memories(
        &self,
        search: &str,
        memory_type: Option<&str>,
        limit: u32,
    ) -> Result<Vec<GlobalMemoryRecord>, DatabaseError> {
        let needle = format!("%{}%", search.trim().to_lowercase());
        Ok(sqlx::query_as(
            "SELECT id,type,title,content,enabled,pinned,priority,source_type,source_id,created_at,updated_at,last_used_at,usage_count \
             FROM global_memories \
             WHERE (?1='%%' OR normalized_content LIKE ?1 OR lower(title) LIKE ?1) \
               AND (?2 IS NULL OR type=?2) \
             ORDER BY pinned DESC, priority DESC, updated_at DESC LIMIT ?3",
        )
        .bind(needle)
        .bind(memory_type)
        .bind(crate::repository::bounded_limit(limit))
        .fetch_all(self.pool())
        .await?)
    }

    pub async fn global_memory_tags(&self, id: &str) -> Result<Vec<String>, DatabaseError> {
        Ok(sqlx::query_scalar(
            "SELECT t.name FROM global_memory_tags t \
             JOIN global_memory_tag_links l ON l.tag_id=t.id \
             WHERE l.memory_id=? ORDER BY t.name",
        )
        .bind(id)
        .fetch_all(self.pool())
        .await?)
    }

    /// Selects only the memories relevant to the current task.
    ///
    /// Pinned entries are always eligible because the user marked them as
    /// always-applicable. Everything else must match the query text through FTS5.
    /// Disabled memories are never returned.
    pub async fn retrieve_global_memories(
        &self,
        query: &str,
        limit: u32,
    ) -> Result<Vec<RetrievedGlobalMemory>, DatabaseError> {
        let terms = fts_query(query);
        let pinned: Vec<GlobalMemoryRecord> = sqlx::query_as(
            "SELECT id,type,title,content,enabled,pinned,priority,source_type,source_id,created_at,updated_at,last_used_at,usage_count \
             FROM global_memories WHERE enabled=1 AND pinned=1 ORDER BY priority DESC, updated_at DESC LIMIT ?",
        )
        .bind(crate::repository::bounded_limit(limit))
        .fetch_all(self.pool())
        .await?;
        let matched: Vec<GlobalMemoryRecord> = match terms {
            None => Vec::new(),
            Some(ref expression) => sqlx::query_as(
                "SELECT m.id,m.type,m.title,m.content,m.enabled,m.pinned,m.priority,m.source_type,m.source_id, \
                        m.created_at,m.updated_at,m.last_used_at,m.usage_count \
                 FROM global_memories_fts f \
                 JOIN global_memories m ON m.rowid=f.rowid \
                 WHERE f.global_memories_fts MATCH ? AND m.enabled=1 AND m.pinned=0 \
                 ORDER BY bm25(global_memories_fts) LIMIT ?",
            )
            .bind(expression)
            .bind(crate::repository::bounded_limit(limit))
            .fetch_all(self.pool())
            .await?,
        };
        let mut selected: Vec<RetrievedGlobalMemory> = Vec::new();
        for (rank, memory) in pinned.into_iter().enumerate() {
            let score = 100.0 - rank as f64 + memory.priority as f64;
            selected.push(RetrievedGlobalMemory { memory, score });
        }
        for (rank, memory) in matched.into_iter().enumerate() {
            // Later FTS ranks score lower; type and priority break ties.
            let type_weight = match memory.memory_type.as_str() {
                "profile" | "response_style" => 3.0,
                "preference" | "translation_preference" => 2.5,
                "domain_background" => 2.0,
                _ => 1.0,
            };
            let score = 50.0 - rank as f64 + type_weight + memory.priority as f64;
            selected.push(RetrievedGlobalMemory { memory, score });
        }
        selected.sort_by(|left, right| right.score.total_cmp(&left.score));
        selected.truncate(limit.clamp(1, 200) as usize);
        Ok(selected)
    }

    /// Records that memories were injected into a prompt. Usage statistics are
    /// intentionally excluded from the snapshot fingerprint so they cannot
    /// invalidate the provider prefix cache.
    pub async fn mark_global_memories_used(&self, ids: &[String]) -> Result<(), DatabaseError> {
        if ids.is_empty() {
            return Ok(());
        }
        let mut transaction = self.pool().begin().await?;
        for id in ids {
            sqlx::query(
                "UPDATE global_memories SET usage_count=usage_count+1, \
                 last_used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
            )
            .bind(id)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    /// Returns the current stable snapshot, building it when memories changed.
    ///
    /// Serialisation is deterministic: fixed section order, entries sorted by
    /// (priority desc, id). No timestamp or random id enters the text, so an
    /// unchanged memory library always produces a byte-identical prefix.
    pub async fn global_memory_snapshot(&self) -> Result<GlobalMemorySnapshot, DatabaseError> {
        if let Some(existing) = sqlx::query_as::<_, (i64, String, String, String, String, i64)>(
            "SELECT version,fingerprint,stable_profile,stable_preferences,stable_response_style,memory_count \
             FROM global_memory_snapshots WHERE is_current=1",
        )
        .fetch_optional(self.pool())
        .await?
        {
            return Ok(GlobalMemorySnapshot {
                version: existing.0,
                fingerprint: existing.1,
                stable_profile: existing.2,
                stable_preferences: existing.3,
                stable_response_style: existing.4,
                memory_count: existing.5,
            });
        }
        self.rebuild_global_memory_snapshot().await
    }

    async fn rebuild_global_memory_snapshot(&self) -> Result<GlobalMemorySnapshot, DatabaseError> {
        let rows: Vec<(String, String, String, i64)> = sqlx::query_as(
            "SELECT id,type,content,priority FROM global_memories \
             WHERE enabled=1 AND pinned=1 ORDER BY priority DESC, id ASC",
        )
        .fetch_all(self.pool())
        .await?;
        let section = |kinds: &[&str]| -> String {
            rows.iter()
                .filter(|(_, memory_type, _, _)| kinds.contains(&memory_type.as_str()))
                .map(|(_, _, content, _)| format!("- {}", content.trim()))
                .collect::<Vec<_>>()
                .join("\n")
        };
        let stable_profile = section(&["profile", "personal_context"]);
        let stable_preferences = section(&["preference", "translation_preference"]);
        let stable_response_style = section(&["response_style", "domain_background"]);
        let fingerprint =
            fingerprint_of(&[&stable_profile, &stable_preferences, &stable_response_style]);
        let memory_count = rows.len() as i64;
        let mut transaction = self.pool().begin().await?;
        // Versions are monotonic across the database lifetime: history is kept so an
        // edit never reuses an earlier version number.
        let next_version: i64 =
            sqlx::query_scalar("SELECT COALESCE(MAX(version),0)+1 FROM global_memory_snapshots")
                .fetch_one(&mut *transaction)
                .await?;
        sqlx::query("UPDATE global_memory_snapshots SET is_current=0 WHERE is_current=1")
            .execute(&mut *transaction)
            .await?;
        sqlx::query(
            "INSERT INTO global_memory_snapshots(version,fingerprint,stable_profile,stable_preferences,stable_response_style,memory_count,is_current,created_at) \
             VALUES(?,?,?,?,?,?,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) \
             ON CONFLICT(fingerprint) DO UPDATE SET is_current=1",
        )
        .bind(next_version)
        .bind(&fingerprint)
        .bind(&stable_profile)
        .bind(&stable_preferences)
        .bind(&stable_response_style)
        .bind(memory_count)
        .execute(&mut *transaction)
        .await?;
        // Reverting to an earlier memory state reuses that state's original version,
        // so an identical prefix always carries an identical cache key.
        let version: i64 =
            sqlx::query_scalar("SELECT version FROM global_memory_snapshots WHERE fingerprint=?")
                .bind(&fingerprint)
                .fetch_one(&mut *transaction)
                .await?;
        transaction.commit().await?;
        Ok(GlobalMemorySnapshot {
            version,
            fingerprint,
            stable_profile,
            stable_preferences,
            stable_response_style,
            memory_count,
        })
    }

    /// Rebuilds the snapshot after a memory change. Called only on writes, never
    /// per request, so the stable prefix is not rewritten between requests.
    async fn invalidate_global_memory_snapshot(&self) -> Result<(), DatabaseError> {
        self.rebuild_global_memory_snapshot().await?;
        Ok(())
    }
}

impl super::Repository {
    /// Stores a parsed import as a reviewable job. No memory is created yet.
    pub async fn create_global_memory_import_job(
        &self,
        source_name: &str,
        format: crate::memory_import::ImportFormat,
        source_bytes: usize,
        candidates: &[crate::memory_import::ParsedCandidate],
    ) -> Result<String, DatabaseError> {
        let job_id = Uuid::new_v4().to_string();
        let mut transaction = self.pool().begin().await?;
        sqlx::query(
            "INSERT INTO global_memory_import_jobs(id,source_name,source_format,source_bytes,state,candidate_count,created_at,updated_at) \
             VALUES(?,?,?,?, 'pending_review',?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        )
        .bind(&job_id)
        .bind(source_name.chars().take(255).collect::<String>())
        .bind(format.as_str())
        .bind(i64::try_from(source_bytes).unwrap_or(i64::MAX))
        .bind(i64::try_from(candidates.len()).unwrap_or(i64::MAX))
        .execute(&mut *transaction)
        .await?;
        for (ordinal, candidate) in candidates.iter().enumerate() {
            // Mark entries that already exist so review shows them as duplicates
            // rather than letting a confirm attempt fail later.
            let duplicate: Option<String> = sqlx::query_scalar(
                "SELECT id FROM global_memories WHERE type=? AND normalized_content=?",
            )
            .bind(&candidate.memory_type)
            .bind(&candidate.normalized_content)
            .fetch_optional(&mut *transaction)
            .await?;
            sqlx::query(
                "INSERT INTO global_memory_candidates(id,job_id,type,title,content,normalized_content,state,glossary_hint,ordinal,created_at,updated_at) \
                 VALUES(?,?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(&job_id)
            .bind(&candidate.memory_type)
            .bind(&candidate.title)
            .bind(&candidate.content)
            .bind(&candidate.normalized_content)
            .bind(if duplicate.is_some() { "duplicate" } else { "pending" })
            .bind(candidate.glossary_hint)
            .bind(i64::try_from(ordinal).unwrap_or(i64::MAX))
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(job_id)
    }

    pub async fn list_global_memory_import_jobs(
        &self,
        limit: u32,
    ) -> Result<Vec<GlobalMemoryImportJobRecord>, DatabaseError> {
        Ok(sqlx::query_as(
            "SELECT id,source_name,source_format,source_bytes,state,candidate_count,accepted_count,error_message,created_at,updated_at \
             FROM global_memory_import_jobs ORDER BY created_at DESC LIMIT ?",
        )
        .bind(crate::repository::bounded_limit(limit))
        .fetch_all(self.pool())
        .await?)
    }

    pub async fn list_global_memory_candidates(
        &self,
        job_id: &str,
    ) -> Result<Vec<GlobalMemoryCandidateRecord>, DatabaseError> {
        Ok(sqlx::query_as(
            "SELECT id,job_id,type,title,content,state,glossary_hint,ordinal \
             FROM global_memory_candidates WHERE job_id=? ORDER BY ordinal",
        )
        .bind(job_id)
        .fetch_all(self.pool())
        .await?)
    }

    /// Confirms selected candidates and writes exactly those as global memories.
    /// Unlisted candidates are rejected, so nothing is saved without review.
    pub async fn apply_global_memory_candidates(
        &self,
        job_id: &str,
        accepted_ids: &[String],
    ) -> Result<usize, GlobalMemoryError> {
        let candidates = self
            .list_global_memory_candidates(job_id)
            .await
            .map_err(GlobalMemoryError::Database)?;
        if candidates.is_empty() {
            return Err(GlobalMemoryError::NotFound);
        }
        let mut created = 0_usize;
        let mut transaction = self.pool().begin().await.map_err(DatabaseError::Connect)?;
        for candidate in &candidates {
            let accepted = accepted_ids.contains(&candidate.id) && candidate.state != "duplicate";
            if !accepted {
                sqlx::query(
                    "UPDATE global_memory_candidates SET state=CASE WHEN state='duplicate' THEN 'duplicate' ELSE 'rejected' END, \
                     updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
                )
                .bind(&candidate.id)
                .execute(&mut *transaction)
                .await
                .map_err(DatabaseError::Connect)?;
                continue;
            }
            let memory_id = Uuid::new_v4().to_string();
            let inserted = sqlx::query(
                "INSERT INTO global_memories(id,type,title,content,normalized_content,enabled,pinned,priority,source_type,source_id,created_at,updated_at) \
                 VALUES(?,?,?,?,?,1,0,0,'import',?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) \
                 ON CONFLICT(type,normalized_content) DO NOTHING",
            )
            .bind(&memory_id)
            .bind(&candidate.memory_type)
            .bind(&candidate.title)
            .bind(&candidate.content)
            .bind(normalize_memory_content(&candidate.content))
            .bind(job_id)
            .execute(&mut *transaction)
            .await
            .map_err(DatabaseError::Connect)?
            .rows_affected();
            let state = if inserted == 0 {
                "duplicate"
            } else {
                "accepted"
            };
            if inserted > 0 {
                created += 1;
            }
            sqlx::query(
                "UPDATE global_memory_candidates SET state=?,memory_id=?, \
                 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
            )
            .bind(state)
            .bind(if inserted == 0 {
                None
            } else {
                Some(&memory_id)
            })
            .bind(&candidate.id)
            .execute(&mut *transaction)
            .await
            .map_err(DatabaseError::Connect)?;
        }
        sqlx::query(
            "UPDATE global_memory_import_jobs SET state='applied',accepted_count=?, \
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
        )
        .bind(i64::try_from(created).unwrap_or(i64::MAX))
        .bind(job_id)
        .execute(&mut *transaction)
        .await
        .map_err(DatabaseError::Connect)?;
        transaction.commit().await.map_err(DatabaseError::Connect)?;
        self.invalidate_global_memory_snapshot().await?;
        Ok(created)
    }

    /// Discards an import without creating any memory.
    pub async fn discard_global_memory_import_job(
        &self,
        job_id: &str,
    ) -> Result<(), DatabaseError> {
        let mut transaction = self.pool().begin().await?;
        sqlx::query(
            "UPDATE global_memory_candidates SET state='rejected', \
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE job_id=? AND state='pending'",
        )
        .bind(job_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE global_memory_import_jobs SET state='discarded', \
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
        )
        .bind(job_id)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    /// Exports every global memory for user inspection and backup.
    pub async fn export_global_memories(&self) -> Result<Vec<GlobalMemoryRecord>, DatabaseError> {
        Ok(sqlx::query_as(
            "SELECT id,type,title,content,enabled,pinned,priority,source_type,source_id,created_at,updated_at,last_used_at,usage_count \
             FROM global_memories ORDER BY type, id",
        )
        .fetch_all(self.pool())
        .await?)
    }
}

fn normalized_tags(tags: &[String]) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    for tag in tags {
        let trimmed = tag.trim();
        if trimmed.is_empty() || trimmed.chars().count() > 64 {
            continue;
        }
        let value = trimmed.to_owned();
        if !seen.contains(&value) {
            seen.push(value);
        }
    }
    seen.truncate(16);
    seen
}

async fn attach_tag(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    memory_id: &str,
    tag: &str,
) -> Result<(), GlobalMemoryError> {
    sqlx::query(
        "INSERT INTO global_memory_tags(id,name,created_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) \
         ON CONFLICT(name) DO NOTHING",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(tag)
    .execute(&mut **transaction)
    .await
    .map_err(DatabaseError::Connect)?;
    let tag_id: String = sqlx::query_scalar("SELECT id FROM global_memory_tags WHERE name=?")
        .bind(tag)
        .fetch_one(&mut **transaction)
        .await
        .map_err(DatabaseError::Connect)?;
    sqlx::query(
        "INSERT INTO global_memory_tag_links(memory_id,tag_id) VALUES(?,?) \
         ON CONFLICT(memory_id,tag_id) DO NOTHING",
    )
    .bind(memory_id)
    .bind(tag_id)
    .execute(&mut **transaction)
    .await
    .map_err(DatabaseError::Connect)?;
    Ok(())
}

/// Builds a safe FTS5 MATCH expression. Each term is quoted so page text can
/// never inject FTS operators, and terms are OR-ed to behave like a topic filter.
fn fts_query(query: &str) -> Option<String> {
    let terms: Vec<String> = query
        .split(|character: char| !character.is_alphanumeric() && !matches!(character, '_' | '-'))
        .filter(|term| term.chars().count() >= 2)
        .take(16)
        .map(|term| format!("\"{}\"", term.replace('"', "")))
        .collect();
    if terms.is_empty() {
        return None;
    }
    Some(terms.join(" OR "))
}

/// Stable, dependency-free content fingerprint (FNV-1a, 64-bit, hex).
fn fingerprint_of(sections: &[&String]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for section in sections {
        for byte in section.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        hash ^= 0x1f;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::{fingerprint_of, fts_query, looks_like_glossary_rule, normalize_memory_content};

    #[test]
    fn normalization_folds_case_and_whitespace() {
        assert_eq!(
            normalize_memory_content("  I  study\tRobotics\n"),
            "i study robotics"
        );
    }

    #[test]
    fn glossary_style_rules_are_detected() {
        assert!(looks_like_glossary_rule(
            "reinforcement learning 固定翻译为强化学习"
        ));
        assert!(!looks_like_glossary_rule("我更喜欢先给结论再解释原因"));
    }

    #[test]
    fn fts_terms_are_quoted_so_page_text_cannot_inject_operators() {
        assert_eq!(
            fts_query("ROS 2 Isaac"),
            Some("\"ROS\" OR \"Isaac\"".into())
        );
        // Bare operators and punctuation become ordinary quoted terms or are dropped.
        assert_eq!(fts_query("a OR* NEAR("), Some("\"OR\" OR \"NEAR\"".into()));
        assert_eq!(fts_query("  "), None);
        assert_eq!(fts_query("a"), None);
    }

    #[test]
    fn fingerprint_is_deterministic_and_order_sensitive() {
        let first = "a".to_owned();
        let second = "b".to_owned();
        assert_eq!(
            fingerprint_of(&[&first, &second]),
            fingerprint_of(&[&first, &second])
        );
        assert_ne!(
            fingerprint_of(&[&first, &second]),
            fingerprint_of(&[&second, &first])
        );
        // Section boundaries matter: ["ab",""] must not collide with ["a","b"].
        let ab = "ab".to_owned();
        let empty = String::new();
        assert_ne!(
            fingerprint_of(&[&ab, &empty]),
            fingerprint_of(&[&first, &second])
        );
    }
}
