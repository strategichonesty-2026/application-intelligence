'use strict';
// Tables for the Personal Intelligence Hub importer. Created ONLY in the local database the importer is
// pointed at (after the local-only guard passes). The console's own startup schema (store.initSchema) does not know about them.
const DDL = `
create table if not exists pih_imports (
  id bigserial primary key,
  platform text,
  file_name text not null,
  file_sha256 text not null,
  file_bytes bigint not null default 0,
  status text not null default 'running' check (status in ('running','done','partial','failed')),
  found int not null default 0,
  added int not null default 0,
  updated int not null default 0,
  skipped int not null default 0,
  failed int not null default 0,
  messages_added int not null default 0,
  characters bigint not null default 0,
  stats jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists pih_imports_sha_idx on pih_imports (file_sha256);

create table if not exists pih_conversations (
  id bigserial primary key,
  platform text not null check (platform in ('chatgpt','claude')),
  external_id text not null,
  id_synthetic boolean not null default false,
  title text not null default '',
  created_at_src timestamptz,
  updated_at_src timestamptz,
  import_id bigint not null references pih_imports(id),
  message_count int not null default 0,
  raw_text text not null,
  raw_sha256 text not null,
  imported_at timestamptz not null default now(),
  unique (platform, external_id)
);

create table if not exists pih_conversation_history (
  id bigserial primary key,
  conversation_id bigint not null references pih_conversations(id) on delete cascade,
  import_id bigint not null,
  title text not null default '',
  raw_text text not null,
  raw_sha256 text not null,
  replaced_at timestamptz not null default now()
);

create table if not exists pih_messages (
  id bigserial primary key,
  conversation_id bigint not null references pih_conversations(id) on delete cascade,
  position int,
  source_id text,
  role text not null,
  text text not null default '',
  created_at_src timestamptz,
  active_branch boolean not null default true,
  hidden boolean not null default false,
  content_type text,
  has_attachment boolean not null default false,
  unreadable boolean not null default false
);
create index if not exists pih_messages_conv_idx on pih_messages (conversation_id, position);
`;

async function ensureSchema(client) { await client.query(DDL); }

module.exports = { ensureSchema, DDL, TABLES: ['pih_imports', 'pih_conversations', 'pih_conversation_history', 'pih_messages'] };
