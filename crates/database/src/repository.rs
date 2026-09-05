use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Sqlite, SqlitePool, Transaction};
use uuid::Uuid;

use crate::DatabaseError;

pub(crate) fn bounded_limit(limit: u32) -> i64 {
    i64::from(limit.clamp(1, 200))
}

const MAX_CITATIONS_PER_MESSAGE: usize = 32;
const MAX_CITATION_SOURCE_ID_BYTES: usize = 2_048;
const MAX_CITATION_TITLE_BYTES: usize = 1_024;
const MAX_CITATION_EXCERPT_BYTES: usize = 12_000;
const MAX_CITATION_LOCATOR_BYTES: usize = 12_000;

#[derive(Debug)]
struct PreparedMessageCitation {
    id: String,
    source_kind: &'static str,
    source_title: String,
    source_excerpt: String,
    anchor_json: String,
}

fn prepare_message_citations(
    citations: &[MessageCitationInput],
) -> Result<Vec<PreparedMessageCitation>, DatabaseError> {
    if citations.len() > MAX_CITATIONS_PER_MESSAGE {
        return Err(DatabaseError::InvalidMessageCitation(
            "a message cannot contain more than 32 citations",
        ));
    }

    citations
        .iter()
        .map(|citation| {
            if citation.source_kind == MessageCitationSourceKind::Legacy {
                return Err(DatabaseError::InvalidMessageCitation(
                    "legacy is reserved for imported message_sources rows",
                ));
            }
            let source_id = citation
                .source_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let source_title = citation.source_title.trim();
            let source_excerpt = citation.source_excerpt.trim();
            if source_id.is_none() && source_title.is_empty() && source_excerpt.is_empty() {
                return Err(DatabaseError::InvalidMessageCitation(
                    "sourceId, sourceTitle, and sourceExcerpt cannot all be empty",
                ));
            }
            if source_id.is_some_and(|value| value.len() > MAX_CITATION_SOURCE_ID_BYTES) {
                return Err(DatabaseError::InvalidMessageCitation(
                    "sourceId exceeds 2048 UTF-8 bytes",
                ));
            }
            if source_title.len() > MAX_CITATION_TITLE_BYTES {
                return Err(DatabaseError::InvalidMessageCitation(
                    "sourceTitle exceeds 1024 UTF-8 bytes",
                ));
            }
            if source_excerpt.len() > MAX_CITATION_EXCERPT_BYTES {
                return Err(DatabaseError::InvalidMessageCitation(
                    "sourceExcerpt exceeds 12000 UTF-8 bytes",
                ));
            }
            if !citation.locator.is_object() {
                return Err(DatabaseError::InvalidMessageCitation(
                    "locator must be a JSON object",
                ));
            }
            let anchor_json = serde_json::to_string(&serde_json::json!({
                "$yanyiCitation": {
                    "version": 1,
                    "sourceId": source_id,
                },
                "locator": citation.locator,
            }))
            .map_err(|source| DatabaseError::InvalidJson {
                field: "message_citations.anchor_json",
                source,
            })?;
            if anchor_json.len() > MAX_CITATION_LOCATOR_BYTES {
                return Err(DatabaseError::InvalidMessageCitation(
                    "locator exceeds 12000 UTF-8 bytes",
                ));
            }

            Ok(PreparedMessageCitation {
                id: Uuid::new_v4().to_string(),
                source_kind: citation.source_kind.as_str(),
                source_title: source_title.to_owned(),
                source_excerpt: source_excerpt.to_owned(),
                anchor_json,
            })
        })
        .collect()
}

async fn insert_prepared_message_citations(
    transaction: &mut Transaction<'_, Sqlite>,
    message_id: &str,
    citations: &[PreparedMessageCitation],
) -> Result<(), DatabaseError> {
    for citation in citations {
        sqlx::query("INSERT INTO message_citations(id,message_id,document_id,section_id,source_kind,source_title,source_excerpt,anchor_json,created_at) SELECT ?,?,NULL,NULL,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE NOT EXISTS(SELECT 1 FROM message_citations WHERE message_id=? AND source_kind=? AND source_title=? AND source_excerpt=? AND anchor_json=?)")
            .bind(&citation.id)
            .bind(message_id)
            .bind(citation.source_kind)
            .bind(&citation.source_title)
            .bind(&citation.source_excerpt)
            .bind(&citation.anchor_json)
            .bind(message_id)
            .bind(citation.source_kind)
            .bind(&citation.source_title)
            .bind(&citation.source_excerpt)
            .bind(&citation.anchor_json)
            .execute(&mut **transaction)
            .await?;
    }
    Ok(())
}

#[derive(Clone)]
pub struct Repository {
    pool: SqlitePool,
}

impl Repository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub async fn dashboard(&self) -> Result<DashboardSummary, DatabaseError> {
        let workspaces = sqlx::query_scalar(
            "SELECT COUNT(*) FROM workspaces WHERE archived_at IS NULL AND deleted_at IS NULL",
        )
        .fetch_one(&self.pool)
        .await?;
        let glossary_entries = sqlx::query_scalar("SELECT COUNT(*) FROM glossary_entries")
            .fetch_one(&self.pool)
            .await?;
        let candidate_terms =
            sqlx::query_scalar("SELECT COUNT(*) FROM candidate_terms WHERE state = 'pending'")
                .fetch_one(&self.pool)
                .await?;
        let conversations = sqlx::query_scalar("SELECT COUNT(*) FROM conversations")
            .fetch_one(&self.pool)
            .await?;
        let confirmed_memories =
            sqlx::query_scalar("SELECT COUNT(*) FROM memories WHERE confirmed_at IS NOT NULL")
                .fetch_one(&self.pool)
                .await?;
        let translated_pages = sqlx::query_scalar("SELECT COUNT(DISTINCT document_id) FROM translation_tasks WHERE state IN ('completed','partial')")
            .fetch_one(&self.pool).await?;
        let cache_entries = sqlx::query_scalar("SELECT COUNT(*) FROM translation_cache")
            .fetch_one(&self.pool)
            .await?;
        Ok(DashboardSummary {
            workspaces,
            glossary_entries,
            candidate_terms,
            conversations,
            confirmed_memories,
            translated_pages,
            cache_entries,
        })
    }

    pub async fn clear_translation_cache(&self) -> Result<u64, DatabaseError> {
        Ok(sqlx::query("DELETE FROM translation_cache")
            .execute(&self.pool)
            .await?
            .rows_affected())
    }

    pub async fn list_workspaces(
        &self,
        include_archived: bool,
    ) -> Result<Vec<WorkspaceRecord>, DatabaseError> {
        let records = sqlx::query_as::<_, WorkspaceRecord>(
            "SELECT id, name, description, primary_domain, icon, archived_at, created_at, updated_at FROM workspaces WHERE deleted_at IS NULL AND (? OR archived_at IS NULL) ORDER BY updated_at DESC",
        )
        .bind(include_archived)
        .fetch_all(&self.pool)
        .await?;
        Ok(records)
    }

    pub async fn save_workspace(
        &self,
        input: WorkspaceInput,
    ) -> Result<WorkspaceRecord, DatabaseError> {
        let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        sqlx::query("INSERT INTO workspaces(id,name,description,primary_domain,secondary_domains_json,tags_json,icon,created_at,updated_at) VALUES(?,?,?,?, '[]','[]',?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, primary_domain=excluded.primary_domain, icon=excluded.icon, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')")
            .bind(&id)
            .bind(input.name.trim())
            .bind(input.description.trim())
            .bind(input.primary_domain.as_deref())
            .bind(input.icon.as_deref().unwrap_or("book-open"))
            .execute(&self.pool)
            .await?;
        Ok(sqlx::query_as("SELECT id, name, description, primary_domain, icon, archived_at, created_at, updated_at FROM workspaces WHERE id = ?")
            .bind(id).fetch_one(&self.pool).await?)
    }

    pub async fn set_workspace_archived(
        &self,
        id: &str,
        archived: bool,
    ) -> Result<(), DatabaseError> {
        let value = if archived { Some("now") } else { None };
        sqlx::query("UPDATE workspaces SET archived_at = CASE WHEN ? IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ','now') END, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND deleted_at IS NULL").bind(value).bind(id).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn soft_delete_workspace(&self, id: &str) -> Result<(), DatabaseError> {
        sqlx::query("UPDATE workspaces SET deleted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(id).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn list_glossary(
        &self,
        search: &str,
        limit: u32,
    ) -> Result<Vec<GlossaryEntryRecord>, DatabaseError> {
        let needle = format!("%{}%", search.trim());
        Ok(sqlx::query_as(
            "SELECT id, workspace_id, domain_id, source_term, target_term, strategy, scope, source, confirmed_at, created_at, updated_at FROM glossary_entries WHERE source_term LIKE ? OR COALESCE(target_term,'') LIKE ? ORDER BY updated_at DESC LIMIT ?",
        )
        .bind(&needle).bind(&needle).bind(bounded_limit(limit)).fetch_all(&self.pool).await?)
    }

    pub async fn save_glossary_entry(
        &self,
        input: GlossaryEntryInput,
    ) -> Result<GlossaryEntryRecord, DatabaseError> {
        let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        sqlx::query("INSERT INTO glossary_entries(id,workspace_id,domain_id,source_term,target_term,strategy,scope,source,confirmed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id, domain_id=excluded.domain_id, source_term=excluded.source_term, target_term=excluded.target_term, strategy=excluded.strategy, scope=excluded.scope, confirmed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')")
            .bind(&id).bind(input.workspace_id).bind(input.domain_id)
            .bind(input.source_term.trim()).bind(input.target_term.map(|value| value.trim().to_owned()))
            .bind(input.strategy).bind(input.scope).bind("user")
            .execute(&self.pool).await?;
        self.bump_glossary_version().await?;
        Ok(sqlx::query_as("SELECT id, workspace_id, domain_id, source_term, target_term, strategy, scope, source, confirmed_at, created_at, updated_at FROM glossary_entries WHERE id=?")
            .bind(id).fetch_one(&self.pool).await?)
    }

    pub async fn delete_glossary_entry(&self, id: &str) -> Result<(), DatabaseError> {
        let result = sqlx::query("DELETE FROM glossary_entries WHERE id=?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        if result.rows_affected() > 0 {
            self.bump_glossary_version().await?;
        }
        Ok(())
    }

    async fn bump_glossary_version(&self) -> Result<(), DatabaseError> {
        sqlx::query("INSERT INTO settings(key,value_json,scope,updated_at) VALUES('glossary.version','1','global',strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value_json=CAST(CAST(settings.value_json AS INTEGER)+1 AS TEXT),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')")
            .execute(&self.pool).await?;
        Ok(())
    }

    pub async fn glossary_version(&self) -> Result<i64, DatabaseError> {
        Ok(sqlx::query_scalar(
            "SELECT CAST(value_json AS INTEGER) FROM settings WHERE key='glossary.version'",
        )
        .fetch_optional(&self.pool)
        .await?
        .unwrap_or(0))
    }

    pub async fn website_rule_version(
        &self,
        site_domain: Option<&str>,
    ) -> Result<i64, DatabaseError> {
        let Some(site_domain) = site_domain else {
            return Ok(0);
        };
        Ok(sqlx::query_scalar("SELECT COALESCE(MAX(version),0) FROM website_rules WHERE domain_pattern=? OR (? LIKE '%.' || replace(domain_pattern,'*.',''))")
            .bind(site_domain).bind(site_domain).fetch_one(&self.pool).await?)
    }

    pub async fn resolve_site_policy(
        &self,
        site_domain: &str,
    ) -> Result<Option<SitePolicyRecord>, DatabaseError> {
        let policy = sqlx::query_as::<_, SitePolicyRow>("SELECT id,default_mode,primary_domain_id,tags_json,dynamic_strategy,translate_new_content,translate_navigation,translate_buttons,translate_tables,protect_link_text,auto_translate,force_content_selector,page_budget_json,pdf_strategy,version FROM website_rules WHERE domain_pattern=? OR (? LIKE '%.' || replace(domain_pattern,'*.','')) ORDER BY workspace_id IS NOT NULL DESC,length(domain_pattern) DESC LIMIT 1")
            .bind(site_domain).bind(site_domain).fetch_optional(&self.pool).await?;
        let Some(policy) = policy else {
            return Ok(None);
        };
        let tags = serde_json::from_str(&policy.tags_json).map_err(|source| {
            DatabaseError::InvalidJson {
                field: "website_rules.tags_json",
                source,
            }
        })?;
        let ignored_selectors = sqlx::query_scalar("SELECT selector FROM ignored_selectors WHERE website_rule_id=? AND mode='ignore' ORDER BY selector")
            .bind(&policy.id).fetch_all(&self.pool).await?;
        Ok(Some(SitePolicyRecord {
            id: policy.id,
            default_mode: policy.default_mode,
            primary_domain_id: policy.primary_domain_id,
            tags,
            dynamic_strategy: policy.dynamic_strategy,
            translate_new_content: policy.translate_new_content,
            translate_navigation: policy.translate_navigation,
            translate_buttons: policy.translate_buttons,
            translate_tables: policy.translate_tables,
            protect_link_text: policy.protect_link_text,
            auto_translate: policy.auto_translate,
            force_content_selector: policy.force_content_selector,
            ignored_selectors,
            page_budget_json: policy.page_budget_json,
            pdf_strategy: policy.pdf_strategy,
            version: policy.version,
        }))
    }

    pub async fn list_candidate_terms(
        &self,
        state: &str,
        limit: u32,
    ) -> Result<Vec<CandidateTermRecord>, DatabaseError> {
        Ok(sqlx::query_as("SELECT id, workspace_id, document_id, source_term, suggested_translation, occurrence_count, confidence, example_text, state, created_at, updated_at FROM candidate_terms WHERE state=? ORDER BY occurrence_count DESC, updated_at DESC LIMIT ?")
            .bind(state).bind(bounded_limit(limit)).fetch_all(&self.pool).await?)
    }

    pub async fn set_candidate_state(&self, id: &str, state: &str) -> Result<(), DatabaseError> {
        let mut transaction = self.pool.begin().await?;
        if state == "accepted" {
            let candidate = sqlx::query_as::<_, CandidateForAcceptance>("SELECT workspace_id,source_term,suggested_translation FROM candidate_terms WHERE id=? AND state='pending'")
                .bind(id).fetch_optional(&mut *transaction).await?;
            if let Some(candidate) = candidate {
                let scope = if candidate.workspace_id.is_some() {
                    "workspace"
                } else {
                    "global"
                };
                sqlx::query("INSERT INTO glossary_entries(id,workspace_id,domain_id,source_term,target_term,strategy,scope,source,confirmed_at,created_at,updated_at) VALUES(?,?,NULL,?,?, 'fixed',?,'candidate',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
                    .bind(Uuid::new_v4().to_string()).bind(candidate.workspace_id)
                    .bind(candidate.source_term).bind(candidate.suggested_translation).bind(scope)
                    .execute(&mut *transaction).await?;
            }
        }
        sqlx::query("UPDATE candidate_terms SET state=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(state).bind(id).execute(&mut *transaction).await?;
        transaction.commit().await?;
        if state == "accepted" {
            self.bump_glossary_version().await?;
        }
        Ok(())
    }

    pub async fn list_website_rules(&self) -> Result<Vec<WebsiteRuleRecord>, DatabaseError> {
        Ok(sqlx::query_as("SELECT id, workspace_id, domain_pattern, COALESCE(url_pattern,path_pattern) AS url_pattern, default_mode, dynamic_strategy, translate_new_content, auto_translate, translate_navigation, translate_buttons, translate_tables, protect_link_text, pdf_strategy, is_builtin, version, created_at, updated_at FROM website_rules ORDER BY is_builtin DESC, domain_pattern")
            .fetch_all(&self.pool).await?)
    }

    pub async fn save_website_rule(
        &self,
        input: WebsiteRuleInput,
    ) -> Result<WebsiteRuleRecord, DatabaseError> {
        let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        sqlx::query("INSERT INTO website_rules(id,workspace_id,domain_pattern,path_pattern,url_pattern,default_mode,tags_json,dynamic_strategy,translate_new_content,auto_translate,translate_navigation,translate_buttons,translate_tables,protect_link_text,pdf_strategy,is_builtin,version,created_at,updated_at) VALUES(?,?,?,?,?,?,'[]',?,?,?,?,?,?,?,?,0,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id,domain_pattern=excluded.domain_pattern,path_pattern=excluded.path_pattern,url_pattern=excluded.url_pattern,default_mode=excluded.default_mode,dynamic_strategy=excluded.dynamic_strategy,translate_new_content=excluded.translate_new_content,auto_translate=excluded.auto_translate,translate_navigation=excluded.translate_navigation,translate_buttons=excluded.translate_buttons,translate_tables=excluded.translate_tables,protect_link_text=excluded.protect_link_text,pdf_strategy=excluded.pdf_strategy,version=website_rules.version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')")
            .bind(&id).bind(input.workspace_id).bind(input.domain_pattern.trim()).bind(input.url_pattern.as_deref()).bind(input.url_pattern.as_deref()).bind(input.default_mode)
            .bind(input.translate_new_content).bind(input.auto_translate).bind(input.translate_navigation).bind(input.translate_buttons).bind(input.translate_tables).bind(input.protect_link_text).bind(input.pdf_strategy)
            .execute(&self.pool).await?;
        Ok(sqlx::query_as("SELECT id, workspace_id, domain_pattern, COALESCE(url_pattern,path_pattern) AS url_pattern, default_mode, dynamic_strategy, translate_new_content, auto_translate, translate_navigation, translate_buttons, translate_tables, protect_link_text, pdf_strategy, is_builtin, version, created_at, updated_at FROM website_rules WHERE id=?")
            .bind(id).fetch_one(&self.pool).await?)
    }

    pub async fn list_conversations(
        &self,
        search: &str,
        limit: u32,
    ) -> Result<Vec<ConversationRecord>, DatabaseError> {
        self.query_conversations(ConversationQuery {
            search: search.to_owned(),
            status: None,
            offset: 0,
            limit,
        })
        .await
    }

    pub async fn query_conversations(
        &self,
        query: ConversationQuery,
    ) -> Result<Vec<ConversationRecord>, DatabaseError> {
        let needle = format!("%{}%", query.search.trim());
        Ok(sqlx::query_as("SELECT c.id,c.workspace_id,c.document_id,c.title,c.title_source,c.status,c.last_message_at,c.knowledge_mode,c.current_model_id,c.archived_at,c.created_at,c.updated_at,COALESCE((SELECT substr(content,1,500) FROM conversation_messages m WHERE m.conversation_id=c.id ORDER BY m.sequence DESC,m.id DESC LIMIT 1),'') AS last_message FROM conversations c WHERE (? IS NULL OR c.status=?) AND (c.title LIKE ? OR EXISTS(SELECT 1 FROM conversation_messages m WHERE m.conversation_id=c.id AND m.content LIKE ?)) ORDER BY COALESCE(c.last_message_at,c.updated_at) DESC,c.id DESC LIMIT ? OFFSET ?")
            .bind(query.status.as_deref()).bind(query.status.as_deref())
            .bind(&needle).bind(&needle).bind(bounded_limit(query.limit)).bind(i64::from(query.offset))
            .fetch_all(&self.pool).await?)
    }

    pub async fn get_conversation(
        &self,
        id: &str,
    ) -> Result<Option<ConversationDetailRecord>, DatabaseError> {
        self.get_conversation_page(id, 0, 50).await
    }

    pub async fn get_conversation_page(
        &self,
        id: &str,
        message_offset: u32,
        message_limit: u32,
    ) -> Result<Option<ConversationDetailRecord>, DatabaseError> {
        let conversation = sqlx::query_as::<_, ConversationRecord>("SELECT c.id,c.workspace_id,c.document_id,c.title,c.title_source,c.status,c.last_message_at,c.knowledge_mode,c.current_model_id,c.archived_at,c.created_at,c.updated_at,COALESCE((SELECT substr(content,1,500) FROM conversation_messages m WHERE m.conversation_id=c.id ORDER BY m.sequence DESC,m.id DESC LIMIT 1),'') AS last_message FROM conversations c WHERE c.id=?")
            .bind(id).fetch_optional(&self.pool).await?;
        let Some(conversation) = conversation else {
            return Ok(None);
        };
        let total_messages: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM conversation_messages WHERE conversation_id=?",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;
        let resume_context_json: Option<String> = sqlx::query_scalar(
            "SELECT context.context_json FROM message_contexts context JOIN conversation_messages message ON message.id=context.message_id WHERE message.conversation_id=? AND message.role='user' ORDER BY message.sequence DESC,context.created_at DESC,context.id DESC LIMIT 1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        let message_limit = bounded_limit(message_limit);
        let mut messages = sqlx::query_as::<_, ConversationMessageRecord>("SELECT id,conversation_id,parent_message_id,role,substr(content,1,65536) AS content,length(content)>65536 AS content_truncated,intent,content_format,generation_status,model_id,thinking_enabled,reasoning_effort,sequence,created_at,COALESCE(updated_at,created_at) AS updated_at FROM conversation_messages WHERE conversation_id=? ORDER BY sequence,id LIMIT ? OFFSET ?")
            .bind(id).bind(message_limit).bind(i64::from(message_offset)).fetch_all(&self.pool).await?;
        self.hydrate_message_citations(&mut messages).await?;
        let returned = i64::try_from(messages.len()).unwrap_or(i64::MAX);
        Ok(Some(ConversationDetailRecord {
            conversation,
            messages,
            message_offset,
            message_limit: u32::try_from(message_limit).unwrap_or(200),
            total_messages,
            has_more: i64::from(message_offset).saturating_add(returned) < total_messages,
            resume_context_json,
        }))
    }

    pub async fn conversation_status(&self, id: &str) -> Result<Option<String>, DatabaseError> {
        Ok(
            sqlx::query_scalar("SELECT status FROM conversations WHERE id=?")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?,
        )
    }

    pub async fn recent_conversation_messages(
        &self,
        id: &str,
        limit: u32,
    ) -> Result<Vec<ConversationMessageRecord>, DatabaseError> {
        let mut messages = sqlx::query_as::<_, ConversationMessageRecord>("SELECT id,conversation_id,parent_message_id,role,substr(content,1,12000) AS content,length(content)>12000 AS content_truncated,intent,content_format,generation_status,model_id,thinking_enabled,reasoning_effort,sequence,created_at,COALESCE(updated_at,created_at) AS updated_at FROM conversation_messages WHERE conversation_id=? AND role IN ('user','assistant') AND generation_status='completed' ORDER BY sequence DESC,id DESC LIMIT ?")
            .bind(id).bind(bounded_limit(limit)).fetch_all(&self.pool).await?;
        messages.reverse();
        self.hydrate_message_citations(&mut messages).await?;
        Ok(messages)
    }

    /// Returns citations for one message, including legacy `message_sources` rows
    /// that were not copied to `message_citations`. No migration or write is
    /// performed while reading legacy data.
    pub async fn message_citations(
        &self,
        message_id: &str,
    ) -> Result<Vec<MessageCitationRecord>, DatabaseError> {
        let rows = sqlx::query_as::<_, StoredMessageCitationRow>("SELECT citation.id,citation.message_id,citation.document_id,citation.section_id,citation.source_kind,substr(citation.source_title,1,1024) AS source_title,substr(citation.source_excerpt,1,12000) AS source_excerpt,substr(citation.anchor_json,1,12000) AS anchor_json,citation.created_at FROM (SELECT id,message_id,document_id,section_id,source_kind,source_title,source_excerpt,anchor_json,created_at FROM message_citations UNION ALL SELECT legacy.id,legacy.message_id,legacy.document_id,legacy.section_id,'legacy' AS source_kind,legacy.source_title,legacy.source_excerpt,legacy.anchor_json,legacy.created_at FROM message_sources legacy WHERE NOT EXISTS(SELECT 1 FROM message_citations current WHERE current.id=legacy.id)) citation WHERE citation.message_id=? ORDER BY citation.created_at,citation.id")
            .bind(message_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .into_iter()
            .map(StoredMessageCitationRow::decode)
            .collect())
    }

    async fn hydrate_message_citations(
        &self,
        messages: &mut [ConversationMessageRecord],
    ) -> Result<(), DatabaseError> {
        let Some(first) = messages.first() else {
            return Ok(());
        };
        let minimum_sequence = messages
            .iter()
            .map(|message| message.sequence)
            .min()
            .unwrap_or(first.sequence);
        let maximum_sequence = messages
            .iter()
            .map(|message| message.sequence)
            .max()
            .unwrap_or(first.sequence);
        let rows = sqlx::query_as::<_, StoredMessageCitationRow>("SELECT citation.id,citation.message_id,citation.document_id,citation.section_id,citation.source_kind,substr(citation.source_title,1,1024) AS source_title,substr(citation.source_excerpt,1,12000) AS source_excerpt,substr(citation.anchor_json,1,12000) AS anchor_json,citation.created_at FROM (SELECT id,message_id,document_id,section_id,source_kind,source_title,source_excerpt,anchor_json,created_at FROM message_citations UNION ALL SELECT legacy.id,legacy.message_id,legacy.document_id,legacy.section_id,'legacy' AS source_kind,legacy.source_title,legacy.source_excerpt,legacy.anchor_json,legacy.created_at FROM message_sources legacy WHERE NOT EXISTS(SELECT 1 FROM message_citations current WHERE current.id=legacy.id)) citation JOIN conversation_messages message ON message.id=citation.message_id WHERE message.conversation_id=? AND message.sequence BETWEEN ? AND ? ORDER BY message.sequence,citation.created_at,citation.id")
            .bind(&first.conversation_id)
            .bind(minimum_sequence)
            .bind(maximum_sequence)
            .fetch_all(&self.pool)
            .await?;
        let mut by_message: HashMap<String, Vec<MessageCitationRecord>> = HashMap::new();
        for row in rows {
            let citation = row.decode();
            by_message
                .entry(citation.message_id.clone())
                .or_default()
                .push(citation);
        }
        for message in messages {
            message.citations = by_message.remove(&message.id).unwrap_or_default();
        }
        Ok(())
    }

    /// Appends an idempotent set of citations to an assistant message. Existing
    /// citation rows are never deleted or overwritten.
    pub async fn save_message_citations(
        &self,
        assistant_message_id: &str,
        citations: &[MessageCitationInput],
    ) -> Result<Vec<MessageCitationRecord>, DatabaseError> {
        let prepared = prepare_message_citations(citations)?;
        let mut transaction = self.pool.begin().await?;
        let role: Option<String> =
            sqlx::query_scalar("SELECT role FROM conversation_messages WHERE id=?")
                .bind(assistant_message_id)
                .fetch_optional(&mut *transaction)
                .await?;
        match role.as_deref() {
            None => return Err(DatabaseError::ConversationMessageNotFound),
            Some("assistant") => {}
            Some(_) => return Err(DatabaseError::CitationRequiresAssistantMessage),
        }
        insert_prepared_message_citations(&mut transaction, assistant_message_id, &prepared)
            .await?;
        transaction.commit().await?;
        self.message_citations(assistant_message_id).await
    }

    pub async fn rename_conversation(&self, id: &str, title: &str) -> Result<bool, DatabaseError> {
        if title.trim().is_empty() {
            return Ok(false);
        }
        let result = sqlx::query("UPDATE conversations SET title=?,title_source='user',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
            .bind(title.trim()).bind(id).execute(&self.pool).await?;
        Ok(result.rows_affected() > 0)
    }

    /// Sets the generated title exactly once and only after a completed assistant
    /// answer exists. A user rename changes `title_source` to `user`, making this
    /// update (and every later automatic update) a no-op.
    pub async fn finalize_conversation_auto_title(
        &self,
        id: &str,
        title: &str,
    ) -> Result<bool, DatabaseError> {
        if title.trim().is_empty() {
            return Ok(false);
        }
        let result = sqlx::query("UPDATE conversations SET title=?,title_source='auto',title_generated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND title_source='pending' AND EXISTS(SELECT 1 FROM conversation_messages WHERE conversation_id=conversations.id AND role='assistant' AND generation_status='completed')")
            .bind(title.trim()).bind(id).execute(&self.pool).await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn set_conversation_archived(
        &self,
        id: &str,
        archived: bool,
    ) -> Result<bool, DatabaseError> {
        let result = sqlx::query("UPDATE conversations SET status=CASE WHEN ? THEN 'archived' ELSE 'active' END,archived_at=CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
            .bind(archived).bind(archived).bind(id).execute(&self.pool).await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn delete_conversation(&self, id: &str) -> Result<bool, DatabaseError> {
        let result = sqlx::query("DELETE FROM conversations WHERE id=?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn list_memories(
        &self,
        search: &str,
        limit: u32,
    ) -> Result<Vec<MemoryRecord>, DatabaseError> {
        let needle = format!("%{}%", search.trim());
        Ok(sqlx::query_as("SELECT id,workspace_id,kind,content,source_type,source_id,confirmed_at,is_cross_workspace,created_at,updated_at FROM memories WHERE content LIKE ? ORDER BY confirmed_at IS NOT NULL DESC, updated_at DESC LIMIT ?")
            .bind(needle).bind(bounded_limit(limit)).fetch_all(&self.pool).await?)
    }

    pub async fn list_memory_candidates(
        &self,
        limit: u32,
    ) -> Result<Vec<MemoryCandidateRecord>, DatabaseError> {
        Ok(sqlx::query_as("SELECT id,workspace_id,content,source_type,source_id,confidence,state,created_at,updated_at FROM memory_candidates WHERE state='pending' ORDER BY confidence DESC,updated_at DESC LIMIT ?")
            .bind(bounded_limit(limit)).fetch_all(&self.pool).await?)
    }

    pub async fn set_memory_candidate_state(
        &self,
        id: &str,
        state: &str,
    ) -> Result<(), DatabaseError> {
        let mut transaction = self.pool.begin().await?;
        if state == "confirmed" {
            let candidate = sqlx::query_as::<_, MemoryCandidateRecord>("SELECT id,workspace_id,content,source_type,source_id,confidence,state,created_at,updated_at FROM memory_candidates WHERE id=? AND state='pending'")
                .bind(id).fetch_optional(&mut *transaction).await?;
            if let Some(candidate) = candidate {
                let memory_id = Uuid::new_v4().to_string();
                sqlx::query("INSERT INTO memories(id,workspace_id,kind,content,source_type,source_id,confirmed_at,is_cross_workspace,created_at,updated_at) VALUES(?,?, 'confirmed_long_term',?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),0,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
                    .bind(&memory_id).bind(candidate.workspace_id).bind(&candidate.content)
                    .bind(&candidate.source_type).bind(&candidate.source_id).execute(&mut *transaction).await?;
                sqlx::query("INSERT INTO memory_sources(id,memory_id,source_type,source_id,source_excerpt,source_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
                    .bind(Uuid::new_v4().to_string()).bind(memory_id).bind(candidate.source_type)
                    .bind(candidate.source_id).bind(&candidate.content).bind(format!("candidate:{}", candidate.id))
                    .execute(&mut *transaction).await?;
            }
        }
        sqlx::query("UPDATE memory_candidates SET state=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
            .bind(state).bind(id).execute(&mut *transaction).await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn list_task_presets(&self) -> Result<Vec<TaskPresetRecord>, DatabaseError> {
        Ok(sqlx::query_as("SELECT id,task,label,model_id,thinking_enabled,reasoning_effort,max_output_tokens,timeout_ms,streaming,is_builtin,created_at,updated_at FROM task_presets ORDER BY is_builtin DESC, task")
            .fetch_all(&self.pool).await?)
    }

    pub async fn create_conversation(
        &self,
        input: ConversationCreateInput,
    ) -> Result<String, DatabaseError> {
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO conversations(id,workspace_id,document_id,title,status,last_message_at,current_api_profile_id,current_model_id,thinking_enabled,reasoning_effort,knowledge_mode,metadata_json,title_source,created_at,updated_at) VALUES(?,?,?,?,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),?,?,?,?,?,?,'pending',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
            .bind(&id).bind(input.workspace_id).bind(input.document_id).bind(input.title.trim())
            .bind(input.api_profile_id).bind(input.model_id).bind(input.thinking_enabled)
            .bind(input.reasoning_effort).bind(input.knowledge_mode.as_str()).bind(input.metadata_json)
            .execute(&self.pool).await?;
        Ok(id)
    }

    pub async fn save_conversation_exchange(
        &self,
        input: ConversationExchangeInput,
    ) -> Result<String, DatabaseError> {
        Ok(self
            .save_conversation_exchange_with_citations(input, &[])
            .await?
            .conversation_id)
    }

    /// Persists one completed user/assistant exchange and its assistant
    /// citations atomically. The returned message IDs let streaming callers add
    /// later citations without guessing which assistant turn is current.
    pub async fn save_conversation_exchange_with_citations(
        &self,
        input: ConversationExchangeInput,
        citations: &[MessageCitationInput],
    ) -> Result<ConversationExchangeRecord, DatabaseError> {
        let prepared_citations = prepare_message_citations(citations)?;
        let conversation_id = if let Some(conversation_id) = input.conversation_id.clone() {
            match self.conversation_status(&conversation_id).await?.as_deref() {
                Some("active" | "legacy") => conversation_id,
                Some("archived") => return Err(DatabaseError::ConversationArchived),
                _ => return Err(DatabaseError::ConversationNotFound),
            }
        } else {
            self.create_conversation(ConversationCreateInput {
                workspace_id: None,
                document_id: None,
                title: input.title.clone(),
                knowledge_mode: input.knowledge_mode,
                api_profile_id: input.api_profile_id.clone(),
                model_id: input.model_id.clone(),
                thinking_enabled: input.thinking_enabled,
                reasoning_effort: input.reasoning_effort.clone(),
                metadata_json: "{}".to_owned(),
            })
            .await?
        };
        let user_message_id = Uuid::new_v4().to_string();
        let assistant_message_id = Uuid::new_v4().to_string();
        let mut transaction = self.pool.begin().await?;
        let previous_message_id: Option<String> = sqlx::query_scalar("SELECT id FROM conversation_messages WHERE conversation_id=? ORDER BY sequence DESC,id DESC LIMIT 1")
            .bind(&conversation_id).fetch_optional(&mut *transaction).await?;
        let user_sequence: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(sequence),-1)+1 FROM conversation_messages WHERE conversation_id=?")
            .bind(&conversation_id).fetch_one(&mut *transaction).await?;
        sqlx::query("UPDATE conversations SET status=CASE WHEN status='legacy' THEN 'active' ELSE status END,last_message_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),current_api_profile_id=?,current_model_id=?,thinking_enabled=?,reasoning_effort=?,knowledge_mode=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status IN ('active','legacy')")
            .bind(input.api_profile_id.as_deref()).bind(input.model_id.as_deref())
            .bind(input.thinking_enabled).bind(input.reasoning_effort.as_deref())
            .bind(input.knowledge_mode.as_str()).bind(&conversation_id)
            .execute(&mut *transaction).await?;
        sqlx::query("INSERT INTO conversation_messages(id,conversation_id,parent_message_id,role,content,intent,content_format,generation_status,api_profile_id,model_id,thinking_enabled,reasoning_effort,sequence,created_at,updated_at) VALUES(?,?,?,'user',?,?,'markdown','completed',?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
            .bind(&user_message_id).bind(&conversation_id).bind(previous_message_id.as_deref())
            .bind(input.user_content).bind(&input.intent).bind(input.api_profile_id.as_deref())
            .bind(input.model_id.as_deref()).bind(input.thinking_enabled).bind(input.reasoning_effort.as_deref()).bind(user_sequence)
            .execute(&mut *transaction).await?;
        sqlx::query("INSERT INTO conversation_messages(id,conversation_id,parent_message_id,role,content,intent,content_format,generation_status,api_profile_id,model_id,thinking_enabled,reasoning_effort,sequence,created_at,updated_at) VALUES(?,?,?,'assistant',?,?,'markdown','completed',?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
            .bind(&assistant_message_id).bind(&conversation_id).bind(&user_message_id)
            .bind(input.assistant_content).bind(&input.intent).bind(input.api_profile_id.as_deref())
            .bind(input.model_id.as_deref()).bind(input.thinking_enabled).bind(input.reasoning_effort.as_deref()).bind(user_sequence.saturating_add(1))
            .execute(&mut *transaction).await?;
        if let Some(context_json) = input.context_json.filter(|value| !value.is_empty()) {
            sqlx::query("INSERT INTO message_contexts(id,message_id,context_kind,context_json,content_hash,created_at) VALUES(?,?, 'selection',?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
                .bind(Uuid::new_v4().to_string()).bind(&user_message_id).bind(context_json)
                .bind(input.context_hash.unwrap_or_default()).execute(&mut *transaction).await?;
        }
        if !input.source_title.is_empty() || !input.source_excerpt.is_empty() {
            let source_id = Uuid::new_v4().to_string();
            sqlx::query("INSERT INTO message_sources(id,message_id,document_id,section_id,source_title,source_excerpt,anchor_json,created_at) VALUES(?,?,NULL,NULL,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
                .bind(&source_id).bind(&assistant_message_id).bind(&input.source_title).bind(&input.source_excerpt).bind(&input.anchor_json).execute(&mut *transaction).await?;
            sqlx::query("INSERT INTO message_citations(id,message_id,document_id,section_id,source_kind,source_title,source_excerpt,anchor_json,created_at) VALUES(?,?,NULL,NULL,'page',?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
                .bind(source_id).bind(&assistant_message_id).bind(input.source_title).bind(input.source_excerpt).bind(input.anchor_json).execute(&mut *transaction).await?;
        }
        insert_prepared_message_citations(
            &mut transaction,
            &assistant_message_id,
            &prepared_citations,
        )
        .await?;
        transaction.commit().await?;
        Ok(ConversationExchangeRecord {
            conversation_id,
            user_message_id,
            assistant_message_id,
        })
    }

    pub async fn upsert_model_catalog(
        &self,
        provider_id: &str,
        models: &[ModelCatalogInput],
    ) -> Result<(), DatabaseError> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query("UPDATE model_catalog SET availability='unavailable',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE provider_id=? AND availability='available'")
            .bind(provider_id).execute(&mut *transaction).await?;
        for model in models {
            sqlx::query("INSERT INTO model_catalog(provider_id,model_id,owner,availability,capability_status,supports_thinking,reasoning_efforts_json,supports_streaming,supports_json_output,supports_tools,context_window,metadata_json,last_seen_at,created_at,updated_at) VALUES(?,?,?,'available',?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(provider_id,model_id) DO UPDATE SET owner=excluded.owner,availability='available',capability_status=CASE WHEN model_catalog.capability_status IN ('verified','manual') THEN model_catalog.capability_status ELSE excluded.capability_status END,supports_thinking=COALESCE(model_catalog.supports_thinking,excluded.supports_thinking),reasoning_efforts_json=CASE WHEN model_catalog.capability_status IN ('verified','manual') THEN model_catalog.reasoning_efforts_json ELSE excluded.reasoning_efforts_json END,supports_streaming=COALESCE(model_catalog.supports_streaming,excluded.supports_streaming),supports_json_output=COALESCE(model_catalog.supports_json_output,excluded.supports_json_output),supports_tools=COALESCE(model_catalog.supports_tools,excluded.supports_tools),context_window=COALESCE(model_catalog.context_window,excluded.context_window),metadata_json=excluded.metadata_json,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at")
                .bind(provider_id).bind(&model.model_id).bind(&model.owner)
                .bind(&model.capability_status).bind(model.supports_thinking)
                .bind(&model.reasoning_efforts_json).bind(model.supports_streaming)
                .bind(model.supports_json_output).bind(model.supports_tools)
                .bind(model.context_window).bind(&model.metadata_json)
                .execute(&mut *transaction).await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    /// Records the outcome of a user-initiated capability probe.
    ///
    /// Only the probed capabilities are written, so a streaming check never
    /// implies anything about tool support. `availability` moves to 'available' on
    /// success and 'unavailable' when the provider refused the model outright.
    pub async fn record_model_verification(
        &self,
        provider_id: &str,
        model_id: &str,
        outcome: ModelVerificationOutcome,
    ) -> Result<(), DatabaseError> {
        sqlx::query(
            "INSERT INTO model_catalog(provider_id,model_id,owner,availability,capability_status,supports_thinking,reasoning_efforts_json,supports_streaming,supports_json_output,supports_tools,metadata_json,last_seen_at,created_at,updated_at) \
             VALUES(?,?,'',?,?,?,COALESCE(?,'[]'),?,NULL,NULL,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) \
             ON CONFLICT(provider_id,model_id) DO UPDATE SET \
               availability=excluded.availability, \
               capability_status=excluded.capability_status, \
               supports_thinking=COALESCE(excluded.supports_thinking,model_catalog.supports_thinking), \
               reasoning_efforts_json=CASE WHEN ?9 IS NULL THEN model_catalog.reasoning_efforts_json ELSE ?9 END, \
               supports_streaming=COALESCE(excluded.supports_streaming,model_catalog.supports_streaming), \
               metadata_json=excluded.metadata_json, \
               last_seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), \
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        )
        .bind(provider_id)
        .bind(model_id)
        .bind(outcome.availability)
        .bind(outcome.capability_status)
        .bind(outcome.supports_thinking)
        .bind(outcome.reasoning_efforts_json.clone())
        .bind(outcome.supports_streaming)
        .bind(outcome.metadata_json)
        .bind(outcome.reasoning_efforts_json)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn list_model_catalog(
        &self,
        provider_id: &str,
    ) -> Result<Vec<ModelCatalogRecord>, DatabaseError> {
        Ok(sqlx::query_as("SELECT provider_id,model_id,owner,availability,capability_status,supports_thinking,reasoning_efforts_json,supports_streaming,supports_json_output,supports_tools,context_window,metadata_json,last_seen_at,created_at,updated_at FROM model_catalog WHERE provider_id=? ORDER BY availability='available' DESC,model_id")
            .bind(provider_id).fetch_all(&self.pool).await?)
    }

    pub async fn model_availability(
        &self,
        provider_id: &str,
        model_id: &str,
    ) -> Result<Option<String>, DatabaseError> {
        Ok(sqlx::query_scalar(
            "SELECT availability FROM model_catalog WHERE provider_id=? AND model_id=?",
        )
        .bind(provider_id)
        .bind(model_id)
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn save_model_selection(
        &self,
        input: &ModelSelectionInput,
    ) -> Result<(), DatabaseError> {
        sqlx::query("INSERT INTO model_selection_state(scope,scope_id,task,provider_id,api_profile_id,model_id,thinking_enabled,reasoning_effort,updated_at) VALUES(?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(scope,scope_id,task) DO UPDATE SET provider_id=excluded.provider_id,api_profile_id=excluded.api_profile_id,model_id=excluded.model_id,thinking_enabled=excluded.thinking_enabled,reasoning_effort=excluded.reasoning_effort,updated_at=excluded.updated_at")
            .bind(&input.scope).bind(&input.scope_id).bind(&input.task).bind(&input.provider_id).bind(input.api_profile_id.as_deref())
            .bind(&input.model_id).bind(input.thinking_enabled).bind(input.reasoning_effort.as_deref())
            .execute(&self.pool).await?;
        Ok(())
    }

    pub async fn resolve_model_selection(
        &self,
        conversation_id: Option<&str>,
        task: &str,
    ) -> Result<Option<ModelSelectionRecord>, DatabaseError> {
        Ok(sqlx::query_as("SELECT scope,scope_id,task,provider_id,api_profile_id,model_id,thinking_enabled,reasoning_effort,updated_at FROM model_selection_state WHERE task=? AND ((scope='conversation' AND scope_id=COALESCE(?,'')) OR (scope='task' AND scope_id=?) OR (scope='global' AND scope_id='default')) ORDER BY CASE scope WHEN 'conversation' THEN 0 WHEN 'task' THEN 1 ELSE 2 END LIMIT 1")
            .bind(task).bind(conversation_id).bind(task).fetch_optional(&self.pool).await?)
    }

    pub async fn save_note(&self, input: NoteInput) -> Result<String, DatabaseError> {
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO notes(id,workspace_id,document_id,section_id,content,source_excerpt,created_at,updated_at) VALUES(?,NULL,NULL,NULL,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
            .bind(&id).bind(input.content).bind(input.source_excerpt).execute(&self.pool).await?;
        Ok(id)
    }

    pub async fn glossary_constraints(
        &self,
        source_text: &str,
        limit: u32,
    ) -> Result<Vec<GlossaryConstraintRecord>, DatabaseError> {
        Ok(sqlx::query_as(
            "SELECT source_term,target_term,strategy,scope FROM glossary_entries WHERE confirmed_at IS NOT NULL AND length(source_term) > 0 AND instr(lower(?), lower(source_term)) > 0 ORDER BY CASE scope WHEN 'current_site' THEN 0 WHEN 'workspace' THEN 1 WHEN 'user_domain' THEN 2 WHEN 'global' THEN 3 ELSE 4 END, length(source_term) DESC LIMIT ?",
        )
        .bind(source_text)
        .bind(bounded_limit(limit))
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn get_translation_cache(
        &self,
        cache_key: &str,
    ) -> Result<Option<TranslationCacheRecord>, DatabaseError> {
        let mut transaction = self.pool.begin().await?;
        let record = sqlx::query_as::<_, TranslationCacheRecord>(
            "SELECT cache_key,translated_text,placeholder_json,usage_json,hit_count FROM translation_cache WHERE cache_key=?",
        )
        .bind(cache_key)
        .fetch_optional(&mut *transaction)
        .await?;
        if record.is_some() {
            sqlx::query("UPDATE translation_cache SET hit_count=hit_count+1,last_used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE cache_key=?")
                .bind(cache_key)
                .execute(&mut *transaction)
                .await?;
        }
        transaction.commit().await?;
        Ok(record)
    }

    pub async fn put_translation_cache(
        &self,
        input: TranslationCacheInput,
    ) -> Result<(), DatabaseError> {
        sqlx::query("INSERT INTO translation_cache(cache_key,source_hash,context_hash,glossary_hash,model_profile_hash,translated_text,last_used_at,created_at,target_language,model_id,prompt_version,domain_id,glossary_version,translation_mode,website_rule_version,placeholder_json,usage_json,hit_count,source_scope) VALUES(?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),?,?,?,?,?,?,?,?,?,0,?) ON CONFLICT(cache_key) DO UPDATE SET translated_text=excluded.translated_text,placeholder_json=excluded.placeholder_json,usage_json=excluded.usage_json,last_used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')")
            .bind(input.cache_key).bind(input.source_hash).bind(input.context_hash)
            .bind(input.glossary_hash).bind(input.model_profile_hash).bind(input.translated_text)
            .bind(input.target_language).bind(input.model_id).bind(input.prompt_version)
            .bind(input.domain_id).bind(input.glossary_version).bind(input.translation_mode)
            .bind(input.website_rule_version).bind(input.placeholder_json).bind(input.usage_json)
            .bind(input.source_scope).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn start_page_translation_job(
        &self,
        input: PageTranslationJobInput,
    ) -> Result<PageTranslationJobRecord, DatabaseError> {
        sqlx::query("INSERT INTO page_translation_jobs(id,document_id,workspace_id,page_session_id,idempotency_key,state,mode,target_language,model_id,scan_diagnostics_json,created_at,updated_at) VALUES(?,?,?,?,?,'running',?,?,?,'{}',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(id) DO NOTHING")
            .bind(&input.job_id)
            .bind(input.document_id.as_deref())
            .bind(input.workspace_id.as_deref())
            .bind(&input.page_session_id)
            .bind(&input.idempotency_key)
            .bind(&input.mode)
            .bind(&input.target_language)
            .bind(&input.model_id)
            .execute(&self.pool)
            .await?;
        self.page_translation_job(&input.job_id)
            .await?
            .ok_or(DatabaseError::PageTranslationJobNotFound)
    }

    pub async fn page_translation_job(
        &self,
        job_id: &str,
    ) -> Result<Option<PageTranslationJobRecord>, DatabaseError> {
        let row = sqlx::query_as::<_, PageTranslationJobRow>(
            "SELECT id,document_id,workspace_id,page_session_id,idempotency_key,state,mode,target_language,model_id,total_batches,completed_batches,failed_batches,total_segments,completed_segments,failed_segments,stale_segments,final_batch_received,scan_diagnostics_json,cancelled_at,completed_at,created_at,updated_at FROM page_translation_jobs WHERE id=?",
        )
        .bind(job_id)
        .fetch_optional(&self.pool)
        .await?;
        row.map(PageTranslationJobRecord::try_from).transpose()
    }

    pub async fn list_page_translation_batches(
        &self,
        job_id: &str,
    ) -> Result<Vec<PageTranslationBatchRecord>, DatabaseError> {
        Ok(sqlx::query_as("SELECT id AS task_id,page_job_id,batch_index,final_batch,state,total_segments,completed_segments,failed_segments,created_at,updated_at FROM translation_tasks WHERE page_job_id=? ORDER BY batch_index,id")
            .bind(job_id)
            .fetch_all(&self.pool)
            .await?)
    }

    /// Stores the latest DOM scan report and recomputes the logical job from all
    /// linked native batches. The job cannot become terminal before a unique final
    /// batch has arrived, every batch is terminal, and batch indexes are contiguous.
    pub async fn finalize_page_translation_job(
        &self,
        job_id: &str,
        diagnostics: &PageTranslationJobDiagnostics,
    ) -> Result<PageTranslationJobRecord, DatabaseError> {
        let diagnostics_json =
            serde_json::to_string(diagnostics).map_err(|source| DatabaseError::InvalidJson {
                field: "page_translation_jobs.scan_diagnostics_json",
                source,
            })?;
        let result = sqlx::query("UPDATE page_translation_jobs SET scan_diagnostics_json=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
            .bind(diagnostics_json)
            .bind(job_id)
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(DatabaseError::PageTranslationJobNotFound);
        }
        self.refresh_page_translation_job(job_id)
            .await?
            .ok_or(DatabaseError::PageTranslationJobNotFound)
    }

    pub async fn cancel_page_translation_job(
        &self,
        job_id: &str,
        diagnostics: &PageTranslationJobDiagnostics,
    ) -> Result<PageTranslationJobRecord, DatabaseError> {
        let diagnostics_json =
            serde_json::to_string(diagnostics).map_err(|source| DatabaseError::InvalidJson {
                field: "page_translation_jobs.scan_diagnostics_json",
                source,
            })?;
        let result = sqlx::query("UPDATE page_translation_jobs SET state='cancelled',scan_diagnostics_json=?,cancelled_at=COALESCE(cancelled_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),completed_at=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
            .bind(diagnostics_json)
            .bind(job_id)
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(DatabaseError::PageTranslationJobNotFound);
        }
        self.page_translation_job(job_id)
            .await?
            .ok_or(DatabaseError::PageTranslationJobNotFound)
    }

    pub async fn refresh_page_translation_job(
        &self,
        job_id: &str,
    ) -> Result<Option<PageTranslationJobRecord>, DatabaseError> {
        let mut transaction = self.pool.begin().await?;
        let current = sqlx::query_as::<_, PageTranslationJobStateRow>(
            "SELECT state,scan_diagnostics_json FROM page_translation_jobs WHERE id=?",
        )
        .bind(job_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(current) = current else {
            transaction.rollback().await?;
            return Ok(None);
        };
        let aggregate = sqlx::query_as::<_, PageTranslationAggregate>(
            "SELECT COUNT(*) AS total_batches,COALESCE(SUM(CASE WHEN state IN ('completed','partial') THEN 1 ELSE 0 END),0) AS completed_batches,COALESCE(SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END),0) AS failed_batches,COALESCE(SUM(CASE WHEN state='cancelled' THEN 1 ELSE 0 END),0) AS cancelled_batches,COALESCE(SUM(CASE WHEN state IN ('queued','running','paused') THEN 1 ELSE 0 END),0) AS nonterminal_batches,COALESCE(SUM(total_segments),0) AS total_segments,COALESCE((SELECT COUNT(*) FROM translation_task_segments segment JOIN translation_tasks task ON task.id=segment.task_id WHERE task.page_job_id=? AND segment.state='translated'),0) AS completed_segments,COALESCE((SELECT COUNT(*) FROM translation_task_segments segment JOIN translation_tasks task ON task.id=segment.task_id WHERE task.page_job_id=? AND segment.state='failed'),0) AS failed_segments,COALESCE((SELECT COUNT(*) FROM translation_task_segments segment JOIN translation_tasks task ON task.id=segment.task_id WHERE task.page_job_id=? AND segment.state='stale'),0) AS stale_segments,COALESCE(MAX(CASE WHEN final_batch=1 THEN 1 ELSE 0 END),0) AS final_batch_received,COALESCE(MAX(batch_index),-1) AS maximum_batch_index,COALESCE(SUM(CASE WHEN state='partial' THEN 1 ELSE 0 END),0) AS partial_batches FROM translation_tasks WHERE page_job_id=?",
        )
        .bind(job_id)
        .bind(job_id)
        .bind(job_id)
        .bind(job_id)
        .fetch_one(&mut *transaction)
        .await?;
        let diagnostics: PageTranslationJobDiagnostics =
            serde_json::from_str(&current.scan_diagnostics_json).map_err(|source| {
                DatabaseError::InvalidJson {
                    field: "page_translation_jobs.scan_diagnostics_json",
                    source,
                }
            })?;
        let state = aggregate_page_translation_state(&current.state, &aggregate, &diagnostics);
        sqlx::query("UPDATE page_translation_jobs SET state=?,total_batches=?,completed_batches=?,failed_batches=?,total_segments=?,completed_segments=?,failed_segments=?,stale_segments=?,final_batch_received=?,cancelled_at=CASE WHEN ?='cancelled' THEN COALESCE(cancelled_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ELSE cancelled_at END,completed_at=CASE WHEN ? IN ('completed','partial','failed') THEN COALESCE(completed_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ELSE NULL END,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
            .bind(state)
            .bind(aggregate.total_batches)
            .bind(aggregate.completed_batches)
            .bind(aggregate.failed_batches)
            .bind(aggregate.total_segments)
            .bind(aggregate.completed_segments)
            .bind(aggregate.failed_segments)
            .bind(aggregate.stale_segments)
            .bind(aggregate.final_batch_received != 0)
            .bind(state)
            .bind(state)
            .bind(job_id)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        self.page_translation_job(job_id).await
    }

    pub async fn start_translation_task(
        &self,
        input: TranslationTaskInput,
    ) -> Result<(), DatabaseError> {
        match (&input.page_job_id, input.batch_index, input.final_batch) {
            (Some(_), Some(_), _) | (None, None, false) => {}
            (Some(_), None, _) => {
                return Err(DatabaseError::InvalidPageTranslationBatch(
                    "a linked batch requires batch_index",
                ));
            }
            (None, Some(_), _) | (None, None, true) => {
                return Err(DatabaseError::InvalidPageTranslationBatch(
                    "batch_index/final_batch require page_job_id",
                ));
            }
        }
        let mut transaction = self.pool.begin().await?;
        let inserted = sqlx::query("INSERT INTO translation_tasks(id,document_id,workspace_id,page_session_id,idempotency_key,state,mode,target_language,preset_id,model_id,prompt_version,glossary_version,website_rule_version,total_segments,completed_segments,failed_segments,page_job_id,batch_index,final_batch,created_at,updated_at) VALUES(?,NULL,?,?,?,'running',?,?,NULL,?,?,?,?,?,0,0,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(id) DO NOTHING")
            .bind(&input.task_id).bind(input.workspace_id).bind(&input.page_session_id)
            .bind(&input.idempotency_key).bind(&input.mode).bind(&input.target_language)
            .bind(&input.model_id).bind(&input.prompt_version).bind(input.glossary_version)
            .bind(input.website_rule_version).bind(i64::from(input.total_segments))
            .bind(input.page_job_id.as_deref()).bind(input.batch_index.map(i64::from))
            .bind(input.final_batch)
            .execute(&mut *transaction).await?;
        if inserted.rows_affected() > 0 {
            for (ordinal, segment) in input.segments.iter().enumerate() {
                sqlx::query("INSERT INTO translation_task_segments(task_id,segment_id,source_hash,state,placeholder_json,ordinal,created_at,updated_at) VALUES(?,?,?,'queued',?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
                    .bind(&input.task_id).bind(&segment.segment_id).bind(&segment.source_hash)
                    .bind(&segment.placeholder_json).bind(ordinal as i64)
                    .execute(&mut *transaction).await?;
            }
        }
        let page_job_id: Option<String> =
            sqlx::query_scalar("SELECT page_job_id FROM translation_tasks WHERE id=?")
                .bind(&input.task_id)
                .fetch_optional(&mut *transaction)
                .await?
                .flatten();
        transaction.commit().await?;
        if let Some(page_job_id) = page_job_id {
            self.refresh_page_translation_job(&page_job_id).await?;
        }
        Ok(())
    }

    pub async fn complete_translation_segment(
        &self,
        task_id: &str,
        segment_id: &str,
        translated_text: &str,
        usage_json: Option<&str>,
    ) -> Result<(), DatabaseError> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query("UPDATE translation_task_segments SET state='translated',translated_text=?,usage_json=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE task_id=? AND segment_id=?")
            .bind(translated_text).bind(usage_json).bind(task_id).bind(segment_id)
            .execute(&mut *transaction).await?;
        sqlx::query("UPDATE translation_tasks SET completed_segments=(SELECT COUNT(*) FROM translation_task_segments WHERE task_id=? AND state='translated'),failed_segments=(SELECT COUNT(*) FROM translation_task_segments WHERE task_id=? AND state='failed'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
            .bind(task_id).bind(task_id).bind(task_id).execute(&mut *transaction).await?;
        let page_job_id: Option<String> =
            sqlx::query_scalar("SELECT page_job_id FROM translation_tasks WHERE id=?")
                .bind(task_id)
                .fetch_optional(&mut *transaction)
                .await?
                .flatten();
        transaction.commit().await?;
        if let Some(page_job_id) = page_job_id {
            self.refresh_page_translation_job(&page_job_id).await?;
        }
        Ok(())
    }

    pub async fn set_translation_segment_state(
        &self,
        task_id: &str,
        segment_id: &str,
        state: &str,
        error_json: Option<&str>,
    ) -> Result<bool, DatabaseError> {
        if !matches!(state, "failed" | "stale" | "cancelled") {
            return Err(DatabaseError::InvalidPageTranslationBatch(
                "segment terminal state must be failed, stale, or cancelled",
            ));
        }
        let mut transaction = self.pool.begin().await?;
        let result = sqlx::query("UPDATE translation_task_segments SET state=?,error_json=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE task_id=? AND segment_id=? AND ((?='stale' AND state IN ('queued','translating','translated','stale')) OR (? IN ('failed','cancelled') AND state!='translated'))")
            .bind(state)
            .bind(error_json)
            .bind(task_id)
            .bind(segment_id)
            .bind(state)
            .bind(state)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("UPDATE translation_tasks SET completed_segments=(SELECT COUNT(*) FROM translation_task_segments WHERE task_id=? AND state='translated'),failed_segments=(SELECT COUNT(*) FROM translation_task_segments WHERE task_id=? AND state='failed'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
            .bind(task_id).bind(task_id).bind(task_id)
            .execute(&mut *transaction).await?;
        let page_job_id: Option<String> =
            sqlx::query_scalar("SELECT page_job_id FROM translation_tasks WHERE id=?")
                .bind(task_id)
                .fetch_optional(&mut *transaction)
                .await?
                .flatten();
        transaction.commit().await?;
        if let Some(page_job_id) = page_job_id {
            self.refresh_page_translation_job(&page_job_id).await?;
        }
        Ok(result.rows_affected() > 0)
    }

    pub async fn finish_translation_task(
        &self,
        task_id: &str,
        state: &str,
    ) -> Result<(), DatabaseError> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query("UPDATE translation_tasks SET state=?,cancelled_at=CASE WHEN ?='cancelled' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE cancelled_at END,completed_at=CASE WHEN ? IN ('completed','partial') THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE completed_at END,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
            .bind(state).bind(state).bind(state).bind(task_id).execute(&mut *transaction).await?;
        let page_job_id: Option<String> =
            sqlx::query_scalar("SELECT page_job_id FROM translation_tasks WHERE id=?")
                .bind(task_id)
                .fetch_optional(&mut *transaction)
                .await?
                .flatten();
        transaction.commit().await?;
        if let Some(page_job_id) = page_job_id {
            self.refresh_page_translation_job(&page_job_id).await?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSummary {
    pub workspaces: i64,
    pub glossary_entries: i64,
    pub candidate_terms: i64,
    pub conversations: i64,
    pub confirmed_memories: i64,
    pub translated_pages: i64,
    pub cache_entries: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInput {
    pub id: Option<String>,
    pub name: String,
    pub description: String,
    pub primary_domain: Option<String>,
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub primary_domain: Option<String>,
    pub icon: String,
    pub archived_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryEntryInput {
    pub id: Option<String>,
    pub workspace_id: Option<String>,
    pub domain_id: Option<String>,
    pub source_term: String,
    pub target_term: Option<String>,
    pub strategy: String,
    pub scope: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryEntryRecord {
    pub id: String,
    pub workspace_id: Option<String>,
    pub domain_id: Option<String>,
    pub source_term: String,
    pub target_term: Option<String>,
    pub strategy: String,
    pub scope: String,
    pub source: String,
    pub confirmed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CandidateTermRecord {
    pub id: String,
    pub workspace_id: Option<String>,
    pub document_id: Option<String>,
    pub source_term: String,
    pub suggested_translation: Option<String>,
    pub occurrence_count: i64,
    pub confidence: Option<f64>,
    pub example_text: Option<String>,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, FromRow)]
struct CandidateForAcceptance {
    workspace_id: Option<String>,
    source_term: String,
    suggested_translation: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebsiteRuleInput {
    pub id: Option<String>,
    pub workspace_id: Option<String>,
    pub domain_pattern: String,
    pub url_pattern: Option<String>,
    pub default_mode: Option<String>,
    pub translate_new_content: bool,
    pub auto_translate: bool,
    pub translate_navigation: bool,
    pub translate_buttons: bool,
    pub translate_tables: bool,
    pub protect_link_text: bool,
    pub pdf_strategy: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WebsiteRuleRecord {
    pub id: String,
    pub workspace_id: Option<String>,
    pub domain_pattern: String,
    pub url_pattern: Option<String>,
    pub default_mode: Option<String>,
    pub dynamic_strategy: String,
    pub translate_new_content: bool,
    pub auto_translate: bool,
    pub translate_navigation: bool,
    pub translate_buttons: bool,
    pub translate_tables: bool,
    pub protect_link_text: bool,
    pub pdf_strategy: String,
    pub is_builtin: bool,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, FromRow)]
struct SitePolicyRow {
    id: String,
    default_mode: Option<String>,
    primary_domain_id: Option<String>,
    tags_json: String,
    dynamic_strategy: String,
    translate_new_content: bool,
    translate_navigation: bool,
    translate_buttons: bool,
    translate_tables: bool,
    protect_link_text: bool,
    auto_translate: bool,
    force_content_selector: Option<String>,
    page_budget_json: String,
    pdf_strategy: String,
    version: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SitePolicyRecord {
    pub id: String,
    pub default_mode: Option<String>,
    pub primary_domain_id: Option<String>,
    pub tags: Vec<String>,
    pub dynamic_strategy: String,
    pub translate_new_content: bool,
    pub translate_navigation: bool,
    pub translate_buttons: bool,
    pub translate_tables: bool,
    pub protect_link_text: bool,
    pub auto_translate: bool,
    pub force_content_selector: Option<String>,
    pub ignored_selectors: Vec<String>,
    pub page_budget_json: String,
    pub pdf_strategy: String,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRecord {
    pub id: String,
    pub workspace_id: Option<String>,
    pub document_id: Option<String>,
    pub title: String,
    pub title_source: String,
    pub status: String,
    pub last_message_at: Option<String>,
    pub knowledge_mode: String,
    pub current_model_id: Option<String>,
    pub archived_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_message: String,
}

#[derive(Debug, Clone)]
pub struct ConversationQuery {
    pub search: String,
    pub status: Option<String>,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationDetailRecord {
    pub conversation: ConversationRecord,
    pub messages: Vec<ConversationMessageRecord>,
    pub message_offset: u32,
    pub message_limit: u32,
    pub total_messages: i64,
    pub has_more: bool,
    /// Latest persisted user-message context. This is returned by the native
    /// repository so browser restart recovery does not need to duplicate page
    /// excerpts in extension local storage.
    pub resume_context_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessageRecord {
    pub id: String,
    pub conversation_id: String,
    pub parent_message_id: Option<String>,
    pub role: String,
    pub content: String,
    pub content_truncated: bool,
    pub intent: Option<String>,
    pub content_format: String,
    pub generation_status: String,
    pub model_id: Option<String>,
    pub thinking_enabled: bool,
    pub reasoning_effort: Option<String>,
    pub sequence: i64,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    #[sqlx(skip)]
    pub citations: Vec<MessageCitationRecord>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageCitationSourceKind {
    Page,
    Workspace,
    GeneralKnowledge,
    Tool,
    Legacy,
}

impl MessageCitationSourceKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Page => "page",
            Self::Workspace => "workspace",
            Self::GeneralKnowledge => "general_knowledge",
            Self::Tool => "tool",
            Self::Legacy => "legacy",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageCitationInput {
    pub source_kind: MessageCitationSourceKind,
    pub source_id: Option<String>,
    pub source_title: String,
    pub source_excerpt: String,
    #[serde(default = "empty_json_object")]
    pub locator: serde_json::Value,
}

fn empty_json_object() -> serde_json::Value {
    serde_json::Value::Object(serde_json::Map::new())
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageCitationRecord {
    pub id: String,
    pub message_id: String,
    pub source_kind: String,
    pub source_id: Option<String>,
    pub document_id: Option<String>,
    pub section_id: Option<String>,
    pub source_title: String,
    pub source_excerpt: String,
    pub locator: serde_json::Value,
    pub created_at: String,
}

#[derive(Debug, FromRow)]
struct StoredMessageCitationRow {
    id: String,
    message_id: String,
    document_id: Option<String>,
    section_id: Option<String>,
    source_kind: String,
    source_title: String,
    source_excerpt: String,
    anchor_json: String,
    created_at: String,
}

impl StoredMessageCitationRow {
    fn decode(self) -> MessageCitationRecord {
        let parsed_locator = serde_json::from_str::<serde_json::Value>(&self.anchor_json)
            .unwrap_or_else(|_| serde_json::json!({ "legacyRaw": self.anchor_json }));
        let citation_metadata = parsed_locator.get("$yanyiCitation").filter(|metadata| {
            metadata.get("version").and_then(serde_json::Value::as_u64) == Some(1)
        });
        let source_id = citation_metadata
            .and_then(|metadata| metadata.get("sourceId"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
            .or_else(|| self.section_id.clone())
            .or_else(|| self.document_id.clone());
        let locator = if citation_metadata.is_some() {
            parsed_locator
                .get("locator")
                .cloned()
                .unwrap_or_else(empty_json_object)
        } else {
            parsed_locator
        };
        MessageCitationRecord {
            id: self.id,
            message_id: self.message_id,
            document_id: self.document_id,
            section_id: self.section_id,
            source_kind: self.source_kind,
            source_id,
            source_title: self.source_title,
            source_excerpt: self.source_excerpt,
            locator,
            created_at: self.created_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRecord {
    pub id: String,
    pub workspace_id: Option<String>,
    pub kind: String,
    pub content: String,
    pub source_type: String,
    pub source_id: Option<String>,
    pub confirmed_at: Option<String>,
    pub is_cross_workspace: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCandidateRecord {
    pub id: String,
    pub workspace_id: Option<String>,
    pub content: String,
    pub source_type: String,
    pub source_id: Option<String>,
    pub confidence: Option<f64>,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TaskPresetRecord {
    pub id: String,
    pub task: String,
    pub label: String,
    pub model_id: String,
    pub thinking_enabled: bool,
    pub reasoning_effort: Option<String>,
    pub max_output_tokens: i64,
    pub timeout_ms: i64,
    pub streaming: bool,
    pub is_builtin: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct ConversationExchangeInput {
    pub conversation_id: Option<String>,
    pub title: String,
    pub intent: String,
    pub knowledge_mode: KnowledgeMode,
    pub api_profile_id: Option<String>,
    pub model_id: Option<String>,
    pub thinking_enabled: bool,
    pub reasoning_effort: Option<String>,
    pub user_content: String,
    pub assistant_content: String,
    pub context_json: Option<String>,
    pub context_hash: Option<String>,
    pub source_title: String,
    pub source_excerpt: String,
    pub anchor_json: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationExchangeRecord {
    pub conversation_id: String,
    pub user_message_id: String,
    pub assistant_message_id: String,
}

/// Result of a user-initiated model capability probe.
///
/// `None` means "still unknown" and must not be written as a negative, so an
/// unverified capability is never mistaken for an unsupported one.
#[derive(Debug, Clone, Default)]
pub struct ModelVerificationOutcome {
    pub availability: &'static str,
    pub capability_status: &'static str,
    pub supports_thinking: Option<bool>,
    pub supports_streaming: Option<bool>,
    pub reasoning_efforts_json: Option<String>,
    pub metadata_json: String,
}

pub struct ConversationCreateInput {
    pub workspace_id: Option<String>,
    pub document_id: Option<String>,
    pub title: String,
    pub knowledge_mode: KnowledgeMode,
    pub api_profile_id: Option<String>,
    pub model_id: Option<String>,
    pub thinking_enabled: bool,
    pub reasoning_effort: Option<String>,
    pub metadata_json: String,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeMode {
    #[default]
    Hybrid,
    PageOnly,
    General,
}

impl KnowledgeMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Hybrid => "hybrid",
            Self::PageOnly => "page_only",
            Self::General => "general",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ModelCatalogInput {
    pub model_id: String,
    pub owner: String,
    pub capability_status: String,
    pub supports_thinking: Option<bool>,
    pub reasoning_efforts_json: String,
    pub supports_streaming: Option<bool>,
    pub supports_json_output: Option<bool>,
    pub supports_tools: Option<bool>,
    pub context_window: Option<i64>,
    pub metadata_json: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalogRecord {
    pub provider_id: String,
    pub model_id: String,
    pub owner: String,
    pub availability: String,
    pub capability_status: String,
    pub supports_thinking: Option<bool>,
    pub reasoning_efforts_json: String,
    pub supports_streaming: Option<bool>,
    pub supports_json_output: Option<bool>,
    pub supports_tools: Option<bool>,
    pub context_window: Option<i64>,
    pub metadata_json: String,
    pub last_seen_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSelectionInput {
    pub scope: String,
    pub scope_id: String,
    pub task: String,
    pub provider_id: String,
    pub api_profile_id: Option<String>,
    pub model_id: String,
    pub thinking_enabled: bool,
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ModelSelectionRecord {
    pub scope: String,
    pub scope_id: String,
    pub task: String,
    pub provider_id: String,
    pub api_profile_id: Option<String>,
    pub model_id: String,
    pub thinking_enabled: bool,
    pub reasoning_effort: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct NoteInput {
    pub content: String,
    pub source_excerpt: Option<String>,
}

#[derive(Debug, Clone, FromRow)]
pub struct GlossaryConstraintRecord {
    pub source_term: String,
    pub target_term: Option<String>,
    pub strategy: String,
    pub scope: String,
}

#[derive(Debug, Clone, FromRow)]
pub struct TranslationCacheRecord {
    pub cache_key: String,
    pub translated_text: String,
    pub placeholder_json: String,
    pub usage_json: Option<String>,
    pub hit_count: i64,
}

#[derive(Debug, Clone)]
pub struct TranslationCacheInput {
    pub cache_key: String,
    pub source_hash: String,
    pub context_hash: String,
    pub glossary_hash: String,
    pub model_profile_hash: String,
    pub translated_text: String,
    pub target_language: String,
    pub model_id: String,
    pub prompt_version: String,
    pub domain_id: Option<String>,
    pub glossary_version: i64,
    pub translation_mode: String,
    pub website_rule_version: i64,
    pub placeholder_json: String,
    pub usage_json: Option<String>,
    pub source_scope: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PageTranslationJobInput {
    pub job_id: String,
    pub document_id: Option<String>,
    pub workspace_id: Option<String>,
    pub page_session_id: String,
    pub idempotency_key: String,
    pub mode: String,
    pub target_language: String,
    pub model_id: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PageTranslationJobDiagnostics {
    pub discovered: u32,
    pub eligible: u32,
    pub protected: u32,
    pub ignored: u32,
    pub queued: u32,
    pub completed: u32,
    pub failed: u32,
    pub stale: u32,
    pub over_budget: u32,
    pub unsupported: u32,
    pub cancelled: u32,
    pub not_scanned: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageTranslationJobRecord {
    pub id: String,
    pub document_id: Option<String>,
    pub workspace_id: Option<String>,
    pub page_session_id: String,
    pub idempotency_key: String,
    pub state: String,
    pub mode: String,
    pub target_language: String,
    pub model_id: String,
    pub total_batches: i64,
    pub completed_batches: i64,
    pub failed_batches: i64,
    pub total_segments: i64,
    pub completed_segments: i64,
    pub failed_segments: i64,
    pub stale_segments: i64,
    pub final_batch_received: bool,
    pub diagnostics: PageTranslationJobDiagnostics,
    pub cancelled_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, FromRow)]
struct PageTranslationJobRow {
    id: String,
    document_id: Option<String>,
    workspace_id: Option<String>,
    page_session_id: String,
    idempotency_key: String,
    state: String,
    mode: String,
    target_language: String,
    model_id: String,
    total_batches: i64,
    completed_batches: i64,
    failed_batches: i64,
    total_segments: i64,
    completed_segments: i64,
    failed_segments: i64,
    stale_segments: i64,
    final_batch_received: bool,
    scan_diagnostics_json: String,
    cancelled_at: Option<String>,
    completed_at: Option<String>,
    created_at: String,
    updated_at: String,
}

impl TryFrom<PageTranslationJobRow> for PageTranslationJobRecord {
    type Error = DatabaseError;

    fn try_from(row: PageTranslationJobRow) -> Result<Self, Self::Error> {
        let diagnostics = serde_json::from_str(&row.scan_diagnostics_json).map_err(|source| {
            DatabaseError::InvalidJson {
                field: "page_translation_jobs.scan_diagnostics_json",
                source,
            }
        })?;
        Ok(Self {
            id: row.id,
            document_id: row.document_id,
            workspace_id: row.workspace_id,
            page_session_id: row.page_session_id,
            idempotency_key: row.idempotency_key,
            state: row.state,
            mode: row.mode,
            target_language: row.target_language,
            model_id: row.model_id,
            total_batches: row.total_batches,
            completed_batches: row.completed_batches,
            failed_batches: row.failed_batches,
            total_segments: row.total_segments,
            completed_segments: row.completed_segments,
            failed_segments: row.failed_segments,
            stale_segments: row.stale_segments,
            final_batch_received: row.final_batch_received,
            diagnostics,
            cancelled_at: row.cancelled_at,
            completed_at: row.completed_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PageTranslationBatchRecord {
    pub task_id: String,
    pub page_job_id: Option<String>,
    pub batch_index: Option<i64>,
    pub final_batch: bool,
    pub state: String,
    pub total_segments: i64,
    pub completed_segments: i64,
    pub failed_segments: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, FromRow)]
struct PageTranslationJobStateRow {
    state: String,
    scan_diagnostics_json: String,
}

#[derive(Debug, FromRow)]
struct PageTranslationAggregate {
    total_batches: i64,
    completed_batches: i64,
    failed_batches: i64,
    cancelled_batches: i64,
    nonterminal_batches: i64,
    total_segments: i64,
    completed_segments: i64,
    failed_segments: i64,
    stale_segments: i64,
    final_batch_received: i64,
    maximum_batch_index: i64,
    partial_batches: i64,
}

fn aggregate_page_translation_state(
    current_state: &str,
    aggregate: &PageTranslationAggregate,
    diagnostics: &PageTranslationJobDiagnostics,
) -> &'static str {
    if current_state == "cancelled" {
        return "cancelled";
    }
    let batches_are_contiguous =
        aggregate.maximum_batch_index.saturating_add(1) == aggregate.total_batches;
    let ready = aggregate.total_batches > 0
        && aggregate.final_batch_received != 0
        && aggregate.nonterminal_batches == 0
        && batches_are_contiguous;
    if !ready {
        return if current_state == "paused" {
            "paused"
        } else {
            "running"
        };
    }

    let has_scan_report = diagnostics.discovered > 0
        || diagnostics.eligible > 0
        || diagnostics.protected > 0
        || diagnostics.ignored > 0
        || diagnostics.queued > 0
        || diagnostics.completed > 0
        || diagnostics.failed > 0
        || diagnostics.stale > 0
        || diagnostics.over_budget > 0
        || diagnostics.unsupported > 0
        || diagnostics.cancelled > 0
        || diagnostics.not_scanned > 0;
    if has_scan_report {
        // `queued` is a cumulative admission counter, not the number still in
        // flight. Completion therefore depends on terminal accounting rather
        // than on `queued` returning to zero.
        let accounted = diagnostics
            .completed
            .saturating_add(diagnostics.failed)
            .saturating_add(diagnostics.stale)
            .saturating_add(diagnostics.over_budget)
            .saturating_add(diagnostics.unsupported)
            .saturating_add(diagnostics.cancelled)
            .saturating_add(diagnostics.not_scanned);
        let unfinished = accounted < diagnostics.eligible;
        if !unfinished && diagnostics.completed >= diagnostics.eligible {
            return "completed";
        }
        if diagnostics.completed == 0
            && diagnostics.failed > 0
            && diagnostics.failed >= diagnostics.eligible
        {
            return "failed";
        }
        return "partial";
    }

    if aggregate.completed_segments == 0
        && aggregate.failed_segments == 0
        && aggregate.failed_batches == 0
        && aggregate.cancelled_batches == aggregate.total_batches
    {
        return "cancelled";
    }
    if aggregate.completed_segments == 0
        && (aggregate.failed_segments > 0 || aggregate.failed_batches > 0)
    {
        return "failed";
    }
    if aggregate.failed_segments > 0
        || aggregate.stale_segments > 0
        || aggregate.failed_batches > 0
        || aggregate.cancelled_batches > 0
        || aggregate.partial_batches > 0
        || aggregate.completed_segments < aggregate.total_segments
    {
        return "partial";
    }
    "completed"
}

#[derive(Debug, Clone)]
pub struct TranslationTaskSegmentInput {
    pub segment_id: String,
    pub source_hash: String,
    pub placeholder_json: String,
}

#[derive(Debug, Clone)]
pub struct TranslationTaskInput {
    pub task_id: String,
    pub workspace_id: Option<String>,
    pub page_session_id: String,
    pub page_job_id: Option<String>,
    pub batch_index: Option<u32>,
    pub final_batch: bool,
    pub idempotency_key: String,
    pub mode: String,
    pub target_language: String,
    pub model_id: String,
    pub prompt_version: String,
    pub glossary_version: i64,
    pub website_rule_version: i64,
    pub total_segments: u32,
    pub segments: Vec<TranslationTaskSegmentInput>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::open;
    use tempfile::tempdir;

    #[test]
    fn cumulative_queued_diagnostics_do_not_block_a_completed_page_job() {
        let aggregate = PageTranslationAggregate {
            total_batches: 1,
            completed_batches: 1,
            failed_batches: 0,
            cancelled_batches: 0,
            nonterminal_batches: 0,
            total_segments: 3,
            completed_segments: 3,
            failed_segments: 0,
            stale_segments: 0,
            final_batch_received: 1,
            maximum_batch_index: 0,
            partial_batches: 0,
        };
        let diagnostics = PageTranslationJobDiagnostics {
            discovered: 3,
            eligible: 3,
            queued: 3,
            completed: 3,
            ..PageTranslationJobDiagnostics::default()
        };

        assert_eq!(
            aggregate_page_translation_state("running", &aggregate, &diagnostics),
            "completed"
        );
    }

    #[tokio::test]
    async fn workspace_and_glossary_crud_uses_real_sqlite() {
        let dir = tempdir().expect("tempdir");
        let pool = open(dir.path().join("repo.db")).await.expect("database");
        let repository = Repository::new(pool);
        let workspace = repository
            .save_workspace(WorkspaceInput {
                id: None,
                name: "PX4 学习".into(),
                description: "飞控文档".into(),
                primary_domain: Some("机器人学".into()),
                icon: None,
            })
            .await
            .expect("workspace");
        assert_eq!(
            repository.list_workspaces(false).await.expect("list").len(),
            1
        );
        let entry = repository
            .save_glossary_entry(GlossaryEntryInput {
                id: None,
                workspace_id: Some(workspace.id),
                domain_id: None,
                source_term: "pitch".into(),
                target_term: Some("俯仰".into()),
                strategy: "fixed".into(),
                scope: "workspace".into(),
            })
            .await
            .expect("entry");
        assert_eq!(
            repository.list_glossary("pitch", 20).await.expect("search")[0]
                .target_term
                .as_deref(),
            Some("俯仰")
        );
        repository
            .delete_glossary_entry(&entry.id)
            .await
            .expect("delete");
        assert!(
            repository
                .list_glossary("pitch", 20)
                .await
                .expect("search")
                .is_empty()
        );
    }

    #[tokio::test]
    async fn translation_cache_and_task_state_are_durable() {
        let dir = tempdir().expect("tempdir");
        let path = dir.path().join("cache.db");
        let repository = Repository::new(open(&path).await.expect("database"));
        repository
            .start_translation_task(TranslationTaskInput {
                task_id: "task-1".into(),
                workspace_id: None,
                page_session_id: "page-1".into(),
                page_job_id: None,
                batch_index: None,
                final_batch: false,
                idempotency_key: "task-1".into(),
                mode: "below".into(),
                target_language: "zh-CN".into(),
                model_id: "deepseek-v4-flash".into(),
                prompt_version: "page-v1".into(),
                glossary_version: 0,
                website_rule_version: 0,
                total_segments: 1,
                segments: vec![TranslationTaskSegmentInput {
                    segment_id: "segment-1".into(),
                    source_hash: "abc".into(),
                    placeholder_json: "[]".into(),
                }],
            })
            .await
            .expect("start task");
        repository
            .put_translation_cache(TranslationCacheInput {
                cache_key: "cache-1".into(),
                source_hash: "abc".into(),
                context_hash: "".into(),
                glossary_hash: "0".into(),
                model_profile_hash: "flash:disabled".into(),
                translated_text: "译文".into(),
                target_language: "zh-CN".into(),
                model_id: "deepseek-v4-flash".into(),
                prompt_version: "page-v1".into(),
                domain_id: None,
                glossary_version: 0,
                translation_mode: "below".into(),
                website_rule_version: 0,
                placeholder_json: "[]".into(),
                usage_json: None,
                source_scope: Some("page".into()),
            })
            .await
            .expect("put cache");
        let cached = repository
            .get_translation_cache("cache-1")
            .await
            .expect("get cache")
            .expect("cache hit");
        assert_eq!(cached.translated_text, "译文");
        repository
            .complete_translation_segment("task-1", "segment-1", "译文", None)
            .await
            .expect("segment");
        repository
            .finish_translation_task("task-1", "completed")
            .await
            .expect("finish");
        drop(repository);
        let reopened = Repository::new(open(&path).await.expect("reopen"));
        assert!(
            reopened
                .get_translation_cache("cache-1")
                .await
                .expect("get after restart")
                .is_some()
        );
        let state: String =
            sqlx::query_scalar("SELECT state FROM translation_tasks WHERE id='task-1'")
                .fetch_one(reopened.pool())
                .await
                .expect("task state");
        assert_eq!(state, "completed");
    }

    #[tokio::test]
    async fn dom_stale_ack_supersedes_a_native_translated_segment() {
        let dir = tempdir().expect("tempdir");
        let repository = Repository::new(
            open(dir.path().join("stale-after-translation.db"))
                .await
                .expect("database"),
        );
        repository
            .start_page_translation_job(PageTranslationJobInput {
                job_id: "stale-page-job".into(),
                document_id: None,
                workspace_id: None,
                page_session_id: "stale-page-session".into(),
                idempotency_key: "stale-page-key".into(),
                mode: "replace".into(),
                target_language: "zh-CN".into(),
                model_id: "deepseek-v4-flash".into(),
            })
            .await
            .expect("start page job");
        repository
            .start_translation_task(TranslationTaskInput {
                task_id: "stale-batch".into(),
                workspace_id: None,
                page_session_id: "stale-page-session".into(),
                page_job_id: Some("stale-page-job".into()),
                batch_index: Some(0),
                final_batch: true,
                idempotency_key: "stale-batch-key".into(),
                mode: "replace".into(),
                target_language: "zh-CN".into(),
                model_id: "deepseek-v4-flash".into(),
                prompt_version: "page-v2".into(),
                glossary_version: 0,
                website_rule_version: 0,
                total_segments: 1,
                segments: vec![TranslationTaskSegmentInput {
                    segment_id: "stale-node".into(),
                    source_hash: "source-hash".into(),
                    placeholder_json: "[]".into(),
                }],
            })
            .await
            .expect("start batch");
        repository
            .complete_translation_segment("stale-batch", "stale-node", "译文", None)
            .await
            .expect("native translation completes");
        assert!(
            !repository
                .set_translation_segment_state(
                    "stale-batch",
                    "stale-node",
                    "failed",
                    Some(r#"{"reason":"late_failure"}"#),
                )
                .await
                .expect("reject late failure")
        );
        assert!(
            !repository
                .set_translation_segment_state(
                    "stale-batch",
                    "stale-node",
                    "cancelled",
                    Some(r#"{"reason":"late_cancel"}"#),
                )
                .await
                .expect("reject late cancellation")
        );
        assert!(
            repository
                .set_translation_segment_state(
                    "stale-batch",
                    "stale-node",
                    "stale",
                    Some(r#"{"reason":"dom_changed"}"#),
                )
                .await
                .expect("apply stale DOM acknowledgement")
        );
        repository
            .finish_translation_task("stale-batch", "partial")
            .await
            .expect("finish batch");
        let job = repository
            .finalize_page_translation_job(
                "stale-page-job",
                &PageTranslationJobDiagnostics {
                    discovered: 1,
                    eligible: 1,
                    queued: 1,
                    stale: 1,
                    ..PageTranslationJobDiagnostics::default()
                },
            )
            .await
            .expect("finalize job");
        assert_eq!(job.completed_segments, 0);
        assert_eq!(job.stale_segments, 1);
        assert_eq!(job.state, "partial");
        let segment_state: String = sqlx::query_scalar(
            "SELECT state FROM translation_task_segments WHERE task_id='stale-batch' AND segment_id='stale-node'",
        )
        .fetch_one(repository.pool())
        .await
        .expect("segment state");
        assert_eq!(segment_state, "stale");
    }

    #[tokio::test]
    async fn page_translation_job_aggregates_batches_and_enforces_linkage() {
        let dir = tempdir().expect("tempdir");
        let repository = Repository::new(
            open(dir.path().join("page-job.db"))
                .await
                .expect("database"),
        );
        let job = repository
            .start_page_translation_job(PageTranslationJobInput {
                job_id: "page-job-1".into(),
                document_id: None,
                workspace_id: None,
                page_session_id: "page-session-1".into(),
                idempotency_key: "page-job-key-1".into(),
                mode: "replace".into(),
                target_language: "zh-CN".into(),
                model_id: "deepseek-v4-flash".into(),
            })
            .await
            .expect("start page job");
        assert_eq!(job.state, "running");
        assert_eq!(job.total_batches, 0);

        repository
            .start_translation_task(TranslationTaskInput {
                task_id: "batch-0".into(),
                workspace_id: None,
                page_session_id: "page-session-1".into(),
                page_job_id: Some("page-job-1".into()),
                batch_index: Some(0),
                final_batch: false,
                idempotency_key: "batch-key-0".into(),
                mode: "replace".into(),
                target_language: "zh-CN".into(),
                model_id: "deepseek-v4-flash".into(),
                prompt_version: "page-v2".into(),
                glossary_version: 0,
                website_rule_version: 0,
                total_segments: 2,
                segments: vec![
                    TranslationTaskSegmentInput {
                        segment_id: "node-a".into(),
                        source_hash: "hash-a".into(),
                        placeholder_json: "[]".into(),
                    },
                    TranslationTaskSegmentInput {
                        segment_id: "node-b".into(),
                        source_hash: "hash-b".into(),
                        placeholder_json: "[]".into(),
                    },
                ],
            })
            .await
            .expect("start first batch");
        repository
            .complete_translation_segment("batch-0", "node-a", "译文 A", None)
            .await
            .expect("complete first node");
        repository
            .set_translation_segment_state(
                "batch-0",
                "node-b",
                "failed",
                Some(r#"{"code":"validation"}"#),
            )
            .await
            .expect("fail second node");
        repository
            .finish_translation_task("batch-0", "partial")
            .await
            .expect("finish first batch");
        assert_eq!(
            repository
                .page_translation_job("page-job-1")
                .await
                .expect("load page job")
                .expect("page job")
                .state,
            "running",
            "a job cannot finish before its final batch arrives"
        );

        repository
            .start_translation_task(TranslationTaskInput {
                task_id: "batch-1".into(),
                workspace_id: None,
                page_session_id: "page-session-1".into(),
                page_job_id: Some("page-job-1".into()),
                batch_index: Some(1),
                final_batch: true,
                idempotency_key: "batch-key-1".into(),
                mode: "replace".into(),
                target_language: "zh-CN".into(),
                model_id: "deepseek-v4-flash".into(),
                prompt_version: "page-v2".into(),
                glossary_version: 0,
                website_rule_version: 0,
                total_segments: 1,
                segments: vec![TranslationTaskSegmentInput {
                    segment_id: "node-c".into(),
                    source_hash: "hash-c".into(),
                    placeholder_json: "[]".into(),
                }],
            })
            .await
            .expect("start final batch");
        repository
            .complete_translation_segment("batch-1", "node-c", "译文 C", None)
            .await
            .expect("complete final node");
        repository
            .finish_translation_task("batch-1", "completed")
            .await
            .expect("finish final batch");

        let partial = repository
            .finalize_page_translation_job(
                "page-job-1",
                &PageTranslationJobDiagnostics {
                    discovered: 5,
                    eligible: 3,
                    protected: 1,
                    ignored: 1,
                    completed: 2,
                    failed: 1,
                    ..PageTranslationJobDiagnostics::default()
                },
            )
            .await
            .expect("finalize partial job");
        assert_eq!(partial.state, "partial");
        assert_eq!(partial.total_batches, 2);
        assert_eq!(partial.completed_batches, 2);
        assert_eq!(partial.total_segments, 3);
        assert_eq!(partial.completed_segments, 2);
        assert_eq!(partial.failed_segments, 1);
        assert!(partial.final_batch_received);
        assert_eq!(partial.diagnostics.protected, 1);
        let batches = repository
            .list_page_translation_batches("page-job-1")
            .await
            .expect("list batches");
        assert_eq!(batches.len(), 2);
        assert_eq!(batches[0].batch_index, Some(0));
        assert!(batches[1].final_batch);

        let repaired = repository
            .finalize_page_translation_job(
                "page-job-1",
                &PageTranslationJobDiagnostics {
                    discovered: 5,
                    eligible: 3,
                    protected: 1,
                    ignored: 1,
                    completed: 3,
                    stale: 1,
                    ..PageTranslationJobDiagnostics::default()
                },
            )
            .await
            .expect("finalize repaired DOM state");
        assert_eq!(repaired.state, "completed");

        let invalid_parent = repository
            .start_translation_task(TranslationTaskInput {
                task_id: "orphan-batch".into(),
                workspace_id: None,
                page_session_id: "page-session-1".into(),
                page_job_id: Some("missing-job".into()),
                batch_index: Some(0),
                final_batch: true,
                idempotency_key: "orphan-batch-key".into(),
                mode: "replace".into(),
                target_language: "zh-CN".into(),
                model_id: "deepseek-v4-flash".into(),
                prompt_version: "page-v2".into(),
                glossary_version: 0,
                website_rule_version: 0,
                total_segments: 0,
                segments: Vec::new(),
            })
            .await;
        assert!(
            invalid_parent.is_err(),
            "foreign key/link trigger must reject an orphan batch"
        );

        sqlx::query("DELETE FROM page_translation_jobs WHERE id='page-job-1'")
            .execute(repository.pool())
            .await
            .expect("delete logical job without deleting durable batch records");
        let detached_batches: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM translation_tasks WHERE id IN ('batch-0','batch-1') AND page_job_id IS NULL",
        )
        .fetch_one(repository.pool())
        .await
        .expect("count detached batches");
        assert_eq!(detached_batches, 2);
    }

    #[tokio::test]
    async fn conversation_title_is_generated_once_and_user_rename_is_permanent() {
        let dir = tempdir().expect("tempdir");
        let repository = Repository::new(
            open(dir.path().join("title-lifecycle.db"))
                .await
                .expect("database"),
        );
        let conversation_id = repository
            .create_conversation(ConversationCreateInput {
                workspace_id: None,
                document_id: None,
                title: "新对话".into(),
                knowledge_mode: KnowledgeMode::Hybrid,
                api_profile_id: None,
                model_id: Some("deepseek-v4-pro".into()),
                thinking_enabled: true,
                reasoning_effort: Some("high".into()),
                metadata_json: "{}".into(),
            })
            .await
            .expect("create conversation");
        assert!(
            !repository
                .finalize_conversation_auto_title(&conversation_id, "过早的标题")
                .await
                .expect("attempt early title"),
            "an automatic title requires a completed first answer"
        );
        repository
            .save_conversation_exchange(ConversationExchangeInput {
                conversation_id: Some(conversation_id.clone()),
                title: "ignored provisional title".into(),
                intent: "explain".into(),
                knowledge_mode: KnowledgeMode::Hybrid,
                api_profile_id: None,
                model_id: Some("deepseek-v4-pro".into()),
                thinking_enabled: true,
                reasoning_effort: Some("high".into()),
                user_content: "什么是 Tensor？".into(),
                assistant_content: "Tensor 是多维数组。".into(),
                context_json: None,
                context_hash: None,
                source_title: String::new(),
                source_excerpt: String::new(),
                anchor_json: "{}".into(),
            })
            .await
            .expect("save first answer");
        assert!(
            repository
                .finalize_conversation_auto_title(&conversation_id, "Tensor 基础解释")
                .await
                .expect("generate title")
        );
        assert!(
            !repository
                .finalize_conversation_auto_title(&conversation_id, "不应覆盖")
                .await
                .expect("attempt second generated title")
        );
        repository
            .rename_conversation(&conversation_id, "我的张量笔记")
            .await
            .expect("user rename");
        assert!(
            !repository
                .finalize_conversation_auto_title(&conversation_id, "仍不应覆盖")
                .await
                .expect("attempt title after user rename")
        );
        let detail = repository
            .get_conversation(&conversation_id)
            .await
            .expect("load conversation")
            .expect("conversation");
        assert_eq!(detail.conversation.title, "我的张量笔记");
        assert_eq!(detail.conversation.title_source, "user");
    }

    #[tokio::test]
    async fn assistant_citations_are_idempotent_restored_and_legacy_compatible() {
        let dir = tempdir().expect("tempdir");
        let repository = Repository::new(
            open(dir.path().join("assistant-citations.db"))
                .await
                .expect("database"),
        );
        let citations = vec![
            MessageCitationInput {
                source_kind: MessageCitationSourceKind::Page,
                source_id: Some("https://pytorch.org/docs/stable/tensors.html#tensor".into()),
                source_title: "PyTorch Tensor documentation".into(),
                source_excerpt: "A tensor is a multi-dimensional matrix.".into(),
                locator: serde_json::json!({
                    "url": "https://pytorch.org/docs/stable/tensors.html",
                    "headingPath": ["Tensors", "Initialization"],
                    "textQuote": "A tensor is a multi-dimensional matrix."
                }),
            },
            MessageCitationInput {
                source_kind: MessageCitationSourceKind::GeneralKnowledge,
                source_id: Some("deep-learning/tensor".into()),
                source_title: "通用知识".into(),
                source_excerpt: "张量可视为多维数组。".into(),
                locator: serde_json::json!({ "label": "general-knowledge" }),
            },
        ];
        let exchange = repository
            .save_conversation_exchange_with_citations(
                ConversationExchangeInput {
                    conversation_id: None,
                    title: "新对话".into(),
                    intent: "explain".into(),
                    knowledge_mode: KnowledgeMode::Hybrid,
                    api_profile_id: None,
                    model_id: Some("deepseek-v4-pro".into()),
                    thinking_enabled: true,
                    reasoning_effort: Some("high".into()),
                    user_content: "解释 Tensor".into(),
                    assistant_content: "Tensor 是多维数组。".into(),
                    context_json: None,
                    context_hash: None,
                    source_title: String::new(),
                    source_excerpt: String::new(),
                    anchor_json: "{}".into(),
                },
                &citations,
            )
            .await
            .expect("save cited exchange");

        let repeated = repository
            .save_message_citations(&exchange.assistant_message_id, &citations)
            .await
            .expect("repeat exact citation set");
        assert_eq!(repeated.len(), 2, "an exact retry must be idempotent");

        sqlx::query("INSERT INTO message_sources(id,message_id,document_id,section_id,source_title,source_excerpt,anchor_json,created_at) VALUES('late-legacy-source',?,NULL,NULL,'Legacy page','Legacy excerpt','{\"cssSelector\":\"#legacy\"}',strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
            .bind(&exchange.assistant_message_id)
            .execute(repository.pool())
            .await
            .expect("insert a post-migration legacy source");
        let detail = repository
            .get_conversation(&exchange.conversation_id)
            .await
            .expect("get conversation")
            .expect("conversation");
        let assistant = detail
            .messages
            .iter()
            .find(|message| message.id == exchange.assistant_message_id)
            .expect("assistant message");
        assert_eq!(assistant.citations.len(), 3);
        let page = assistant
            .citations
            .iter()
            .find(|citation| citation.source_kind == "page")
            .expect("page citation");
        assert_eq!(
            page.source_id.as_deref(),
            Some("https://pytorch.org/docs/stable/tensors.html#tensor")
        );
        assert_eq!(page.locator["headingPath"][0], "Tensors");
        let legacy = assistant
            .citations
            .iter()
            .find(|citation| citation.id == "late-legacy-source")
            .expect("legacy source restored without a write");
        assert_eq!(legacy.source_kind, "legacy");
        assert_eq!(legacy.locator["cssSelector"], "#legacy");
        let legacy_anchor: String = sqlx::query_scalar(
            "SELECT anchor_json FROM message_sources WHERE id='late-legacy-source'",
        )
        .fetch_one(repository.pool())
        .await
        .expect("legacy source remains stored");
        assert_eq!(legacy_anchor, r##"{"cssSelector":"#legacy"}"##);

        let user_error = repository
            .save_message_citations(&exchange.user_message_id, &citations[..1])
            .await
            .expect_err("user messages cannot receive assistant citations");
        assert!(matches!(
            user_error,
            DatabaseError::CitationRequiresAssistantMessage
        ));
        let invalid_locator = repository
            .save_message_citations(
                &exchange.assistant_message_id,
                &[MessageCitationInput {
                    source_kind: MessageCitationSourceKind::Tool,
                    source_id: Some("search_current_page".into()),
                    source_title: "Tool result".into(),
                    source_excerpt: "result".into(),
                    locator: serde_json::json!(["not", "an", "object"]),
                }],
            )
            .await
            .expect_err("non-object locator is rejected before writing");
        assert!(matches!(
            invalid_locator,
            DatabaseError::InvalidMessageCitation("locator must be a JSON object")
        ));
        assert_eq!(
            repository
                .message_citations(&exchange.assistant_message_id)
                .await
                .expect("citations after rejected write")
                .len(),
            3,
            "a rejected citation must not mutate stored data"
        );
    }

    #[tokio::test]
    async fn built_in_site_policies_return_their_domain_and_tags() {
        let dir = tempdir().expect("tempdir");
        let repository = Repository::new(
            open(dir.path().join("site-policy.db"))
                .await
                .expect("database"),
        );

        let github = repository
            .resolve_site_policy("github.com")
            .await
            .expect("resolve GitHub policy")
            .expect("GitHub policy");
        assert_eq!(github.primary_domain_id.as_deref(), Some("domain-cs-se"));
        assert_eq!(github.tags, ["工具链"]);
        let serialized_github = serde_json::to_value(&github).expect("serialize GitHub policy");
        assert_eq!(serialized_github["primaryDomainId"], "domain-cs-se");
        assert_eq!(serialized_github["tags"], serde_json::json!(["工具链"]));

        let pytorch = repository
            .resolve_site_policy("pytorch.org")
            .await
            .expect("resolve PyTorch policy")
            .expect("PyTorch policy");
        assert_eq!(pytorch.primary_domain_id.as_deref(), Some("domain-ai-ml"));
        assert_eq!(pytorch.tags, ["深度学习"]);
    }

    #[tokio::test]
    async fn five_turns_append_to_one_conversation_and_preserve_user_title() {
        let dir = tempdir().expect("tempdir");
        let repository = Repository::new(
            open(dir.path().join("conversation.db"))
                .await
                .expect("database"),
        );
        let mut conversation_id = None;
        for turn in 1..=5 {
            let saved_id = repository
                .save_conversation_exchange(ConversationExchangeInput {
                    conversation_id: conversation_id.clone(),
                    title: format!("自动标题 {turn}"),
                    intent: if turn == 1 { "explain" } else { "follow_up" }.into(),
                    knowledge_mode: if turn == 5 {
                        KnowledgeMode::General
                    } else {
                        KnowledgeMode::Hybrid
                    },
                    api_profile_id: None,
                    model_id: Some("deepseek-v4-pro".into()),
                    thinking_enabled: true,
                    reasoning_effort: Some("high".into()),
                    user_content: format!("问题 {turn}"),
                    assistant_content: format!("回答 {turn}"),
                    context_json: Some(format!(r#"{{"turn":{turn}}}"#)),
                    context_hash: Some(format!("context-{turn}")),
                    source_title: "PyTorch documentation".into(),
                    source_excerpt: "Tensor".into(),
                    anchor_json: "{}".into(),
                })
                .await
                .expect("save exchange");
            if turn == 1 {
                conversation_id = Some(saved_id.clone());
                repository
                    .rename_conversation(&saved_id, "我的固定标题")
                    .await
                    .expect("rename");
            }
            assert_eq!(Some(saved_id), conversation_id);
        }
        let conversation_id = conversation_id.expect("conversation id");
        let conversation_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM conversations")
            .fetch_one(repository.pool())
            .await
            .expect("conversation count");
        assert_eq!(conversation_count, 1);
        let message_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM conversation_messages WHERE conversation_id=?",
        )
        .bind(&conversation_id)
        .fetch_one(repository.pool())
        .await
        .expect("message count");
        assert_eq!(message_count, 10);
        let detail = repository
            .get_conversation(&conversation_id)
            .await
            .expect("get conversation")
            .expect("conversation");
        assert_eq!(detail.conversation.title, "我的固定标题");
        assert_eq!(detail.conversation.knowledge_mode, "general");
        assert_eq!(detail.messages.len(), 10);
        assert_eq!(detail.resume_context_json.as_deref(), Some(r#"{"turn":5}"#));
        assert!(
            detail
                .messages
                .iter()
                .skip(1)
                .all(|message| message.parent_message_id.is_some())
        );
        let context_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM message_contexts")
            .fetch_one(repository.pool())
            .await
            .expect("contexts");
        assert_eq!(context_count, 5);
        let citation_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM message_citations")
            .fetch_one(repository.pool())
            .await
            .expect("citations");
        assert_eq!(citation_count, 5);

        let page = repository
            .get_conversation_page(&conversation_id, 2, 3)
            .await
            .expect("page")
            .expect("conversation page");
        assert_eq!(page.message_offset, 2);
        assert_eq!(page.message_limit, 3);
        assert_eq!(page.total_messages, 10);
        assert_eq!(page.messages.len(), 3);
        assert!(page.has_more);
        assert_eq!(page.messages[0].sequence, 2);

        repository
            .set_conversation_archived(&conversation_id, true)
            .await
            .expect("archive");
        let archived_append = repository
            .save_conversation_exchange(ConversationExchangeInput {
                conversation_id: Some(conversation_id),
                title: "ignored".into(),
                intent: "follow_up".into(),
                knowledge_mode: KnowledgeMode::Hybrid,
                api_profile_id: None,
                model_id: Some("deepseek-v4-pro".into()),
                thinking_enabled: false,
                reasoning_effort: None,
                user_content: "不能追加".into(),
                assistant_content: "不能追加".into(),
                context_json: None,
                context_hash: None,
                source_title: String::new(),
                source_excerpt: String::new(),
                anchor_json: "{}".into(),
            })
            .await;
        assert!(matches!(
            archived_append,
            Err(DatabaseError::ConversationArchived)
        ));
    }

    #[tokio::test]
    async fn model_catalog_preserves_verified_capabilities_and_selection_precedence() {
        let dir = tempdir().expect("tempdir");
        let repository =
            Repository::new(open(dir.path().join("models.db")).await.expect("database"));
        repository
            .upsert_model_catalog(
                "deepseek",
                &[
                    ModelCatalogInput {
                        model_id: "deepseek-v4-pro".into(),
                        owner: "deepseek".into(),
                        capability_status: "unverified".into(),
                        supports_thinking: None,
                        reasoning_efforts_json: "[]".into(),
                        supports_streaming: None,
                        supports_json_output: None,
                        supports_tools: None,
                        context_window: None,
                        metadata_json: "{}".into(),
                    },
                    ModelCatalogInput {
                        model_id: "future-model".into(),
                        owner: "deepseek".into(),
                        capability_status: "unverified".into(),
                        supports_thinking: None,
                        reasoning_efforts_json: "[]".into(),
                        supports_streaming: None,
                        supports_json_output: None,
                        supports_tools: None,
                        context_window: None,
                        metadata_json: "{}".into(),
                    },
                ],
            )
            .await
            .expect("upsert catalog");
        let catalog = repository
            .list_model_catalog("deepseek")
            .await
            .expect("list catalog");
        let pro = catalog
            .iter()
            .find(|model| model.model_id == "deepseek-v4-pro")
            .expect("pro model");
        assert_eq!(pro.capability_status, "verified");
        assert_eq!(pro.supports_thinking, Some(true));
        let future = catalog
            .iter()
            .find(|model| model.model_id == "future-model")
            .expect("future model");
        assert_eq!(future.capability_status, "unverified");
        assert_eq!(future.supports_thinking, None);

        for (scope, scope_id, model_id) in [
            ("global", "default", "global-model"),
            ("task", "explanation", "task-model"),
            ("conversation", "conversation-1", "conversation-model"),
        ] {
            repository
                .save_model_selection(&ModelSelectionInput {
                    scope: scope.into(),
                    scope_id: scope_id.into(),
                    task: "explanation".into(),
                    provider_id: "deepseek".into(),
                    api_profile_id: None,
                    model_id: model_id.into(),
                    thinking_enabled: false,
                    reasoning_effort: None,
                })
                .await
                .expect("save selection");
        }
        assert_eq!(
            repository
                .resolve_model_selection(Some("conversation-1"), "explanation")
                .await
                .expect("resolve")
                .expect("selection")
                .model_id,
            "conversation-model"
        );
        assert_eq!(
            repository
                .resolve_model_selection(Some("conversation-1"), "explanation")
                .await
                .expect("resolve provider")
                .expect("selection")
                .provider_id,
            "deepseek"
        );
        assert_eq!(
            repository
                .resolve_model_selection(Some("other"), "explanation")
                .await
                .expect("resolve")
                .expect("selection")
                .model_id,
            "task-model"
        );
    }
}
