use database::{
    CandidateTermRecord, ConversationDetailRecord, ConversationQuery, ConversationRecord,
    DashboardSummary, GlobalMemoryCandidateRecord, GlobalMemoryImportJobRecord, GlobalMemoryInput,
    GlobalMemoryRecord, GlossaryEntryInput, GlossaryEntryRecord, ImportFormat, MAX_IMPORT_BYTES,
    MemoryCandidateRecord, MemoryRecord, ModelCatalogRecord, ModelSelectionInput,
    ModelSelectionRecord, Repository, TaskPresetRecord, WebsiteRuleInput, WebsiteRuleRecord,
    WorkspaceInput, WorkspaceRecord, parse_import,
};
use serde::{Deserialize, Serialize};
use std::io::Read;
use tauri::Manager;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use translator_core::{DATABASE_SCHEMA_VERSION, PROTOCOL_VERSION};

fn hidden_command(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    let mut command = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvironmentStatus {
    app_version: &'static str,
    database_path: String,
    database_schema_version: u32,
    native_host_name: &'static str,
    protocol_version: u32,
}

fn shared_database_path() -> Result<std::path::PathBuf, String> {
    let root = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "找不到 LocalAppData。".to_owned())?;
    Ok(root.join("Yanyi").join("data").join("yanyi.db"))
}

fn yanyi_root() -> Result<std::path::PathBuf, String> {
    shared_database_path()?
        .parent()
        .and_then(std::path::Path::parent)
        .map(std::path::Path::to_path_buf)
        .ok_or_else(|| "本地数据目录无效。".to_owned())
}

fn timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeRegistrationStatus {
    edge: bool,
    chrome: bool,
}

fn registry_key_exists(path: &str) -> bool {
    hidden_command("reg.exe")
        .args(["query", path, "/ve"])
        .output()
        .is_ok_and(|output| output.status.success())
}

#[tauri::command]
fn native_registration_status() -> NativeRegistrationStatus {
    NativeRegistrationStatus {
        edge: registry_key_exists(
            r"HKCU\Software\Microsoft\Edge\NativeMessagingHosts\cn.yanyi.native_host",
        ),
        chrome: registry_key_exists(
            r"HKCU\Software\Google\Chrome\NativeMessagingHosts\cn.yanyi.native_host",
        ),
    }
}

#[tauri::command]
fn native_registration_repair() -> Result<NativeRegistrationStatus, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let output = hidden_command(executable)
        .arg("--register-native-host")
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    Ok(native_registration_status())
}

#[tauri::command]
fn open_local_directory(kind: String) -> Result<(), String> {
    let root = yanyi_root()?;
    let path = match kind.as_str() {
        "data" => root.join("data"),
        "logs" => root.join("logs"),
        _ => return Err("目录类型无效。".to_owned()),
    };
    std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    std::process::Command::new("explorer.exe")
        .arg(&path)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
async fn cache_clear(repository: tauri::State<'_, Repository>) -> Result<u64, String> {
    repository
        .clear_translation_cache()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn data_export(repository: tauri::State<'_, Repository>) -> Result<String, String> {
    sqlx::query("PRAGMA wal_checkpoint(FULL)")
        .execute(repository.pool())
        .await
        .map_err(|error| error.to_string())?;
    let backup_dir = yanyi_root()?.join("backups");
    std::fs::create_dir_all(&backup_dir).map_err(|error| error.to_string())?;
    let destination = backup_dir.join(format!("yanyi-{}.db", timestamp()));
    std::fs::copy(shared_database_path()?, &destination).map_err(|error| error.to_string())?;
    Ok(destination.display().to_string())
}

#[tauri::command]
async fn data_import_schedule(path: String) -> Result<String, String> {
    let source = std::path::PathBuf::from(path);
    let metadata = std::fs::metadata(&source).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > 512 * 1024 * 1024 {
        return Err("导入文件必须是小于 512 MB 的 SQLite 数据库。".to_owned());
    }
    let mut file = std::fs::File::open(&source).map_err(|error| error.to_string())?;
    let mut header = [0_u8; 16];
    file.read_exact(&mut header)
        .map_err(|_| "导入文件不是有效 SQLite 数据库。".to_owned())?;
    if &header != b"SQLite format 3\0" {
        return Err("导入文件不是有效 SQLite 数据库。".to_owned());
    }
    let pending = yanyi_root()?.join("data").join("pending-import.db");
    std::fs::copy(&source, &pending).map_err(|error| error.to_string())?;
    let pool = database::open(&pending)
        .await
        .map_err(|error| format!("导入数据库迁移验证失败：{error}"))?;
    pool.close().await;
    Ok("导入文件已验证；重启研译后生效，当前数据库会自动备份。".to_owned())
}

#[tauri::command]
async fn diagnostic_export(repository: tauri::State<'_, Repository>) -> Result<String, String> {
    let directory = yanyi_root()?.join("diagnostics");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let destination = directory.join(format!("diagnostic-{}.json", timestamp()));
    let summary = repository
        .dashboard()
        .await
        .map_err(|error| error.to_string())?;
    let report = serde_json::json!({
        "generatedAtUnix": timestamp(), "appVersion": env!("CARGO_PKG_VERSION"),
        "protocolVersion": PROTOCOL_VERSION, "databaseSchemaVersion": DATABASE_SCHEMA_VERSION,
        "nativeRegistration": native_registration_status(), "summary": summary,
        "redaction": "API key, page content, translations, query strings and conversation bodies are excluded"
    });
    std::fs::write(
        &destination,
        serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(destination.display().to_string())
}

#[tauri::command]
fn startup_status() -> bool {
    registry_key_exists(r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run")
        && hidden_command("reg.exe")
            .args([
                "query",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                "Yanyi",
            ])
            .output()
            .is_ok_and(|output| output.status.success())
}

#[tauri::command]
fn startup_set(enabled: bool) -> Result<bool, String> {
    let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    let status = if enabled {
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        let value = format!("\"{}\"", executable.display());
        hidden_command("reg.exe")
            .args([
                "add", key, "/v", "Yanyi", "/t", "REG_SZ", "/d", &value, "/f",
            ])
            .status()
    } else {
        hidden_command("reg.exe")
            .args(["delete", key, "/v", "Yanyi", "/f"])
            .status()
    }
    .map_err(|error| error.to_string())?;
    if !status.success() && enabled {
        return Err(format!("开机启动设置失败：{status}"));
    }
    Ok(startup_status())
}

#[tauri::command]
async fn environment_status() -> Result<EnvironmentStatus, String> {
    let database_path = shared_database_path()?;
    if let Some(parent) = database_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let pool = database::open(&database_path)
        .await
        .map_err(|error| error.to_string())?;
    pool.close().await;
    Ok(EnvironmentStatus {
        app_version: env!("CARGO_PKG_VERSION"),
        database_path: database_path.display().to_string(),
        database_schema_version: DATABASE_SCHEMA_VERSION,
        native_host_name: "cn.yanyi.native_host",
        protocol_version: PROTOCOL_VERSION,
    })
}

#[tauri::command]
async fn dashboard_summary(
    repository: tauri::State<'_, Repository>,
) -> Result<DashboardSummary, String> {
    repository
        .dashboard()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn workspace_list(
    repository: tauri::State<'_, Repository>,
    include_archived: bool,
) -> Result<Vec<WorkspaceRecord>, String> {
    repository
        .list_workspaces(include_archived)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn workspace_save(
    repository: tauri::State<'_, Repository>,
    input: WorkspaceInput,
) -> Result<WorkspaceRecord, String> {
    if input.name.trim().is_empty() {
        return Err("工作区名称不能为空。".to_owned());
    }
    repository
        .save_workspace(input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn workspace_archive(
    repository: tauri::State<'_, Repository>,
    id: String,
    archived: bool,
) -> Result<(), String> {
    repository
        .set_workspace_archived(&id, archived)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn workspace_delete(
    repository: tauri::State<'_, Repository>,
    id: String,
) -> Result<(), String> {
    repository
        .soft_delete_workspace(&id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn glossary_list(
    repository: tauri::State<'_, Repository>,
    search: String,
    limit: u32,
) -> Result<Vec<GlossaryEntryRecord>, String> {
    repository
        .list_glossary(&search, limit)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn glossary_save(
    repository: tauri::State<'_, Repository>,
    input: GlossaryEntryInput,
) -> Result<GlossaryEntryRecord, String> {
    if input.source_term.trim().is_empty() {
        return Err("原文术语不能为空。".to_owned());
    }
    repository
        .save_glossary_entry(input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn glossary_delete(
    repository: tauri::State<'_, Repository>,
    id: String,
) -> Result<(), String> {
    repository
        .delete_glossary_entry(&id)
        .await
        .map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlossaryImportRow {
    source_term: String,
    target_term: Option<String>,
    strategy: String,
    scope: String,
    workspace_id: Option<String>,
    domain_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GlossaryImportResult {
    inserted: u64,
    updated: u64,
    skipped: u64,
}

#[tauri::command]
async fn glossary_export(repository: tauri::State<'_, Repository>) -> Result<String, String> {
    let rows = sqlx::query_as::<_, GlossaryEntryRecord>("SELECT id, workspace_id, domain_id, source_term, target_term, strategy, scope, source, confirmed_at, created_at, updated_at FROM glossary_entries ORDER BY source_term COLLATE NOCASE")
        .fetch_all(repository.pool()).await.map_err(|error| error.to_string())?;
    let directory = yanyi_root()?.join("exports");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(format!("glossary-{}.json", timestamp()));
    let bytes = serde_json::to_vec_pretty(&rows).map_err(|error| error.to_string())?;
    std::fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn glossary_import(
    path: String,
    strategy: String,
    repository: tauri::State<'_, Repository>,
) -> Result<GlossaryImportResult, String> {
    if !matches!(strategy.as_str(), "merge" | "overwrite" | "skip") {
        return Err("导入策略必须是 merge、overwrite 或 skip。".to_owned());
    }
    let source = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
    if source.extension().and_then(|value| value.to_str()) != Some("json") {
        return Err("首版导入仅接受 .json；CSV 可导出，TBX 为预留格式。".to_owned());
    }
    let metadata = std::fs::metadata(&source).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > 10 * 1024 * 1024 {
        return Err("术语导入文件必须是小于 10 MB 的 JSON 文件。".to_owned());
    }
    let rows: Vec<GlossaryImportRow> =
        serde_json::from_slice(&std::fs::read(&source).map_err(|error| error.to_string())?)
            .map_err(|error| format!("术语 JSON Schema 无效：{error}"))?;
    if rows.len() > 5_000 {
        return Err("单次最多导入 5000 条术语。".to_owned());
    }
    let mut result = GlossaryImportResult {
        inserted: 0,
        updated: 0,
        skipped: 0,
    };
    for row in rows {
        if row.source_term.trim().is_empty()
            || !matches!(
                row.strategy.as_str(),
                "never_translate"
                    | "fixed"
                    | "polysemous"
                    | "first_with_source"
                    | "always_with_source"
                    | "page_temporary"
            )
            || row.scope.trim().is_empty()
        {
            return Err("术语条目包含空原词、非法策略或空作用域。".to_owned());
        }
        let existing: Option<String> = sqlx::query_scalar("SELECT id FROM glossary_entries WHERE lower(source_term)=lower(?) AND scope=? AND COALESCE(workspace_id,'')=COALESCE(?,'') AND COALESCE(domain_id,'')=COALESCE(?,'') ORDER BY updated_at DESC LIMIT 1")
            .bind(row.source_term.trim()).bind(&row.scope).bind(row.workspace_id.as_deref()).bind(row.domain_id.as_deref())
            .fetch_optional(repository.pool()).await.map_err(|error| error.to_string())?;
        if existing.is_some() && strategy == "skip" {
            result.skipped += 1;
            continue;
        }
        repository
            .save_glossary_entry(GlossaryEntryInput {
                id: existing.clone(),
                workspace_id: row.workspace_id,
                domain_id: row.domain_id,
                source_term: row.source_term,
                target_term: row.target_term,
                strategy: row.strategy,
                scope: row.scope,
            })
            .await
            .map_err(|error| error.to_string())?;
        if existing.is_some() {
            result.updated += 1;
        } else {
            result.inserted += 1;
        }
    }
    Ok(result)
}

#[tauri::command]
async fn candidate_list(
    repository: tauri::State<'_, Repository>,
    state: String,
    limit: u32,
) -> Result<Vec<CandidateTermRecord>, String> {
    repository
        .list_candidate_terms(&state, limit)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn candidate_set_state(
    repository: tauri::State<'_, Repository>,
    id: String,
    state: String,
) -> Result<(), String> {
    if !matches!(
        state.as_str(),
        "pending" | "accepted" | "ignored" | "merged"
    ) {
        return Err("候选术语状态无效。".to_owned());
    }
    repository
        .set_candidate_state(&id, &state)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn website_rule_list(
    repository: tauri::State<'_, Repository>,
) -> Result<Vec<WebsiteRuleRecord>, String> {
    repository
        .list_website_rules()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn website_rule_save(
    repository: tauri::State<'_, Repository>,
    input: WebsiteRuleInput,
) -> Result<WebsiteRuleRecord, String> {
    if input.domain_pattern.trim().is_empty() {
        return Err("域名匹配不能为空。".to_owned());
    }
    repository
        .save_website_rule(input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn conversation_list(
    repository: tauri::State<'_, Repository>,
    search: String,
    status: Option<String>,
    offset: u32,
    limit: u32,
) -> Result<Vec<ConversationRecord>, String> {
    if status
        .as_deref()
        .is_some_and(|value| !matches!(value, "active" | "archived" | "legacy"))
    {
        return Err("会话状态筛选无效。".to_owned());
    }
    repository
        .query_conversations(ConversationQuery {
            search,
            status,
            offset,
            limit,
        })
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn conversation_get(
    repository: tauri::State<'_, Repository>,
    conversation_id: String,
    message_offset: u32,
    message_limit: u32,
) -> Result<ConversationDetailRecord, String> {
    repository
        .get_conversation_page(&conversation_id, message_offset, message_limit)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "找不到指定会话。".to_owned())
}

#[tauri::command]
async fn conversation_rename(
    repository: tauri::State<'_, Repository>,
    conversation_id: String,
    title: String,
) -> Result<(), String> {
    if title.trim().is_empty() || title.chars().count() > 200 {
        return Err("会话标题必须为 1 至 200 个字符。".to_owned());
    }
    if repository
        .rename_conversation(&conversation_id, &title)
        .await
        .map_err(|error| error.to_string())?
    {
        Ok(())
    } else {
        Err("找不到指定会话。".to_owned())
    }
}

#[tauri::command]
async fn conversation_archive(
    repository: tauri::State<'_, Repository>,
    conversation_id: String,
    archived: bool,
) -> Result<(), String> {
    if repository
        .set_conversation_archived(&conversation_id, archived)
        .await
        .map_err(|error| error.to_string())?
    {
        Ok(())
    } else {
        Err("找不到指定会话。".to_owned())
    }
}

#[tauri::command]
async fn conversation_delete(
    repository: tauri::State<'_, Repository>,
    conversation_id: String,
    confirmed: bool,
) -> Result<(), String> {
    if !confirmed {
        return Err(
            "永久删除前必须显式确认；如需保留记录，请先在数据与诊断页备份数据库。".to_owned(),
        );
    }
    if repository
        .delete_conversation(&conversation_id)
        .await
        .map_err(|error| error.to_string())?
    {
        Ok(())
    } else {
        Err("找不到指定会话。".to_owned())
    }
}

#[tauri::command]
async fn model_catalog_list(
    repository: tauri::State<'_, Repository>,
    provider_id: String,
) -> Result<Vec<ModelCatalogRecord>, String> {
    repository
        .list_model_catalog(&provider_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn model_catalog_refresh(
    repository: tauri::State<'_, Repository>,
    provider_id: String,
) -> Result<Vec<ModelCatalogRecord>, String> {
    native_host::refresh_model_catalog(&repository, &provider_id).await
}

#[tauri::command]
async fn model_selection_get(
    repository: tauri::State<'_, Repository>,
    conversation_id: Option<String>,
    task: String,
) -> Result<Option<ModelSelectionRecord>, String> {
    repository
        .resolve_model_selection(conversation_id.as_deref(), &task)
        .await
        .map_err(|error| error.to_string())
}

fn model_selection_scope_is_valid(scope: &str, scope_id: &str, task: &str) -> bool {
    match scope {
        "global" => scope_id == "default",
        "task" => scope_id == task,
        "conversation" => !scope_id.trim().is_empty(),
        _ => false,
    }
}

#[tauri::command]
async fn model_selection_set(
    repository: tauri::State<'_, Repository>,
    provider_id: String,
    input: ModelSelectionInput,
) -> Result<ModelSelectionRecord, String> {
    if !model_selection_scope_is_valid(&input.scope, &input.scope_id, &input.task)
        || input.task.trim().is_empty()
        || input.model_id.trim().is_empty()
    {
        return Err("模型选择字段无效。".to_owned());
    }
    let model = repository
        .list_model_catalog(&provider_id)
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|model| model.model_id == input.model_id)
        .ok_or_else(|| "模型不在已验证目录中；请先刷新模型列表。".to_owned())?;
    if model.availability == "unavailable" {
        return Err("所选模型当前不可用；研译不会自动切换模型。".to_owned());
    }
    if input.thinking_enabled && model.supports_thinking != Some(true) {
        return Err("所选模型的思考能力未验证或不受支持。".to_owned());
    }
    if let Some(effort) = input.reasoning_effort.as_deref() {
        let efforts = serde_json::from_str::<Vec<String>>(&model.reasoning_efforts_json)
            .map_err(|_| "模型推理强度元数据无效。".to_owned())?;
        if !input.thinking_enabled || !efforts.iter().any(|value| value == effort) {
            return Err("所选模型不支持该推理强度。".to_owned());
        }
    }
    repository
        .save_model_selection(&input)
        .await
        .map_err(|error| error.to_string())?;
    repository
        .resolve_model_selection(
            (input.scope == "conversation").then_some(input.scope_id.as_str()),
            &input.task,
        )
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "模型选择保存后无法读取。".to_owned())
}

#[cfg(test)]
mod tests {
    use super::model_selection_scope_is_valid;

    #[test]
    fn model_selection_scope_requires_canonical_scope_ids() {
        assert!(model_selection_scope_is_valid(
            "task",
            "explanation",
            "explanation"
        ));
        assert!(!model_selection_scope_is_valid(
            "task",
            "deep_follow_up",
            "explanation"
        ));
        assert!(model_selection_scope_is_valid(
            "global",
            "default",
            "explanation"
        ));
        assert!(!model_selection_scope_is_valid(
            "global",
            "other",
            "explanation"
        ));
        assert!(model_selection_scope_is_valid(
            "conversation",
            "conversation-1",
            "explanation"
        ));
        assert!(!model_selection_scope_is_valid(
            "conversation",
            "  ",
            "explanation"
        ));
    }
}

#[tauri::command]
async fn memory_list(
    repository: tauri::State<'_, Repository>,
    search: String,
    limit: u32,
) -> Result<Vec<MemoryRecord>, String> {
    repository
        .list_memories(&search, limit)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn memory_candidate_list(
    repository: tauri::State<'_, Repository>,
) -> Result<Vec<MemoryCandidateRecord>, String> {
    repository
        .list_memory_candidates(100)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn memory_candidate_set_state(
    repository: tauri::State<'_, Repository>,
    id: String,
    state: String,
) -> Result<(), String> {
    if !matches!(state.as_str(), "confirmed" | "rejected") {
        return Err("记忆候选状态无效。".to_owned());
    }
    repository
        .set_memory_candidate_state(&id, &state)
        .await
        .map_err(|error| error.to_string())
}

// --- Global memory -----------------------------------------------------------
//
// Global memory holds who the user is and how they want answers written. It is
// deliberately separate from the glossary (how a term is translated) and from
// workspaces (which documents belong to a project). Everything here is local to
// this machine; nothing is uploaded, and only relevant entries reach a prompt.

#[tauri::command]
async fn global_memory_list(
    repository: tauri::State<'_, Repository>,
    search: String,
    memory_type: Option<String>,
    limit: u32,
) -> Result<Vec<GlobalMemoryRecord>, String> {
    repository
        .list_global_memories(&search, memory_type.as_deref(), limit)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn global_memory_create(
    repository: tauri::State<'_, Repository>,
    input: GlobalMemoryInput,
) -> Result<String, String> {
    repository
        .create_global_memory(input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn global_memory_update(
    repository: tauri::State<'_, Repository>,
    id: String,
    input: GlobalMemoryInput,
) -> Result<(), String> {
    repository
        .update_global_memory(&id, input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn global_memory_set_enabled(
    repository: tauri::State<'_, Repository>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    repository
        .set_global_memory_enabled(&id, enabled)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn global_memory_set_pinned(
    repository: tauri::State<'_, Repository>,
    id: String,
    pinned: bool,
) -> Result<(), String> {
    repository
        .set_global_memory_pinned(&id, pinned)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn global_memory_delete(
    repository: tauri::State<'_, Repository>,
    id: String,
) -> Result<(), String> {
    repository
        .delete_global_memory(&id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn global_memory_tags(
    repository: tauri::State<'_, Repository>,
    id: String,
) -> Result<Vec<String>, String> {
    repository
        .global_memory_tags(&id)
        .await
        .map_err(|error| error.to_string())
}

/// Parses an imported file into reviewable candidates.
///
/// The file is read from disk here rather than being passed through the UI, and
/// nothing is written to `global_memories` until the user confirms candidates.
#[tauri::command]
async fn global_memory_import_preview(
    repository: tauri::State<'_, Repository>,
    path: String,
    default_type: String,
) -> Result<GlobalMemoryImportPreview, String> {
    let file_path = std::path::Path::new(&path);
    let file_name = file_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "无法读取文件名。".to_owned())?;
    let format = ImportFormat::from_file_name(file_name)
        .ok_or_else(|| "仅支持 .txt、.md 和 .json 文件。".to_owned())?;
    // Reject oversized files before reading them into memory. Reads are bounded to
    // MAX_IMPORT_BYTES, so a synchronous read cannot stall the command for long.
    let metadata =
        std::fs::metadata(file_path).map_err(|error| format!("无法读取文件：{error}"))?;
    if !metadata.is_file() {
        return Err("所选路径不是文件。".to_owned());
    }
    if metadata.len() > MAX_IMPORT_BYTES as u64 {
        return Err(format!(
            "文件超出 {} KiB 的导入上限。",
            MAX_IMPORT_BYTES / 1024
        ));
    }
    let bytes = std::fs::read(file_path).map_err(|error| format!("无法读取文件：{error}"))?;
    let candidates =
        parse_import(&bytes, format, &default_type).map_err(|error| error.to_string())?;
    let job_id = repository
        .create_global_memory_import_job(file_name, format, bytes.len(), &candidates)
        .await
        .map_err(|error| error.to_string())?;
    let stored = repository
        .list_global_memory_candidates(&job_id)
        .await
        .map_err(|error| error.to_string())?;
    Ok(GlobalMemoryImportPreview {
        job_id,
        source_name: file_name.to_owned(),
        source_format: format.as_str().to_owned(),
        candidates: stored,
    })
}

#[tauri::command]
async fn global_memory_import_apply(
    repository: tauri::State<'_, Repository>,
    job_id: String,
    accepted_ids: Vec<String>,
) -> Result<usize, String> {
    repository
        .apply_global_memory_candidates(&job_id, &accepted_ids)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn global_memory_import_discard(
    repository: tauri::State<'_, Repository>,
    job_id: String,
) -> Result<(), String> {
    repository
        .discard_global_memory_import_job(&job_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn global_memory_import_jobs(
    repository: tauri::State<'_, Repository>,
) -> Result<Vec<GlobalMemoryImportJobRecord>, String> {
    repository
        .list_global_memory_import_jobs(50)
        .await
        .map_err(|error| error.to_string())
}

/// Exports every global memory as JSON in the same shape the importer accepts.
#[tauri::command]
async fn global_memory_export(repository: tauri::State<'_, Repository>) -> Result<String, String> {
    let memories = repository
        .export_global_memories()
        .await
        .map_err(|error| error.to_string())?;
    let payload = serde_json::json!({
        "memories": memories
            .iter()
            .map(|memory| serde_json::json!({
                "type": memory.memory_type,
                "title": memory.title,
                "content": memory.content,
            }))
            .collect::<Vec<_>>(),
    });
    serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())
}

/// Reports the stable snapshot that anchors the cacheable prompt prefix.
#[tauri::command]
async fn global_memory_snapshot(
    repository: tauri::State<'_, Repository>,
) -> Result<database::GlobalMemorySnapshot, String> {
    repository
        .global_memory_snapshot()
        .await
        .map_err(|error| error.to_string())
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct GlobalMemoryImportPreview {
    job_id: String,
    source_name: String,
    source_format: String,
    candidates: Vec<GlobalMemoryCandidateRecord>,
}

#[tauri::command]
async fn task_preset_list(
    repository: tauri::State<'_, Repository>,
) -> Result<Vec<TaskPresetRecord>, String> {
    repository
        .list_task_presets()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn api_config_status() -> native_host::ApiConfigStatus {
    native_host::api_config_status()
}

#[tauri::command]
fn api_config_save(
    input: native_host::ApiConfigInput,
) -> Result<native_host::ApiConfigStatus, String> {
    native_host::configure_api_config(input)?;
    Ok(native_host::api_config_status())
}

#[tauri::command]
fn api_config_clear() -> Result<native_host::ApiConfigStatus, String> {
    native_host::clear_api_config()?;
    Ok(native_host::api_config_status())
}

#[tauri::command]
async fn api_connection_test(model: Option<String>) -> Result<native_host::ApiSmokeResult, String> {
    native_host::test_api_connection(model).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let database_path = shared_database_path().map_err(std::io::Error::other)?;
            if let Some(parent) = database_path.parent() {
                std::fs::create_dir_all(parent)?;
                let pending = parent.join("pending-import.db");
                if pending.exists() {
                    if database_path.exists() {
                        let backup = yanyi_root()
                            .map_err(std::io::Error::other)?
                            .join("backups")
                            .join(format!("pre-import-{}.db", timestamp()));
                        if let Some(backup_parent) = backup.parent() {
                            std::fs::create_dir_all(backup_parent)?;
                        }
                        std::fs::copy(&database_path, backup)?;
                        std::fs::remove_file(&database_path)?;
                        for suffix in ["db-wal", "db-shm"] {
                            let sidecar = database_path.with_extension(suffix);
                            if sidecar.exists() {
                                std::fs::remove_file(sidecar)?;
                            }
                        }
                    }
                    std::fs::rename(pending, &database_path)?;
                }
            }
            let pool = tauri::async_runtime::block_on(database::open(database_path))?;
            app.manage(Repository::new(pool));
            let mut tray = TrayIconBuilder::new().tooltip("研译 · 本地翻译服务");
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_tray_icon_event(|tray, event| {
                if matches!(
                    event,
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                ) && let Some(window) = tray.app_handle().get_webview_window("main")
                {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            })
            .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            environment_status,
            dashboard_summary,
            workspace_list,
            workspace_save,
            workspace_archive,
            workspace_delete,
            glossary_list,
            glossary_save,
            glossary_delete,
            glossary_export,
            glossary_import,
            candidate_list,
            candidate_set_state,
            website_rule_list,
            website_rule_save,
            conversation_list,
            conversation_get,
            conversation_rename,
            conversation_archive,
            conversation_delete,
            memory_list,
            memory_candidate_list,
            memory_candidate_set_state,
            global_memory_list,
            global_memory_create,
            global_memory_update,
            global_memory_set_enabled,
            global_memory_set_pinned,
            global_memory_delete,
            global_memory_tags,
            global_memory_import_preview,
            global_memory_import_apply,
            global_memory_import_discard,
            global_memory_import_jobs,
            global_memory_export,
            global_memory_snapshot,
            task_preset_list,
            model_catalog_list,
            model_catalog_refresh,
            model_selection_get,
            model_selection_set,
            api_config_status,
            api_config_save,
            api_config_clear,
            api_connection_test,
            native_registration_status,
            native_registration_repair,
            open_local_directory,
            cache_clear,
            data_export,
            data_import_schedule,
            diagnostic_export,
            startup_status,
            startup_set,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Yanyi desktop application");
}
