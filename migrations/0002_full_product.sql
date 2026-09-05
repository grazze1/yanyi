PRAGMA foreign_keys = ON;

CREATE TABLE schema_metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE glossary_subdomains (
  id TEXT PRIMARY KEY NOT NULL,
  domain_id TEXT NOT NULL REFERENCES glossary_domains(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(domain_id, name)
);
CREATE INDEX idx_glossary_subdomains_domain ON glossary_subdomains(domain_id, name);

CREATE TABLE glossary_examples (
  id TEXT PRIMARY KEY NOT NULL,
  sense_id TEXT NOT NULL REFERENCES glossary_senses(id) ON DELETE CASCADE,
  source_text TEXT NOT NULL,
  target_text TEXT,
  is_positive INTEGER NOT NULL DEFAULT 1 CHECK(is_positive IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_glossary_examples_sense ON glossary_examples(sense_id, is_positive);

CREATE TABLE glossary_import_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  format TEXT NOT NULL CHECK(format IN ('json','csv','tbx')),
  strategy TEXT NOT NULL CHECK(strategy IN ('merge','overwrite','skip')),
  source_name TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('preview','applied','reverted','failed')),
  total_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_json TEXT,
  undo_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE task_presets (
  id TEXT PRIMARY KEY NOT NULL,
  task TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  model_id TEXT NOT NULL,
  thinking_enabled INTEGER NOT NULL DEFAULT 0 CHECK(thinking_enabled IN (0,1)),
  reasoning_effort TEXT CHECK(reasoning_effort IS NULL OR reasoning_effort IN ('high','max')),
  max_output_tokens INTEGER NOT NULL DEFAULT 4096 CHECK(max_output_tokens > 0),
  timeout_ms INTEGER NOT NULL DEFAULT 60000 CHECK(timeout_ms >= 1000),
  streaming INTEGER NOT NULL DEFAULT 1 CHECK(streaming IN (0,1)),
  is_builtin INTEGER NOT NULL DEFAULT 1 CHECK(is_builtin IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE translation_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  page_session_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('queued','running','paused','completed','partial','failed','cancelled')),
  mode TEXT NOT NULL CHECK(mode IN ('replace','below','bilingual')),
  target_language TEXT NOT NULL DEFAULT 'zh-CN',
  preset_id TEXT REFERENCES task_presets(id) ON DELETE SET NULL,
  model_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  glossary_version INTEGER NOT NULL DEFAULT 0,
  website_rule_version INTEGER NOT NULL DEFAULT 0,
  total_segments INTEGER NOT NULL DEFAULT 0,
  completed_segments INTEGER NOT NULL DEFAULT 0,
  failed_segments INTEGER NOT NULL DEFAULT 0,
  cancelled_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_translation_tasks_state_updated ON translation_tasks(state, updated_at DESC);
CREATE INDEX idx_translation_tasks_document ON translation_tasks(document_id, created_at DESC);

CREATE TABLE translation_task_segments (
  task_id TEXT NOT NULL REFERENCES translation_tasks(id) ON DELETE CASCADE,
  segment_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued','running','translated','failed','stale','cancelled')),
  translated_text TEXT,
  placeholder_json TEXT NOT NULL DEFAULT '[]',
  error_json TEXT,
  usage_json TEXT,
  ordinal INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(task_id, segment_id)
);
CREATE INDEX idx_translation_task_segments_state ON translation_task_segments(task_id, state, ordinal);

CREATE TABLE memory_sources (
  id TEXT PRIMARY KEY NOT NULL,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT,
  source_excerpt TEXT,
  source_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_memory_sources_memory ON memory_sources(memory_id);

CREATE TABLE memory_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  confidence REAL,
  state TEXT NOT NULL CHECK(state IN ('pending','confirmed','rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_memory_candidates_state ON memory_candidates(state, updated_at DESC);

CREATE TABLE pdf_documents (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('local','url')),
  source_uri TEXT NOT NULL,
  canonical_path TEXT,
  title TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0,
  has_text_layer INTEGER NOT NULL DEFAULT 0 CHECK(has_text_layer IN (0,1)),
  file_size_bytes INTEGER NOT NULL DEFAULT 0,
  last_page INTEGER NOT NULL DEFAULT 1,
  last_scale REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_pdf_documents_hash ON pdf_documents(file_hash);

CREATE TABLE pdf_pages (
  id TEXT PRIMARY KEY NOT NULL,
  pdf_document_id TEXT NOT NULL REFERENCES pdf_documents(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL CHECK(page_number > 0),
  width REAL NOT NULL,
  height REAL NOT NULL,
  text_hash TEXT,
  translation_state TEXT NOT NULL DEFAULT 'unseen' CHECK(translation_state IN ('unseen','queued','translated','partial','failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(pdf_document_id, page_number)
);

CREATE TABLE pdf_text_spans (
  id TEXT PRIMARY KEY NOT NULL,
  pdf_page_id TEXT NOT NULL REFERENCES pdf_pages(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  source_text TEXT NOT NULL,
  translated_text TEXT,
  bbox_json TEXT NOT NULL,
  style_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(pdf_page_id, ordinal)
);

CREATE TABLE ocr_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  pdf_page_id TEXT NOT NULL REFERENCES pdf_pages(id) ON DELETE CASCADE,
  engine TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'eng',
  state TEXT NOT NULL CHECK(state IN ('disabled','queued','running','completed','failed','cancelled')),
  result_json TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE api_profiles ADD COLUMN first_token_timeout_ms INTEGER NOT NULL DEFAULT 30000;
ALTER TABLE api_profiles ADD COLUMN total_timeout_ms INTEGER NOT NULL DEFAULT 120000;
ALTER TABLE api_profiles ADD COLUMN max_concurrency INTEGER NOT NULL DEFAULT 2;
ALTER TABLE api_profiles ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 2;
ALTER TABLE api_profiles ADD COLUMN max_page_segments INTEGER NOT NULL DEFAULT 160;
ALTER TABLE api_profiles ADD COLUMN max_page_characters INTEGER NOT NULL DEFAULT 96000;
ALTER TABLE api_profiles ADD COLUMN allow_insecure_loopback INTEGER NOT NULL DEFAULT 0 CHECK(allow_insecure_loopback IN (0,1));
ALTER TABLE api_profiles ADD COLUMN last_model_refresh_at TEXT;
ALTER TABLE api_profiles ADD COLUMN last_connection_status TEXT;

ALTER TABLE translation_cache ADD COLUMN target_language TEXT NOT NULL DEFAULT 'zh-CN';
ALTER TABLE translation_cache ADD COLUMN model_id TEXT NOT NULL DEFAULT '';
ALTER TABLE translation_cache ADD COLUMN prompt_version TEXT NOT NULL DEFAULT 'page-v1';
ALTER TABLE translation_cache ADD COLUMN domain_id TEXT;
ALTER TABLE translation_cache ADD COLUMN glossary_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE translation_cache ADD COLUMN translation_mode TEXT NOT NULL DEFAULT 'below';
ALTER TABLE translation_cache ADD COLUMN website_rule_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE translation_cache ADD COLUMN placeholder_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE translation_cache ADD COLUMN usage_json TEXT;
ALTER TABLE translation_cache ADD COLUMN hit_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE translation_cache ADD COLUMN source_scope TEXT;

ALTER TABLE website_rules ADD COLUMN url_pattern TEXT;
ALTER TABLE website_rules ADD COLUMN subdomain_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE website_rules ADD COLUMN force_content_selector TEXT;
ALTER TABLE website_rules ADD COLUMN translate_navigation INTEGER NOT NULL DEFAULT 0 CHECK(translate_navigation IN (0,1));
ALTER TABLE website_rules ADD COLUMN translate_buttons INTEGER NOT NULL DEFAULT 0 CHECK(translate_buttons IN (0,1));
ALTER TABLE website_rules ADD COLUMN translate_tables INTEGER NOT NULL DEFAULT 1 CHECK(translate_tables IN (0,1));
ALTER TABLE website_rules ADD COLUMN protect_link_text INTEGER NOT NULL DEFAULT 1 CHECK(protect_link_text IN (0,1));
ALTER TABLE website_rules ADD COLUMN auto_translate INTEGER NOT NULL DEFAULT 0 CHECK(auto_translate IN (0,1));
ALTER TABLE website_rules ADD COLUMN page_budget_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE website_rules ADD COLUMN pdf_strategy TEXT NOT NULL DEFAULT 'selection_only';
ALTER TABLE website_rules ADD COLUMN is_builtin INTEGER NOT NULL DEFAULT 0 CHECK(is_builtin IN (0,1));
ALTER TABLE website_rules ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE workspaces ADD COLUMN icon TEXT NOT NULL DEFAULT 'book-open';
ALTER TABLE workspaces ADD COLUMN deleted_at TEXT;

INSERT INTO schema_metadata(key, value, created_at, updated_at)
VALUES ('schema_version', '2', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT INTO task_presets(id, task, label, model_id, thinking_enabled, reasoning_effort, max_output_tokens, timeout_ms, streaming, is_builtin, created_at, updated_at) VALUES
('preset-whole-page', 'whole_page_translation', '整页翻译', 'deepseek-v4-flash', 0, NULL, 4096, 60000, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('preset-selected', 'selected_precise_translation', '选中精确翻译', 'deepseek-v4-pro', 0, NULL, 4096, 60000, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('preset-explain', 'explanation', '解释', 'deepseek-v4-pro', 1, 'high', 8192, 90000, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('preset-follow-up', 'deep_follow_up', '深度追问', 'deepseek-v4-pro', 1, 'max', 16384, 120000, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('preset-candidates', 'candidate_extraction', '候选术语提取', 'deepseek-v4-flash', 0, NULL, 4096, 60000, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('preset-summary', 'conversation_summary', '对话摘要', 'deepseek-v4-flash', 0, NULL, 4096, 60000, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('preset-memory', 'memory_extraction', '记忆提取', 'deepseek-v4-flash', 0, NULL, 4096, 60000, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

PRAGMA user_version = 2;
