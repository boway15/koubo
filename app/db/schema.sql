-- M0 骨架：核心表
-- 设计原则：加租户只需插一行 org；加供应商只需插一行 model
--
-- 本文件可重复执行（全部 if not exists / on conflict），迁移不需要版本表。

create extension if not exists "pgcrypto";

-- ---------- 组织（V1 只有一行） ----------
create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- ---------- 项目 ----------
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  mode text not null default 'script' check (mode in ('script','edit')),
  title text not null,
  platform text not null default '抖音',
  language text not null default 'zh',
  duration_sec int not null default 60,
  status text not null default 'draft',
  pipeline_json jsonb not null,
  steps_json jsonb not null default '[]'::jsonb,
  stale_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_org_created on projects (org_id, created_at desc);

-- ---------- 统一产物表（kind 由管线模板定义） ----------
-- id 用 text 而不是 uuid：产物 id 是「项目:类型:版本」的确定性组合，
-- 这样重复写入天然幂等，不用额外查重。
create table if not exists artifacts (
  id text primary key,
  org_id uuid not null references orgs(id),
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null,
  version int not null default 1,
  storage_key text not null,        -- {org_id}/{project_id}/{kind}/v{version}.json
  content_json jsonb,               -- 小产物走 DB 快路径
  content_text text,
  mime text,
  bytes bigint,
  input_hash text not null,
  meta_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  unique (project_id, kind, version)
);
create index if not exists artifacts_latest on artifacts (project_id, kind) where superseded_at is null;
create index if not exists artifacts_hash on artifacts (input_hash);

-- ---------- 任务（含 runner：server | desktop） ----------
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  project_id uuid not null references projects(id) on delete cascade,
  step_id text not null,
  status text not null default 'queued',   -- queued|running|done|failed|stale
  runner text not null default 'server' check (runner in ('server','desktop')),
  input_hash text,
  attempt int not null default 1,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  heartbeat_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists jobs_pick on jobs (status, runner, created_at) where status = 'queued';

-- ---------- 事件流（SSE 重放） ----------
-- seq 用 bigserial：全局单调递增，天然可作为「since」游标，
-- 不需要给每个项目单独维护计数器（也就没有并发写 seq 的竞争）。
create table if not exists job_events (
  seq bigserial primary key,
  org_id uuid not null references orgs(id),
  project_id uuid not null references projects(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists job_events_project on job_events (project_id, seq);

-- ---------- 供应商（数据驱动，不写进代码） ----------
create table if not exists providers (
  id text primary key,
  kind text not null check (kind in ('direct','relay','local')),
  display_name text not null,
  base_url text,
  auth_kind text,
  is_enabled boolean not null default true,
  reliability numeric(3,2) not null default 0.95,
  avg_latency_ms int,
  notes text
);

create table if not exists provider_models (
  id text primary key,
  provider_id text not null references providers(id),
  model_ref text not null,
  kind text not null,               -- text|vision|image|video|tts|asr
  capabilities jsonb not null default '{}'::jsonb,
  unit_price numeric(10,4),
  unit_name text,
  quality_tier int default 2,
  is_enabled boolean not null default true,
  deprecated_at timestamptz
);

-- ---------- 供应商调用记录（成本归因） ----------
create table if not exists provider_calls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  project_id uuid references projects(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  provider text not null,
  model text not null,
  kind text not null,
  units numeric(12,4),
  unit_name text,
  unit_price numeric(10,4),
  cost numeric(12,6),
  latency_ms int,
  cached_hit boolean not null default false,
  ok boolean not null default true,
  error_code text,
  created_at timestamptz not null default now()
);
create index if not exists provider_calls_project on provider_calls (project_id);

-- ---------- 质检报告 ----------
create table if not exists qc_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  project_id uuid not null references projects(id) on delete cascade,
  checks_json jsonb not null,
  score numeric(4,2),
  verdict text not null,            -- pass|warn|fail
  override_reason text,
  override_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- 客户交付 ----------
create table if not exists deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  project_id uuid not null references projects(id) on delete cascade,
  token text unique not null,
  snapshot_json jsonb not null,     -- 锁定的产物 ID 清单，不是“最新”指针
  expires_at timestamptz not null,
  revoked_at timestamptz,
  decision text,                    -- approve|request_changes
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists client_comments (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references deliveries(id) on delete cascade,
  cue_index int,
  timecode_ms int,
  author_name text,
  body text not null,
  resolved_step text,
  created_at timestamptz not null default now()
);

-- ---------- 种子数据：一个 org + 默认供应商 ----------
insert into orgs (id, name)
values ('00000000-0000-0000-0000-000000000001', '工作室')
on conflict (id) do nothing;

insert into providers (id, kind, display_name, base_url, auth_kind) values
  ('deepseek', 'direct', 'DeepSeek',      'https://api.deepseek.com',                 'bearer'),
  ('ark',      'direct', '即梦 / 方舟',   'https://ark.cn-beijing.volces.com/api/v3', 'bearer'),
  ('kling',    'direct', '可灵',          'https://api-beijing.klingai.com',          'jwt'),
  ('hailuo',   'direct', '海螺 h3',       'https://api.minimax.chat',                 'bearer'),
  ('volc_tts', 'direct', '火山语音合成',  'https://openspeech.bytedance.com',         'bearer'),
  ('kie',      'relay',  'kie 中转',      'https://api.kie.ai',                       'bearer'),
  ('local',    'local',  '本地兜底',      null,                                        null)
on conflict (id) do nothing;
