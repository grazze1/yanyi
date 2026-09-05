PRAGMA foreign_keys = ON;

-- =============================================================================
-- 1. Site-scoped active conversations
--
-- A reading session belongs to a website, not to a single selection. Each URL
-- origin (scheme + host + port) keeps one active conversation so repeated
-- "询问研译" actions append to the same thread. A new conversation is created
-- only when the user explicitly asks for one.
-- =============================================================================

ALTER TABLE conversations ADD COLUMN site_origin TEXT;
ALTER TABLE conversations ADD COLUMN last_page_url TEXT;
ALTER TABLE conversations ADD COLUMN last_page_title TEXT;

CREATE INDEX idx_conversations_site_origin
  ON conversations(site_origin, status, last_message_at DESC);

-- One active conversation per site origin. Rows are replaced when the user
-- starts a new chat or opens a historical conversation for that origin.
CREATE TABLE site_active_conversations (
  site_origin TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  knowledge_mode TEXT NOT NULL DEFAULT 'hybrid'
    CHECK(knowledge_mode IN ('hybrid','page_only','general')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_site_active_conversations_conversation
  ON site_active_conversations(conversation_id);

-- Each message keeps the page context it was actually asked from, so continuing a
-- conversation across pages of the same origin never reuses stale page context.
ALTER TABLE message_contexts ADD COLUMN page_url TEXT;
ALTER TABLE message_contexts ADD COLUMN page_title TEXT;
ALTER TABLE message_contexts ADD COLUMN site_origin TEXT;
CREATE INDEX idx_message_contexts_site ON message_contexts(site_origin, created_at DESC);

-- =============================================================================
-- 2. Global memory
--
-- Distinct from the glossary (how a term is translated) and from workspaces
-- (which documents belong to a project). Global memory holds who the user is,
-- what they prefer, and how they want answers written. Existing rows in
-- `memories` are workspace/conversation derived and stay untouched; typed global
-- entries live in `global_memories`.
-- =============================================================================

CREATE TABLE global_memories (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK(type IN (
    'profile','preference','response_style','domain_background',
    'translation_preference','personal_context','custom'
  )),
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  -- Case/whitespace-folded copy used for duplicate detection and retrieval.
  normalized_content TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
  priority INTEGER NOT NULL DEFAULT 0 CHECK(priority BETWEEN -100 AND 100),
  source_type TEXT NOT NULL DEFAULT 'manual'
    CHECK(source_type IN ('manual','import','conversation','candidate')),
  source_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0 CHECK(usage_count >= 0)
);
CREATE UNIQUE INDEX idx_global_memories_normalized
  ON global_memories(type, normalized_content);
CREATE INDEX idx_global_memories_active
  ON global_memories(enabled, pinned DESC, priority DESC, updated_at DESC);

CREATE TABLE global_memory_tags (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE global_memory_tag_links (
  memory_id TEXT NOT NULL REFERENCES global_memories(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES global_memory_tags(id) ON DELETE CASCADE,
  PRIMARY KEY(memory_id, tag_id)
);
CREATE INDEX idx_global_memory_tag_links_tag ON global_memory_tag_links(tag_id);

-- FTS5 index over enabled memory text. Kept in sync by triggers so retrieval
-- never has to scan the whole table.
CREATE VIRTUAL TABLE global_memories_fts USING fts5(
  title,
  content,
  tokenize = 'unicode61 remove_diacritics 2',
  content = 'global_memories',
  content_rowid = 'rowid'
);

CREATE TRIGGER trg_global_memories_fts_insert AFTER INSERT ON global_memories BEGIN
  INSERT INTO global_memories_fts(rowid,title,content)
  VALUES(NEW.rowid,NEW.title,NEW.content);
END;
CREATE TRIGGER trg_global_memories_fts_delete AFTER DELETE ON global_memories BEGIN
  INSERT INTO global_memories_fts(global_memories_fts,rowid,title,content)
  VALUES('delete',OLD.rowid,OLD.title,OLD.content);
END;
CREATE TRIGGER trg_global_memories_fts_update AFTER UPDATE ON global_memories BEGIN
  INSERT INTO global_memories_fts(global_memories_fts,rowid,title,content)
  VALUES('delete',OLD.rowid,OLD.title,OLD.content);
  INSERT INTO global_memories_fts(rowid,title,content)
  VALUES(NEW.rowid,NEW.title,NEW.content);
END;

-- Imported files become reviewable candidates. Nothing is written to
-- global_memories until the user confirms.
CREATE TABLE global_memory_import_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  source_name TEXT NOT NULL,
  source_format TEXT NOT NULL CHECK(source_format IN ('txt','md','json')),
  source_bytes INTEGER NOT NULL CHECK(source_bytes >= 0),
  state TEXT NOT NULL DEFAULT 'pending_review'
    CHECK(state IN ('pending_review','applied','discarded','failed')),
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK(candidate_count >= 0),
  accepted_count INTEGER NOT NULL DEFAULT 0 CHECK(accepted_count >= 0),
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_global_memory_import_jobs_state
  ON global_memory_import_jobs(state, updated_at DESC);

CREATE TABLE global_memory_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES global_memory_import_jobs(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN (
    'profile','preference','response_style','domain_background',
    'translation_preference','personal_context','custom'
  )),
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  normalized_content TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK(state IN ('pending','accepted','rejected','duplicate')),
  -- Set when the candidate looks like a strict terminology rule that belongs in
  -- the glossary instead of global memory.
  glossary_hint INTEGER NOT NULL DEFAULT 0 CHECK(glossary_hint IN (0,1)),
  memory_id TEXT REFERENCES global_memories(id) ON DELETE SET NULL,
  ordinal INTEGER NOT NULL DEFAULT 0 CHECK(ordinal >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_global_memory_candidates_job
  ON global_memory_candidates(job_id, state, ordinal);

-- =============================================================================
-- 3. Stable prompt prefix snapshot
--
-- Provider prefix caches only help when the stable part of the prompt is byte
-- identical between requests. The snapshot is versioned and regenerated only
-- when the underlying memories change, never per request, so no timestamp or
-- random id can leak into the cached prefix.
-- =============================================================================

CREATE TABLE global_memory_snapshots (
  version INTEGER PRIMARY KEY NOT NULL CHECK(version >= 1),
  fingerprint TEXT NOT NULL,
  stable_profile TEXT NOT NULL DEFAULT '',
  stable_preferences TEXT NOT NULL DEFAULT '',
  stable_response_style TEXT NOT NULL DEFAULT '',
  memory_count INTEGER NOT NULL DEFAULT 0 CHECK(memory_count >= 0),
  -- Exactly one row is current. History is retained so a version number is never
  -- reused after an edit, which keeps local prompt fingerprints unambiguous.
  is_current INTEGER NOT NULL DEFAULT 0 CHECK(is_current IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_global_memory_snapshots_fingerprint
  ON global_memory_snapshots(fingerprint);
CREATE UNIQUE INDEX idx_global_memory_snapshots_current
  ON global_memory_snapshots(is_current) WHERE is_current=1;

INSERT INTO schema_metadata(key,value,created_at,updated_at) VALUES
('schema_version','5',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(key) DO UPDATE SET value='5',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');

PRAGMA user_version = 5;
