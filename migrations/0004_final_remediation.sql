PRAGMA foreign_keys = ON;

-- Conversation lifecycle and per-conversation runtime selection. Existing IDs and rows
-- remain authoritative; new columns have compatibility defaults for legacy records.
ALTER TABLE conversations ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK(status IN ('active','archived','legacy'));
ALTER TABLE conversations ADD COLUMN last_message_at TEXT;
ALTER TABLE conversations ADD COLUMN current_api_profile_id TEXT REFERENCES api_profiles(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN current_model_id TEXT;
ALTER TABLE conversations ADD COLUMN thinking_enabled INTEGER NOT NULL DEFAULT 0
  CHECK(thinking_enabled IN (0,1));
ALTER TABLE conversations ADD COLUMN reasoning_effort TEXT
  CHECK(reasoning_effort IS NULL OR reasoning_effort IN ('high','max'));
ALTER TABLE conversations ADD COLUMN knowledge_mode TEXT NOT NULL DEFAULT 'hybrid'
  CHECK(knowledge_mode IN ('hybrid','page_only','general'));
ALTER TABLE conversations ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE conversations ADD COLUMN title_source TEXT NOT NULL DEFAULT 'pending'
  CHECK(title_source IN ('pending','auto','user','legacy'));
ALTER TABLE conversations ADD COLUMN title_generated_at TEXT;
ALTER TABLE conversations ADD COLUMN archived_at TEXT;

UPDATE conversations
SET last_message_at = COALESCE(
      (SELECT MAX(m.created_at) FROM conversation_messages m WHERE m.conversation_id = conversations.id),
      updated_at
    ),
    title_source = 'legacy',
    status = 'legacy'
WHERE last_message_at IS NULL;

CREATE INDEX idx_conversations_status_last_message
  ON conversations(status, last_message_at DESC, id);

ALTER TABLE conversation_messages ADD COLUMN parent_message_id TEXT REFERENCES conversation_messages(id) ON DELETE SET NULL;
ALTER TABLE conversation_messages ADD COLUMN intent TEXT;
ALTER TABLE conversation_messages ADD COLUMN content_format TEXT NOT NULL DEFAULT 'markdown'
  CHECK(content_format IN ('markdown','plain_text','json'));
ALTER TABLE conversation_messages ADD COLUMN generation_status TEXT NOT NULL DEFAULT 'completed'
  CHECK(generation_status IN ('pending','streaming','completed','failed','cancelled'));
ALTER TABLE conversation_messages ADD COLUMN api_profile_id TEXT REFERENCES api_profiles(id) ON DELETE SET NULL;
ALTER TABLE conversation_messages ADD COLUMN model_id TEXT;
ALTER TABLE conversation_messages ADD COLUMN thinking_enabled INTEGER NOT NULL DEFAULT 0
  CHECK(thinking_enabled IN (0,1));
ALTER TABLE conversation_messages ADD COLUMN reasoning_effort TEXT
  CHECK(reasoning_effort IS NULL OR reasoning_effort IN ('high','max'));
ALTER TABLE conversation_messages ADD COLUMN updated_at TEXT;
ALTER TABLE conversation_messages ADD COLUMN sequence INTEGER;

UPDATE conversation_messages AS target
SET updated_at = created_at,
    sequence = (
      SELECT COUNT(*) - 1
      FROM conversation_messages AS prior
      WHERE prior.conversation_id = target.conversation_id
        AND (prior.created_at < target.created_at
          OR (prior.created_at = target.created_at AND prior.rowid <= target.rowid))
    )
WHERE updated_at IS NULL OR sequence IS NULL;
CREATE INDEX idx_messages_conversation_order
  ON conversation_messages(conversation_id, sequence, id);
CREATE UNIQUE INDEX idx_messages_conversation_sequence
  ON conversation_messages(conversation_id, sequence);
CREATE INDEX idx_messages_parent ON conversation_messages(parent_message_id);

-- One logical page job owns every bounded Native Host batch for the same page
-- session. Batch rows remain durable if the logical job is ever removed, while
-- the normal lifecycle keeps them linked through a restricted foreign key.
CREATE TABLE page_translation_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  page_session_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'running'
    CHECK(state IN ('queued','running','paused','completed','partial','failed','cancelled')),
  mode TEXT NOT NULL CHECK(mode IN ('replace','below','bilingual')),
  target_language TEXT NOT NULL DEFAULT 'zh-CN',
  model_id TEXT NOT NULL,
  total_batches INTEGER NOT NULL DEFAULT 0 CHECK(total_batches >= 0),
  completed_batches INTEGER NOT NULL DEFAULT 0 CHECK(completed_batches >= 0),
  failed_batches INTEGER NOT NULL DEFAULT 0 CHECK(failed_batches >= 0),
  total_segments INTEGER NOT NULL DEFAULT 0 CHECK(total_segments >= 0),
  completed_segments INTEGER NOT NULL DEFAULT 0 CHECK(completed_segments >= 0),
  failed_segments INTEGER NOT NULL DEFAULT 0 CHECK(failed_segments >= 0),
  stale_segments INTEGER NOT NULL DEFAULT 0 CHECK(stale_segments >= 0),
  final_batch_received INTEGER NOT NULL DEFAULT 0 CHECK(final_batch_received IN (0,1)),
  scan_diagnostics_json TEXT NOT NULL DEFAULT '{}'
    CHECK(json_valid(scan_diagnostics_json)),
  cancelled_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_page_translation_jobs_state_updated
  ON page_translation_jobs(state, updated_at DESC);
CREATE INDEX idx_page_translation_jobs_page_session
  ON page_translation_jobs(page_session_id, created_at DESC);

ALTER TABLE translation_tasks ADD COLUMN page_job_id TEXT
  REFERENCES page_translation_jobs(id) ON DELETE SET NULL;
ALTER TABLE translation_tasks ADD COLUMN batch_index INTEGER
  CHECK(batch_index IS NULL OR batch_index >= 0);
ALTER TABLE translation_tasks ADD COLUMN final_batch INTEGER NOT NULL DEFAULT 0
  CHECK(final_batch IN (0,1));
CREATE UNIQUE INDEX idx_translation_tasks_page_job_batch
  ON translation_tasks(page_job_id, batch_index)
  WHERE page_job_id IS NOT NULL;
CREATE UNIQUE INDEX idx_translation_tasks_page_job_final
  ON translation_tasks(page_job_id)
  WHERE page_job_id IS NOT NULL AND final_batch=1;
CREATE INDEX idx_translation_tasks_page_job_state
  ON translation_tasks(page_job_id, state, batch_index);
CREATE TRIGGER trg_translation_tasks_page_batch_insert
BEFORE INSERT ON translation_tasks
WHEN (NEW.page_job_id IS NULL AND (NEW.batch_index IS NOT NULL OR NEW.final_batch != 0))
  OR (NEW.page_job_id IS NOT NULL AND NEW.batch_index IS NULL)
  OR (NEW.page_job_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM page_translation_jobs job
    WHERE job.id=NEW.page_job_id
      AND job.page_session_id=NEW.page_session_id
      AND job.mode=NEW.mode
      AND job.target_language=NEW.target_language
  ))
BEGIN
  SELECT RAISE(ABORT, 'invalid page translation batch linkage');
END;
CREATE TRIGGER trg_translation_tasks_page_batch_update
BEFORE UPDATE OF page_job_id,batch_index,final_batch,page_session_id,mode,target_language
ON translation_tasks
WHEN (NEW.page_job_id IS NULL AND OLD.page_job_id IS NULL
      AND (NEW.batch_index IS NOT NULL OR NEW.final_batch != 0))
  OR (NEW.page_job_id IS NOT NULL AND NEW.batch_index IS NULL)
  OR (NEW.page_job_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM page_translation_jobs job
    WHERE job.id=NEW.page_job_id
      AND job.page_session_id=NEW.page_session_id
      AND job.mode=NEW.mode
      AND job.target_language=NEW.target_language
  ))
BEGIN
  SELECT RAISE(ABORT, 'invalid page translation batch linkage');
END;

CREATE TABLE message_contexts (
  id TEXT PRIMARY KEY NOT NULL,
  message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  context_kind TEXT NOT NULL CHECK(context_kind IN ('selection','page','section','workspace','tool')),
  context_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_message_contexts_message ON message_contexts(message_id, created_at);

CREATE TABLE message_citations (
  id TEXT PRIMARY KEY NOT NULL,
  message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  section_id TEXT REFERENCES document_sections(id) ON DELETE SET NULL,
  source_kind TEXT NOT NULL DEFAULT 'page'
    CHECK(source_kind IN ('page','workspace','general_knowledge','tool','legacy')),
  source_title TEXT NOT NULL,
  source_excerpt TEXT NOT NULL,
  anchor_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_message_citations_message ON message_citations(message_id, created_at);

-- Preserve message_sources as a read-compatible legacy table and copy its contents.
INSERT OR IGNORE INTO message_citations(
  id,message_id,document_id,section_id,source_kind,source_title,source_excerpt,anchor_json,created_at
)
SELECT id,message_id,document_id,section_id,'legacy',source_title,source_excerpt,anchor_json,created_at
FROM message_sources;

CREATE TABLE model_catalog (
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  owner TEXT NOT NULL DEFAULT '',
  availability TEXT NOT NULL DEFAULT 'available'
    CHECK(availability IN ('available','unavailable','unknown')),
  capability_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK(capability_status IN ('verified','unverified','manual')),
  supports_thinking INTEGER CHECK(supports_thinking IS NULL OR supports_thinking IN (0,1)),
  reasoning_efforts_json TEXT NOT NULL DEFAULT '[]',
  supports_streaming INTEGER CHECK(supports_streaming IS NULL OR supports_streaming IN (0,1)),
  supports_json_output INTEGER CHECK(supports_json_output IS NULL OR supports_json_output IN (0,1)),
  supports_tools INTEGER CHECK(supports_tools IS NULL OR supports_tools IN (0,1)),
  context_window INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(provider_id, model_id)
);
CREATE INDEX idx_model_catalog_availability
  ON model_catalog(provider_id, availability, model_id);

CREATE TABLE model_selection_state (
  scope TEXT NOT NULL CHECK(scope IN ('global','task','conversation')),
  scope_id TEXT NOT NULL,
  task TEXT NOT NULL,
  provider_id TEXT NOT NULL DEFAULT 'deepseek',
  api_profile_id TEXT REFERENCES api_profiles(id) ON DELETE SET NULL,
  model_id TEXT NOT NULL,
  thinking_enabled INTEGER NOT NULL DEFAULT 0 CHECK(thinking_enabled IN (0,1)),
  reasoning_effort TEXT CHECK(reasoning_effort IS NULL OR reasoning_effort IN ('high','max')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(scope, scope_id, task)
);
CREATE INDEX idx_model_selection_model ON model_selection_state(model_id, updated_at DESC);

INSERT OR IGNORE INTO task_presets(
  id,task,label,model_id,thinking_enabled,reasoning_effort,max_output_tokens,
  timeout_ms,streaming,is_builtin,created_at,updated_at
) VALUES(
  'preset-term','term_disambiguation','术语消歧','deepseek-v4-pro',1,'high',4096,
  90000,0,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
);

INSERT OR IGNORE INTO model_selection_state(
  scope,scope_id,task,provider_id,api_profile_id,model_id,thinking_enabled,reasoning_effort,updated_at
)
SELECT 'task',task,task,'deepseek',NULL,model_id,thinking_enabled,reasoning_effort,
       strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM task_presets;

-- Official adapter capabilities are reviewed independently from /models. The latter
-- supplies only IDs/owners/availability and must not overwrite these verified flags.
INSERT INTO model_catalog(
  provider_id,model_id,owner,availability,capability_status,supports_thinking,
  reasoning_efforts_json,supports_streaming,supports_json_output,supports_tools,
  metadata_json,last_seen_at,created_at,updated_at
) VALUES
('deepseek','deepseek-v4-flash','deepseek','unknown','verified',1,'["high","max"]',1,1,1,
 '{"source":"official_adapter_seed"}',NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('deepseek','deepseek-v4-pro','deepseek','unknown','verified',1,'["high","max"]',1,1,1,
 '{"source":"official_adapter_seed"}',NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- Bring the taxonomy to the eight top-level disciplines required by AGENT.md while
-- retaining all stable IDs referenced by existing workspaces, rules and entries.
UPDATE glossary_domains SET name='机器人与自主系统' WHERE id='domain-robotics';
UPDATE glossary_domains SET name='人工智能、机器学习与数据科学' WHERE id='domain-ai-ml';
UPDATE glossary_domains SET name='数学、优化与控制' WHERE id='domain-math-control';
UPDATE glossary_domains SET name='机械、航空航天与能源工程' WHERE id='domain-aerospace-mechanics';
UPDATE glossary_domains SET name='电子、通信与嵌入式系统' WHERE id='domain-electronics-comms';
UPDATE glossary_domains SET name='通用学术（辅助）', kind='tag' WHERE id='domain-general-academic';

INSERT OR IGNORE INTO glossary_domains(id,name,parent_id,kind,created_at) VALUES
('domain-physical-materials','物理、化学与材料科学',NULL,'top_level',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('domain-life-biomedical','生命科学、医学与生物医学工程',NULL,'top_level',strftime('%Y-%m-%dT%H:%M:%fZ','now'));

UPDATE website_rules
SET primary_domain_id=NULL,
    tags_json=CASE WHEN tags_json='[]' THEN '["通用学术"]' ELSE tags_json END,
    version=version+1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE primary_domain_id='domain-general-academic';

INSERT INTO schema_metadata(key,value,created_at,updated_at) VALUES
('schema_version','4',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(key) DO UPDATE SET value='4',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');

PRAGMA user_version = 4;
