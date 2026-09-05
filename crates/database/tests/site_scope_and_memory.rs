//! Integration coverage for site-scoped conversations and global memory against
//! a real migrated SQLite database.

use database::{
    GlobalMemoryError, GlobalMemoryInput, ImportFormat, KnowledgeMode, Repository,
    conversation_count_for_site, open, parse_import, site_origin,
};
use tempfile::tempdir;

async fn repository(name: &str) -> (Repository, tempfile::TempDir) {
    let directory = tempdir().expect("temporary directory");
    let pool = open(directory.path().join(name))
        .await
        .expect("open migrated database");
    (Repository::new(pool), directory)
}

fn memory(memory_type: &str, content: &str) -> GlobalMemoryInput {
    GlobalMemoryInput {
        memory_type: memory_type.to_owned(),
        title: String::new(),
        content: content.to_owned(),
        enabled: true,
        pinned: false,
        priority: 0,
        tags: Vec::new(),
    }
}

async fn conversation(repository: &Repository, title: &str) -> String {
    repository
        .create_conversation(database::ConversationCreateInput {
            workspace_id: None,
            document_id: None,
            title: title.to_owned(),
            knowledge_mode: KnowledgeMode::default(),
            api_profile_id: None,
            model_id: Some("deepseek-v4-pro".to_owned()),
            thinking_enabled: false,
            reasoning_effort: None,
            metadata_json: "{}".to_owned(),
        })
        .await
        .expect("create conversation")
}

#[tokio::test]
async fn five_selections_on_one_site_reuse_one_conversation_until_new_chat() {
    let (repository, _directory) = repository("site-scope.db").await;
    let origin = site_origin("https://developer.nvidia.com/blog/post-a").expect("origin");

    // Five consecutive questions from different pages of the same site.
    let mut conversation_id: Option<String> = None;
    for index in 0..5 {
        let existing = repository
            .active_conversation_for_site(&origin)
            .await
            .expect("read active conversation");
        let id = match existing {
            Some(id) => id,
            None => {
                let created = conversation(&repository, "新对话").await;
                repository
                    .set_active_conversation_for_site(&origin, &created, "hybrid")
                    .await
                    .expect("bind active conversation");
                created
            }
        };
        repository
            .touch_conversation_page(
                &id,
                Some(&origin),
                Some(&format!("https://developer.nvidia.com/blog/post-{index}")),
                Some("NVIDIA Developer"),
            )
            .await
            .expect("record page");
        if let Some(previous) = &conversation_id {
            assert_eq!(previous, &id, "every question must reuse the same thread");
        }
        conversation_id = Some(id);
    }
    assert_eq!(
        conversation_count_for_site(repository.pool(), &origin)
            .await
            .expect("count"),
        1
    );

    // Explicit "新聊天" is the only thing that creates a second conversation.
    let second = conversation(&repository, "新对话").await;
    repository
        .set_active_conversation_for_site(&origin, &second, "hybrid")
        .await
        .expect("rebind");
    repository
        .touch_conversation_page(&second, Some(&origin), None, None)
        .await
        .expect("record page");
    assert_eq!(
        conversation_count_for_site(repository.pool(), &origin)
            .await
            .expect("count"),
        2
    );
    assert_eq!(
        repository
            .active_conversation_for_site(&origin)
            .await
            .expect("active"),
        Some(second)
    );
}

#[tokio::test]
async fn different_origins_do_not_share_an_active_conversation() {
    let (repository, _directory) = repository("site-isolation.db").await;
    let nvidia = site_origin("https://developer.nvidia.com/a").expect("origin");
    let pytorch = site_origin("https://docs.pytorch.org/a").expect("origin");

    let first = conversation(&repository, "NVIDIA").await;
    repository
        .set_active_conversation_for_site(&nvidia, &first, "hybrid")
        .await
        .expect("bind");
    assert_eq!(
        repository
            .active_conversation_for_site(&pytorch)
            .await
            .expect("other origin"),
        None
    );
}

#[tokio::test]
async fn archived_conversations_are_not_reused_as_the_active_thread() {
    let (repository, _directory) = repository("site-archived.db").await;
    let origin = site_origin("https://example.com/doc").expect("origin");
    let id = conversation(&repository, "归档会话").await;
    repository
        .set_active_conversation_for_site(&origin, &id, "hybrid")
        .await
        .expect("bind");
    repository
        .set_conversation_archived(&id, true)
        .await
        .expect("archive");
    assert_eq!(
        repository
            .active_conversation_for_site(&origin)
            .await
            .expect("active"),
        None
    );
}

#[tokio::test]
async fn global_memory_supports_full_crud_and_rejects_duplicates() {
    let (repository, _directory) = repository("memory-crud.db").await;

    let id = repository
        .create_global_memory(memory("profile", "我是飞行器设计与工程专业本科生"))
        .await
        .expect("create memory");
    let listed = repository
        .list_global_memories("", None, 50)
        .await
        .expect("list");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, id);
    assert!(listed[0].enabled);

    // Same content and type twice is refused so the prompt prefix cannot repeat.
    let duplicate = repository
        .create_global_memory(memory("profile", "  我是飞行器设计与工程专业本科生 "))
        .await;
    assert!(matches!(duplicate, Err(GlobalMemoryError::Duplicate)));

    repository
        .update_global_memory(
            &id,
            GlobalMemoryInput {
                memory_type: "profile".to_owned(),
                title: "专业".to_owned(),
                content: "我是飞行器设计与工程专业研究生".to_owned(),
                enabled: true,
                pinned: true,
                priority: 10,
                tags: vec!["航空".to_owned(), "航空".to_owned()],
            },
        )
        .await
        .expect("update memory");
    let updated = repository
        .list_global_memories("研究生", None, 50)
        .await
        .expect("search");
    assert_eq!(updated.len(), 1);
    assert!(updated[0].pinned);
    assert_eq!(updated[0].priority, 10);
    assert_eq!(
        repository.global_memory_tags(&id).await.expect("tags"),
        vec!["航空".to_owned()]
    );

    repository
        .set_global_memory_enabled(&id, false)
        .await
        .expect("disable");
    assert!(
        !repository
            .list_global_memories("", None, 50)
            .await
            .expect("list")[0]
            .enabled
    );

    repository
        .delete_global_memory(&id)
        .await
        .expect("delete memory");
    assert!(
        repository
            .list_global_memories("", None, 50)
            .await
            .expect("list")
            .is_empty()
    );
    assert!(matches!(
        repository.delete_global_memory(&id).await,
        Err(GlobalMemoryError::NotFound)
    ));
}

#[tokio::test]
async fn retrieval_injects_only_relevant_and_enabled_memories() {
    let (repository, _directory) = repository("memory-retrieval.db").await;
    repository
        .create_global_memory(memory(
            "domain_background",
            "熟悉 Python、ROS 2、PX4 和 Isaac Lab",
        ))
        .await
        .expect("create background");
    repository
        .create_global_memory(memory(
            "personal_context",
            "我也在研究细胞培养与显微成像流程",
        ))
        .await
        .expect("create unrelated");
    let disabled = repository
        .create_global_memory(memory("preference", "ROS 相关内容请使用英文缩写"))
        .await
        .expect("create disabled");
    repository
        .set_global_memory_enabled(&disabled, false)
        .await
        .expect("disable");

    let retrieved = repository
        .retrieve_global_memories("ROS 2 Isaac Lab 控制器", 5)
        .await
        .expect("retrieve");
    let contents: Vec<&str> = retrieved
        .iter()
        .map(|entry| entry.memory.content.as_str())
        .collect();
    assert!(contents.iter().any(|content| content.contains("Isaac Lab")));
    // Unrelated memory must not be sent, and disabled memory must never be sent.
    assert!(!contents.iter().any(|content| content.contains("细胞培养")));
    assert!(!contents.iter().any(|content| content.contains("英文缩写")));

    // A pinned memory is always eligible regardless of the query.
    let pinned = repository
        .create_global_memory(GlobalMemoryInput {
            pinned: true,
            ..memory("response_style", "先给结论，再解释原理")
        })
        .await
        .expect("create pinned");
    let unrelated_query = repository
        .retrieve_global_memories("完全无关的园艺话题", 5)
        .await
        .expect("retrieve");
    assert_eq!(unrelated_query.len(), 1);
    assert_eq!(unrelated_query[0].memory.id, pinned);

    repository
        .mark_global_memories_used(std::slice::from_ref(&pinned))
        .await
        .expect("mark used");
    let used = repository
        .list_global_memories("", Some("response_style"), 10)
        .await
        .expect("list");
    assert_eq!(used[0].usage_count, 1);
    assert!(used[0].last_used_at.is_some());
}

#[tokio::test]
async fn snapshot_is_deterministic_and_only_changes_when_memories_change() {
    let (repository, _directory) = repository("memory-snapshot.db").await;
    let pinned = repository
        .create_global_memory(GlobalMemoryInput {
            pinned: true,
            ..memory("response_style", "先给结论，再解释原理")
        })
        .await
        .expect("create pinned");

    let first = repository.global_memory_snapshot().await.expect("snapshot");
    let second = repository.global_memory_snapshot().await.expect("snapshot");
    assert_eq!(first, second, "repeated reads must be byte identical");
    assert!(first.stable_response_style.contains("先给结论"));

    // Recording usage must not disturb the cached prefix.
    repository
        .mark_global_memories_used(std::slice::from_ref(&pinned))
        .await
        .expect("mark used");
    assert_eq!(
        repository.global_memory_snapshot().await.expect("snapshot"),
        first
    );

    // Editing a pinned memory does change the fingerprint and version.
    repository
        .update_global_memory(
            &pinned,
            GlobalMemoryInput {
                pinned: true,
                ..memory("response_style", "先给结论，再给实施步骤")
            },
        )
        .await
        .expect("update");
    let third = repository.global_memory_snapshot().await.expect("snapshot");
    assert_ne!(third.fingerprint, first.fingerprint);
    assert!(third.version > first.version);
}

#[tokio::test]
async fn import_requires_confirmation_before_anything_is_saved() {
    let (repository, _directory) = repository("memory-import.db").await;
    let candidates = parse_import(
        "# 回答风格\n- 先给结论再解释\n\n# 翻译偏好\n- 框架名默认保留英文\n".as_bytes(),
        ImportFormat::Md,
        "custom",
    )
    .expect("parse markdown");
    let job = repository
        .create_global_memory_import_job("profile.md", ImportFormat::Md, 96, &candidates)
        .await
        .expect("create job");

    // Import alone must not create memories.
    assert!(
        repository
            .list_global_memories("", None, 50)
            .await
            .expect("list")
            .is_empty()
    );
    let pending = repository
        .list_global_memory_candidates(&job)
        .await
        .expect("candidates");
    assert_eq!(pending.len(), 2);
    assert!(pending.iter().all(|entry| entry.state == "pending"));

    // Only the confirmed candidate is written.
    let accepted = vec![pending[0].id.clone()];
    let created = repository
        .apply_global_memory_candidates(&job, &accepted)
        .await
        .expect("apply");
    assert_eq!(created, 1);
    let saved = repository
        .list_global_memories("", None, 50)
        .await
        .expect("list");
    assert_eq!(saved.len(), 1);
    assert_eq!(saved[0].source_type, "import");
    let reviewed = repository
        .list_global_memory_candidates(&job)
        .await
        .expect("candidates");
    assert_eq!(reviewed[0].state, "accepted");
    assert_eq!(reviewed[1].state, "rejected");
    let jobs = repository
        .list_global_memory_import_jobs(10)
        .await
        .expect("jobs");
    assert_eq!(jobs[0].state, "applied");
    assert_eq!(jobs[0].accepted_count, 1);
}

#[tokio::test]
async fn importing_existing_content_is_marked_duplicate_and_never_written_twice() {
    let (repository, _directory) = repository("memory-import-duplicate.db").await;
    repository
        .create_global_memory(memory("preference", "框架名默认保留英文"))
        .await
        .expect("create memory");
    let json = r#"{"memories":[{"type":"preference","content":"framework names stay in English"},
                               {"type":"preference","content":"框架名默认保留英文"}]}"#;
    let candidates =
        parse_import(json.as_bytes(), ImportFormat::Json, "custom").expect("parse json");
    let job = repository
        .create_global_memory_import_job("memories.json", ImportFormat::Json, 128, &candidates)
        .await
        .expect("create job");
    let pending = repository
        .list_global_memory_candidates(&job)
        .await
        .expect("candidates");
    let duplicate = pending
        .iter()
        .find(|entry| entry.content.contains("框架名"))
        .expect("duplicate candidate");
    assert_eq!(duplicate.state, "duplicate");

    // Accepting everything still cannot create a second copy.
    let all: Vec<String> = pending.iter().map(|entry| entry.id.clone()).collect();
    let created = repository
        .apply_global_memory_candidates(&job, &all)
        .await
        .expect("apply");
    assert_eq!(created, 1);
    assert_eq!(
        repository
            .list_global_memories("", Some("preference"), 50)
            .await
            .expect("list")
            .len(),
        2
    );
}

#[tokio::test]
async fn discarding_an_import_creates_no_memory() {
    let (repository, _directory) = repository("memory-import-discard.db").await;
    let candidates = parse_import(b"one entry", ImportFormat::Txt, "custom").expect("parse text");
    let job = repository
        .create_global_memory_import_job("a.txt", ImportFormat::Txt, 9, &candidates)
        .await
        .expect("create job");
    repository
        .discard_global_memory_import_job(&job)
        .await
        .expect("discard");
    assert!(
        repository
            .list_global_memories("", None, 50)
            .await
            .expect("list")
            .is_empty()
    );
    let jobs = repository
        .list_global_memory_import_jobs(10)
        .await
        .expect("jobs");
    assert_eq!(jobs[0].state, "discarded");
}
