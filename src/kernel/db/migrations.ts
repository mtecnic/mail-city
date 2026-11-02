/**
 * Hand-written, forward-only SQL migrations. Each entry runs once inside a
 * transaction; the applied version is tracked in `schema_migrations`.
 *
 * FTS5 and sqlite-vec virtual tables can't be expressed in drizzle, which is
 * why we keep migrations as SQL instead of generating them with drizzle-kit.
 */
export interface Migration {
  version: number
  name: string
  sql: string
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  imap_host TEXT NOT NULL,
  imap_port INTEGER NOT NULL,
  imap_tls TEXT NOT NULL,
  smtp_host TEXT NOT NULL,
  smtp_port INTEGER NOT NULL,
  smtp_tls TEXT NOT NULL,
  auth_type TEXT NOT NULL,
  oauth_provider TEXT,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  sync_settings TEXT NOT NULL DEFAULT '{}',
  last_sync_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE secrets (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  expires_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, kind)
);

CREATE TABLE identities (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  signature_id TEXT,
  reply_to TEXT,
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  delimiter TEXT,
  special_use TEXT,
  uid_validity INTEGER,
  uid_next INTEGER,
  highest_mod_seq TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  subscribed INTEGER NOT NULL DEFAULT 1,
  sync_enabled INTEGER NOT NULL DEFAULT 1,
  last_sync_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX folders_account_path ON folders(account_id, path);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  uid INTEGER NOT NULL,
  message_id TEXT,
  thread_id TEXT,
  gm_thread_id TEXT,
  in_reply_to TEXT,
  references_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT '',
  from_addr TEXT NOT NULL DEFAULT '',
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  bcc_json TEXT NOT NULL DEFAULT '[]',
  reply_to_json TEXT NOT NULL DEFAULT '[]',
  date TEXT NOT NULL,
  internal_date TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  flags_json TEXT NOT NULL,
  labels_json TEXT NOT NULL DEFAULT '[]',
  snippet TEXT NOT NULL DEFAULT '',
  has_attachments INTEGER NOT NULL DEFAULT 0,
  body_state TEXT NOT NULL DEFAULT 'headers',
  list_unsubscribe TEXT,
  list_id TEXT,
  ai_category TEXT,
  ai_priority INTEGER,
  ai_summary TEXT,
  index_state TEXT NOT NULL DEFAULT 'none',
  snoozed_until TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX messages_account_folder_uid ON messages(account_id, folder_id, uid);
CREATE INDEX messages_thread ON messages(thread_id);
CREATE INDEX messages_date ON messages(date);
CREATE INDEX messages_folder_date ON messages(folder_id, date);
CREATE INDEX messages_message_id ON messages(message_id);

CREATE TABLE message_bodies (
  message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  text_plain TEXT,
  text_html TEXT,
  raw_path TEXT,
  headers_json TEXT,
  fetched_at TEXT NOT NULL
);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  part TEXT,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  content_id TEXT,
  is_inline INTEGER NOT NULL DEFAULT 0,
  local_path TEXT
);
CREATE INDEX attachments_message ON attachments(message_id);

CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  subject_normalized TEXT NOT NULL,
  last_date TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  unread_count INTEGER NOT NULL DEFAULT 0,
  participants_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX threads_account_date ON threads(account_id, last_date);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  emails_json TEXT NOT NULL,
  primary_email TEXT NOT NULL UNIQUE,
  last_seen_at TEXT,
  send_count INTEGER NOT NULL DEFAULT 0,
  receive_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'harvested',
  notes TEXT,
  avatar_path TEXT
);

CREATE TABLE signatures (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  html TEXT NOT NULL,
  text TEXT NOT NULL
);

CREATE TABLE rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  account_ids_json TEXT NOT NULL DEFAULT '[]',
  conditions_json TEXT NOT NULL,
  actions_json TEXT NOT NULL,
  stop_processing INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  identity_id TEXT,
  mime_path TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  scheduled_at TEXT,
  undo_until TEXT,
  in_reply_to_message_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE pending_ops (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX pending_ops_account ON pending_ops(account_id, created_at);

CREATE TABLE sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  folder_path TEXT,
  kind TEXT NOT NULL,
  ok INTEGER NOT NULL,
  detail TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE ai_runs (
  id TEXT PRIMARY KEY,
  feature TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd TEXT,
  duration_ms INTEGER,
  message_ids_json TEXT NOT NULL DEFAULT '[]',
  ok INTEGER NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`
  },
  {
    version: 2,
    name: 'fts',
    sql: `
CREATE VIRTUAL TABLE messages_fts USING fts5(
  message_id UNINDEXED,
  subject,
  from_text,
  to_text,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
`
  },
  {
    version: 3,
    name: 'drafts_outbox',
    sql: `
CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  identity_id TEXT,
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  bcc_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  html TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  attachments_json TEXT NOT NULL DEFAULT '[]',
  in_reply_to_message_id TEXT,
  reply_mode TEXT,
  server_folder_id TEXT,
  server_uid INTEGER,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX drafts_account ON drafts(account_id, updated_at);
ALTER TABLE outbox ADD COLUMN draft_json TEXT;
ALTER TABLE outbox ADD COLUMN reply_mode TEXT;
`
  },
  {
    version: 4,
    name: 'ai_sessions',
    sql: `
CREATE TABLE ai_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  transcript_json TEXT NOT NULL DEFAULT '[]',
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE vector_index_state (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
ALTER TABLE messages ADD COLUMN ai_extract_json TEXT;
`
  }
]
