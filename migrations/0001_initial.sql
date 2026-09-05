PRAGMA foreign_keys = ON;

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  primary_domain TEXT,
  secondary_domains_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  default_model_profile_id TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY NOT NULL,
  url TEXT NOT NULL,
  canonical_url TEXT,
  title TEXT NOT NULL,
  site_domain TEXT NOT NULL,
  content_hash TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  last_read_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_documents_canonical_url ON documents(canonical_url) WHERE canonical_url IS NOT NULL;

CREATE TABLE workspace_documents (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  reading_progress REAL NOT NULL DEFAULT 0 CHECK(reading_progress >= 0 AND reading_progress <= 1),
  added_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, document_id)
);

CREATE TABLE document_sections (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES document_sections(id) ON DELETE CASCADE,
  heading TEXT NOT NULL,
  section_path TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  source_text TEXT NOT NULL,
  content_hash TEXT NOT NULL
);
CREATE INDEX idx_document_sections_document ON document_sections(document_id, ordinal);

CREATE TABLE page_segments (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  section_id TEXT REFERENCES document_sections(id) ON DELETE SET NULL,
  dom_locator TEXT NOT NULL,
  fallback_locator TEXT,
  source_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  segment_kind TEXT NOT NULL,
  section_path TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('unseen','queued','translating','translated','failed','stale','ignored')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_page_segments_document_state ON page_segments(document_id, state);

CREATE TABLE page_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  segment_id TEXT REFERENCES page_segments(id) ON DELETE CASCADE,
  snapshot_json TEXT NOT NULL,
  settings_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE translations (
  id TEXT PRIMARY KEY NOT NULL,
  segment_id TEXT NOT NULL REFERENCES page_segments(id) ON DELETE CASCADE,
  source_hash TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  model_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  glossary_hash TEXT NOT NULL,
  validation_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_translations_segment ON translations(segment_id, created_at DESC);

CREATE TABLE translation_cache (
  cache_key TEXT PRIMARY KEY NOT NULL,
  source_hash TEXT NOT NULL,
  context_hash TEXT NOT NULL,
  glossary_hash TEXT NOT NULL,
  model_profile_hash TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE translation_corrections (
  id TEXT PRIMARY KEY NOT NULL,
  translation_id TEXT REFERENCES translations(id) ON DELETE SET NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  source_text TEXT NOT NULL,
  previous_translation TEXT NOT NULL,
  corrected_translation TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_conversations_workspace_updated ON conversations(workspace_id, updated_at DESC);

CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('system','user','assistant','tool')),
  content TEXT NOT NULL,
  tool_name TEXT,
  tool_call_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_messages_conversation_created ON conversation_messages(conversation_id, created_at);

CREATE TABLE conversation_summaries (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  first_message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  last_message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE message_sources (
  id TEXT PRIMARY KEY NOT NULL,
  message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  section_id TEXT REFERENCES document_sections(id) ON DELETE SET NULL,
  source_title TEXT NOT NULL,
  source_excerpt TEXT NOT NULL,
  anchor_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE memories (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('automatic_summary','confirmed_long_term')),
  content TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  confirmed_at TEXT,
  is_cross_workspace INTEGER NOT NULL DEFAULT 0 CHECK(is_cross_workspace IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  section_id TEXT REFERENCES document_sections(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  source_excerpt TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE glossary_domains (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  parent_id TEXT REFERENCES glossary_domains(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('top_level','tag')),
  created_at TEXT NOT NULL
);

CREATE TABLE glossary_entries (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  domain_id TEXT REFERENCES glossary_domains(id) ON DELETE SET NULL,
  source_term TEXT NOT NULL,
  target_term TEXT,
  strategy TEXT NOT NULL CHECK(strategy IN ('never_translate','fixed','polysemous','first_with_source','always_with_source','page_temporary')),
  scope TEXT NOT NULL,
  source TEXT NOT NULL,
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_glossary_entries_term_scope ON glossary_entries(source_term, scope);

CREATE TABLE glossary_senses (
  id TEXT PRIMARY KEY NOT NULL,
  entry_id TEXT NOT NULL REFERENCES glossary_entries(id) ON DELETE CASCADE,
  condition_text TEXT NOT NULL,
  domain_id TEXT REFERENCES glossary_domains(id) ON DELETE SET NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  target_term TEXT NOT NULL,
  show_source TEXT NOT NULL CHECK(show_source IN ('never','first','always')),
  positive_examples_json TEXT NOT NULL DEFAULT '[]',
  negative_examples_json TEXT NOT NULL DEFAULT '[]',
  ordinal INTEGER NOT NULL
);

CREATE TABLE candidate_terms (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  source_term TEXT NOT NULL,
  suggested_translation TEXT,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  inferred_domain_id TEXT REFERENCES glossary_domains(id) ON DELETE SET NULL,
  confidence REAL,
  example_text TEXT,
  state TEXT NOT NULL CHECK(state IN ('pending','accepted','ignored','merged')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE website_rules (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  domain_pattern TEXT NOT NULL,
  path_pattern TEXT,
  default_mode TEXT,
  primary_domain_id TEXT REFERENCES glossary_domains(id) ON DELETE SET NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  dynamic_strategy TEXT NOT NULL DEFAULT 'observe',
  translate_new_content INTEGER NOT NULL DEFAULT 0 CHECK(translate_new_content IN (0,1)),
  toolbar_position TEXT NOT NULL DEFAULT 'top',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE ignored_selectors (
  id TEXT PRIMARY KEY NOT NULL,
  website_rule_id TEXT NOT NULL REFERENCES website_rules(id) ON DELETE CASCADE,
  selector TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('ignore','force')),
  created_at TEXT NOT NULL,
  UNIQUE(website_rule_id, selector, mode)
);

CREATE TABLE model_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  task TEXT NOT NULL,
  model_id TEXT NOT NULL,
  thinking_mode TEXT NOT NULL CHECK(thinking_mode IN ('disabled','high','max')),
  parameters_json TEXT NOT NULL DEFAULT '{}',
  is_builtin INTEGER NOT NULL DEFAULT 0 CHECK(is_builtin IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE api_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  encrypted_api_key BLOB,
  proxy_url TEXT,
  request_timeout_ms INTEGER NOT NULL DEFAULT 60000,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  scope TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE search_fts USING fts5(
  entity_id UNINDEXED,
  kind UNINDEXED,
  title,
  body,
  source,
  tokenize = 'unicode61 remove_diacritics 2'
);

PRAGMA user_version = 1;

