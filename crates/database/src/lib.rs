use std::path::{Path, PathBuf};

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{SqlitePool, migrate::MigrateError};
use thiserror::Error;

mod global_memory;
mod memory_import;
mod repository;
mod site_scope;
pub use global_memory::*;
pub use memory_import::*;
pub use repository::*;
pub use site_scope::*;

pub const SCHEMA_VERSION: i64 = 5;
static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("../../migrations");

#[derive(Debug, Error)]
pub enum DatabaseError {
    #[error("database connection failed: {0}")]
    Connect(#[from] sqlx::Error),
    #[error("database migration failed: {0}")]
    Migrate(#[from] MigrateError),
    #[error("database backup before schema upgrade failed: {0}")]
    Backup(sqlx::Error),
    #[error("database field {field} contains invalid JSON: {source}")]
    InvalidJson {
        field: &'static str,
        #[source]
        source: serde_json::Error,
    },
    #[error("conversation was not found")]
    ConversationNotFound,
    #[error("conversation is archived")]
    ConversationArchived,
    #[error("conversation message was not found")]
    ConversationMessageNotFound,
    #[error("message citations can only be attached to assistant messages")]
    CitationRequiresAssistantMessage,
    #[error("invalid message citation: {0}")]
    InvalidMessageCitation(&'static str),
    #[error("page translation job was not found")]
    PageTranslationJobNotFound,
    #[error("invalid page translation batch: {0}")]
    InvalidPageTranslationBatch(&'static str),
}

pub async fn open(path: impl AsRef<Path>) -> Result<SqlitePool, DatabaseError> {
    let path = path.as_ref();
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;
    let installed_version = schema_version(&pool).await?;
    if (1..SCHEMA_VERSION).contains(&installed_version) {
        backup_before_upgrade(&pool, path, installed_version).await?;
    }
    MIGRATOR.run(&pool).await?;
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&pool)
        .await?;
    Ok(pool)
}

async fn backup_before_upgrade(
    pool: &SqlitePool,
    path: &Path,
    installed_version: i64,
) -> Result<PathBuf, DatabaseError> {
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(pool)
        .await
        .map_err(DatabaseError::Backup)?;
    let mut suffix = 0_u32;
    let backup_path = loop {
        let discriminator = if suffix == 0 {
            String::new()
        } else {
            format!("-{suffix}")
        };
        let candidate = PathBuf::from(format!(
            "{}.pre-v{}-to-v{}{}.bak",
            path.display(),
            installed_version,
            SCHEMA_VERSION,
            discriminator
        ));
        if !candidate.exists() {
            break candidate;
        }
        suffix = suffix.saturating_add(1);
    };
    sqlx::query("VACUUM INTO ?")
        .bind(backup_path.to_string_lossy().as_ref())
        .execute(pool)
        .await
        .map_err(DatabaseError::Backup)?;
    Ok(backup_path)
}

pub async fn schema_version(pool: &SqlitePool) -> Result<i64, DatabaseError> {
    let version = sqlx::query_scalar::<_, i64>("PRAGMA user_version")
        .fetch_one(pool)
        .await?;
    Ok(version)
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use tempfile::tempdir;

    use super::{SCHEMA_VERSION, open, schema_version};

    #[tokio::test]
    async fn migrates_an_empty_database_with_wal_foreign_keys_and_fts5() {
        let directory = tempdir().expect("temporary directory");
        let database_path = directory.path().join("yanyi-test.db");
        let pool = open(&database_path).await.expect("open migrated database");

        assert_eq!(
            schema_version(&pool).await.expect("read schema version"),
            SCHEMA_VERSION
        );
        let foreign_keys: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
            .fetch_one(&pool)
            .await
            .expect("foreign key setting");
        assert_eq!(foreign_keys, 1);
        let journal_mode: String = sqlx::query_scalar("PRAGMA journal_mode")
            .fetch_one(&pool)
            .await
            .expect("journal mode");
        assert_eq!(journal_mode.to_ascii_lowercase(), "wal");

        let table_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type IN ('table', 'view')",
        )
        .fetch_one(&pool)
        .await
        .expect("count schema objects");
        assert!(table_count >= 47);

        // Global memory retrieval relies on FTS5 staying in sync through triggers.
        sqlx::query("INSERT INTO global_memories(id,type,title,content,normalized_content,created_at,updated_at) VALUES('memory-1','domain_background','背景','熟悉 ROS 2 与 Isaac Lab','熟悉 ros 2 与 isaac lab','2026-01-01','2026-01-01')")
            .execute(&pool)
            .await
            .expect("insert global memory");
        let memory_matches: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM global_memories_fts WHERE global_memories_fts MATCH ?",
        )
        .bind("Isaac")
        .fetch_one(&pool)
        .await
        .expect("query global memory FTS");
        assert_eq!(memory_matches, 1);
        sqlx::query("UPDATE global_memories SET content='熟悉 PX4 自动飞行' WHERE id='memory-1'")
            .execute(&pool)
            .await
            .expect("update global memory");
        let stale_matches: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM global_memories_fts WHERE global_memories_fts MATCH ?",
        )
        .bind("Isaac")
        .fetch_one(&pool)
        .await
        .expect("query stale global memory FTS");
        assert_eq!(stale_matches, 0);
        sqlx::query("DELETE FROM global_memories WHERE id='memory-1'")
            .execute(&pool)
            .await
            .expect("delete global memory");
        let deleted_matches: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM global_memories_fts WHERE global_memories_fts MATCH ?",
        )
        .bind("PX4")
        .fetch_one(&pool)
        .await
        .expect("query deleted global memory FTS");
        assert_eq!(deleted_matches, 0);

        let preset_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM task_presets")
            .fetch_one(&pool)
            .await
            .expect("count task presets");
        assert_eq!(preset_count, 8);
        let term_preset_model: String = sqlx::query_scalar(
            "SELECT model_id FROM task_presets WHERE task='term_disambiguation'",
        )
        .fetch_one(&pool)
        .await
        .expect("term disambiguation preset");
        assert_eq!(term_preset_model, "deepseek-v4-pro");
        let domain_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM glossary_domains WHERE kind='top_level'")
                .fetch_one(&pool)
                .await
                .expect("count domains");
        assert_eq!(domain_count, 8);
        let top_level_ids: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM glossary_domains WHERE kind='top_level' ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .expect("top-level domain IDs");
        assert_eq!(
            top_level_ids,
            [
                "domain-aerospace-mechanics",
                "domain-ai-ml",
                "domain-cs-se",
                "domain-electronics-comms",
                "domain-life-biomedical",
                "domain-math-control",
                "domain-physical-materials",
                "domain-robotics",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect::<Vec<_>>()
        );
        let auxiliary_domain_kind: String = sqlx::query_scalar(
            "SELECT kind FROM glossary_domains WHERE id='domain-general-academic'",
        )
        .fetch_one(&pool)
        .await
        .expect("general academic classification");
        assert_eq!(auxiliary_domain_kind, "tag");
        let builtin_rule_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM website_rules WHERE is_builtin=1")
                .fetch_one(&pool)
                .await
                .expect("count built-in site rules");
        assert_eq!(builtin_rule_count, 6);

        let pdf_table_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'pdf_documents'",
        )
        .fetch_one(&pool)
        .await
        .expect("find PDF schema");
        assert_eq!(pdf_table_count, 1);
        let page_job_table_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='page_translation_jobs'",
        )
        .fetch_one(&pool)
        .await
        .expect("find page translation job schema");
        assert_eq!(page_job_table_count, 1);
        let page_job_columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info('page_translation_jobs')")
                .fetch_all(&pool)
                .await
                .expect("page job columns");
        for required in [
            "workspace_id",
            "page_session_id",
            "state",
            "total_batches",
            "final_batch_received",
            "scan_diagnostics_json",
        ] {
            assert!(
                page_job_columns.iter().any(|column| column == required),
                "page_translation_jobs must contain {required}"
            );
        }
        let translation_task_columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info('translation_tasks')")
                .fetch_all(&pool)
                .await
                .expect("translation task columns");
        for required in ["page_job_id", "batch_index", "final_batch"] {
            assert!(
                translation_task_columns
                    .iter()
                    .any(|column| column == required),
                "translation_tasks must contain {required}"
            );
        }
        let page_job_foreign_key: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_foreign_key_list('translation_tasks') WHERE \"table\"='page_translation_jobs' AND \"from\"='page_job_id'",
        )
        .fetch_one(&pool)
        .await
        .expect("page job foreign key");
        assert_eq!(page_job_foreign_key, 1);
        let citation_columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info('message_citations')")
                .fetch_all(&pool)
                .await
                .expect("citation columns");
        for required in [
            "source_kind",
            "source_title",
            "source_excerpt",
            "anchor_json",
        ] {
            assert!(
                citation_columns.iter().any(|column| column == required),
                "message_citations must contain {required}"
            );
        }
        let conversation_columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info('conversations')")
                .fetch_all(&pool)
                .await
                .expect("conversation columns");
        for required in [
            "workspace_id",
            "title_source",
            "knowledge_mode",
            "current_model_id",
        ] {
            assert!(
                conversation_columns.iter().any(|column| column == required),
                "conversations must contain {required}"
            );
        }
        let model_selection_columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info('model_selection_state')")
                .fetch_all(&pool)
                .await
                .expect("model selection columns");
        for required in [
            "provider_id",
            "api_profile_id",
            "model_id",
            "reasoning_effort",
        ] {
            assert!(
                model_selection_columns
                    .iter()
                    .any(|column| column == required),
                "model_selection_state must contain {required}"
            );
        }

        sqlx::query(
            "INSERT INTO search_fts(entity_id, kind, title, body, source) VALUES (?, ?, ?, ?, ?)",
        )
        .bind("doc-1")
        .bind("document")
        .bind("Reinforcement Learning")
        .bind("deterministic policy gradient")
        .bind("arxiv.org")
        .execute(&pool)
        .await
        .expect("insert FTS fixture");
        let match_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM search_fts WHERE search_fts MATCH ?")
                .bind("policy")
                .fetch_one(&pool)
                .await
                .expect("query FTS fixture");
        assert_eq!(match_count, 1);
    }

    #[tokio::test]
    async fn migrations_are_safe_to_run_again() {
        let directory = tempdir().expect("temporary directory");
        let database_path = directory.path().join("yanyi-repeat.db");
        open(&database_path)
            .await
            .expect("first migration")
            .close()
            .await;
        open(&database_path)
            .await
            .expect("second migration")
            .close()
            .await;
    }

    async fn create_database_at_version(path: &Path, version: usize) {
        let migration_source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../migrations");
        let migration_directory = tempdir().expect("temporary migration directory");
        for name in [
            "0001_initial.sql",
            "0002_full_product.sql",
            "0003_seed_taxonomy_and_site_rules.sql",
            "0004_final_remediation.sql",
        ]
        .into_iter()
        .take(version)
        {
            fs::copy(
                migration_source.join(name),
                migration_directory.path().join(name),
            )
            .expect("copy released migration");
        }
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .expect("open historical database");
        let migrator = sqlx::migrate::Migrator::new(migration_directory.path())
            .await
            .expect("load historical migrations");
        migrator
            .run(&pool)
            .await
            .expect("run historical migrations");
        sqlx::query("INSERT INTO workspaces(id,name,description,secondary_domains_json,tags_json,created_at,updated_at) VALUES('legacy-workspace','Legacy','fixture','[]','[]','2026-01-01','2026-01-01')")
            .execute(&pool)
            .await
            .expect("insert legacy fixture");
        sqlx::query("INSERT INTO conversations(id,workspace_id,document_id,title,created_at,updated_at) VALUES('legacy-conversation',NULL,NULL,'Legacy conversation','2026-01-01','2026-01-01')")
            .execute(&pool).await.expect("insert legacy conversation");
        sqlx::query("INSERT INTO conversation_messages(id,conversation_id,role,content,created_at) VALUES('legacy-message','legacy-conversation','assistant','Legacy answer','2026-01-01')")
            .execute(&pool).await.expect("insert legacy message");
        sqlx::query("INSERT INTO message_sources(id,message_id,document_id,section_id,source_title,source_excerpt,anchor_json,created_at) VALUES('legacy-source','legacy-message',NULL,NULL,'Legacy source','Excerpt','{}','2026-01-01')")
            .execute(&pool).await.expect("insert legacy source");
        pool.close().await;
    }

    #[tokio::test]
    async fn upgrades_every_released_schema_with_backup_and_without_data_loss() {
        for previous_version in 1..=4 {
            let directory = tempdir().expect("temporary directory");
            let database_path = directory
                .path()
                .join(format!("yanyi-v{previous_version}.db"));
            create_database_at_version(&database_path, previous_version).await;

            let pool = open(&database_path)
                .await
                .expect("upgrade historical database");
            assert_eq!(
                schema_version(&pool).await.expect("schema version"),
                SCHEMA_VERSION
            );
            let legacy_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM workspaces WHERE id='legacy-workspace'")
                    .fetch_one(&pool)
                    .await
                    .expect("legacy workspace");
            assert_eq!(legacy_count, 1);
            let new_table_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('message_contexts','message_citations','model_catalog','model_selection_state','page_translation_jobs')")
                .fetch_one(&pool)
                .await
                .expect("v4 tables");
            assert_eq!(new_table_count, 5);
            let v5_table_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('site_active_conversations','global_memories','global_memory_tags','global_memory_tag_links','global_memory_import_jobs','global_memory_candidates','global_memory_snapshots')")
                .fetch_one(&pool)
                .await
                .expect("v5 tables");
            assert_eq!(v5_table_count, 7);
            // The legacy conversation must survive without being merged into a site scope.
            let legacy_site_origin: Option<String> = sqlx::query_scalar(
                "SELECT site_origin FROM conversations WHERE id='legacy-conversation'",
            )
            .fetch_one(&pool)
            .await
            .expect("legacy conversation site origin");
            assert_eq!(legacy_site_origin, None);
            // Rows that predate 0004 are backfilled to 'legacy'. A v4 fixture is
            // written after that backfill, so it keeps the column default.
            let legacy_status: String = sqlx::query_scalar(
                "SELECT status FROM conversations WHERE id='legacy-conversation'",
            )
            .fetch_one(&pool)
            .await
            .expect("legacy conversation status");
            let legacy_title_source: String = sqlx::query_scalar(
                "SELECT title_source FROM conversations WHERE id='legacy-conversation'",
            )
            .fetch_one(&pool)
            .await
            .expect("legacy conversation title source");
            if previous_version < 4 {
                assert_eq!(legacy_status, "legacy");
                assert_eq!(legacy_title_source, "legacy");
            } else {
                assert_eq!(legacy_status, "active");
                assert_eq!(legacy_title_source, "pending");
            }
            // 0004 copies message_sources into message_citations once. A v4 fixture is
            // written after that copy, so only pre-v4 rows are expected to appear.
            let migrated_citations: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM message_citations WHERE id='legacy-source' AND source_kind='legacy'",
            )
            .fetch_one(&pool)
            .await
            .expect("legacy citation");
            assert_eq!(migrated_citations, i64::from(previous_version < 4));
            // The original row is never destroyed by the upgrade.
            let retained_sources: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM message_sources WHERE id='legacy-source'")
                    .fetch_one(&pool)
                    .await
                    .expect("retained legacy source");
            assert_eq!(retained_sources, 1);
            pool.close().await;

            let backup_prefix = format!(
                "{}.pre-v{}-to-v{}",
                database_path.display(),
                previous_version,
                SCHEMA_VERSION
            );
            assert!(
                fs::read_dir(directory.path())
                    .expect("list backups")
                    .filter_map(Result::ok)
                    .any(|entry| entry.path().to_string_lossy().starts_with(&backup_prefix)),
                "v{previous_version} upgrade must create a backup"
            );
        }
    }
}
