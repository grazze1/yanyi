use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum MemoryScope {
    Workspace(String),
    GlobalConfirmed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum MemoryKind {
    AutomaticSummary,
    UserNote,
    CandidateTerm,
    ConfirmedLongTerm,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRecord {
    pub id: String,
    pub workspace_id: Option<String>,
    pub kind: MemoryKind,
    pub content: String,
    pub confirmed: bool,
    pub source_type: String,
    pub updated_unix_seconds: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RankedMemory {
    pub memory: MemoryRecord,
    pub score: f64,
}

pub fn rank_memories(
    records: &[MemoryRecord],
    query_terms: &[String],
    workspace_id: Option<&str>,
    now: SystemTime,
) -> Vec<RankedMemory> {
    let now_seconds = now
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let mut ranked = records
        .iter()
        .filter(|record| match (&record.workspace_id, workspace_id) {
            (Some(record_workspace), Some(current)) => record_workspace == current,
            (Some(_), None) => false,
            (None, _) => record.confirmed,
        })
        .filter_map(|record| {
            let folded = record.content.to_lowercase();
            let matched = query_terms
                .iter()
                .filter(|term| folded.contains(&term.to_lowercase()))
                .count();
            if matched == 0 {
                return None;
            }
            let age_days = now_seconds.saturating_sub(record.updated_unix_seconds) as f64
                / Duration::from_secs(86_400).as_secs_f64();
            let recency = 1.0 / (1.0 + age_days / 30.0);
            let confirmation = if record.confirmed { 2.0 } else { 0.6 };
            let source_weight = match record.kind {
                MemoryKind::ConfirmedLongTerm => 1.5,
                MemoryKind::UserNote => 1.3,
                MemoryKind::AutomaticSummary => 1.0,
                MemoryKind::CandidateTerm => 0.5,
            };
            Some(RankedMemory {
                memory: record.clone(),
                score: matched as f64 * confirmation * source_weight + recency,
            })
        })
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| right.score.total_cmp(&left.score));
    ranked
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub id: String,
    pub first_message_id: String,
    pub last_message_id: String,
    pub source_hash: String,
    pub version: u64,
    pub content: String,
}

impl ConversationSummary {
    pub fn covers(&self, first_message_id: &str, last_message_id: &str, source_hash: &str) -> bool {
        self.first_message_id == first_message_id
            && self.last_message_id == last_message_id
            && self.source_hash == source_hash
    }
}

pub fn may_persist_permanently(kind: &MemoryKind, confirmed: bool) -> bool {
    confirmed && matches!(kind, MemoryKind::ConfirmedLongTerm | MemoryKind::UserNote)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn isolates_workspace_memory_and_weights_confirmed_entries() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(2_000_000);
        let records = vec![
            MemoryRecord {
                id: "confirmed".into(),
                workspace_id: Some("w1".into()),
                kind: MemoryKind::ConfirmedLongTerm,
                content: "PX4 使用 NED 坐标".into(),
                confirmed: true,
                source_type: "user".into(),
                updated_unix_seconds: 1_999_000,
            },
            MemoryRecord {
                id: "other".into(),
                workspace_id: Some("w2".into()),
                kind: MemoryKind::ConfirmedLongTerm,
                content: "PX4 unrelated".into(),
                confirmed: true,
                source_type: "user".into(),
                updated_unix_seconds: 1_999_999,
            },
            MemoryRecord {
                id: "candidate".into(),
                workspace_id: Some("w1".into()),
                kind: MemoryKind::CandidateTerm,
                content: "PX4 candidate".into(),
                confirmed: false,
                source_type: "model".into(),
                updated_unix_seconds: 1_999_999,
            },
        ];
        let ranked = rank_memories(&records, &["PX4".into()], Some("w1"), now);
        assert_eq!(ranked.len(), 2);
        assert_eq!(ranked[0].memory.id, "confirmed");
        assert!(
            ranked
                .iter()
                .all(|item| item.memory.workspace_id.as_deref() == Some("w1"))
        );
    }

    #[test]
    fn candidate_memory_cannot_become_permanent_without_confirmation() {
        assert!(!may_persist_permanently(&MemoryKind::CandidateTerm, true));
        assert!(!may_persist_permanently(
            &MemoryKind::ConfirmedLongTerm,
            false
        ));
        assert!(may_persist_permanently(
            &MemoryKind::ConfirmedLongTerm,
            true
        ));
    }
}
