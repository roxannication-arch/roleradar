-- RoleRadar Supabase schema
-- Run this in Supabase SQL editor.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text not null default 'consultant' check (role in ('admin', 'consultant')),
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id text primary key,
  name text not null,
  resume text not null default '',
  resume_file_name text,
  resume_file_signature text,
  target_role text not null default '',
  location text not null default '',
  experience_years text not null default '3',
  candidate_level text not null default 'auto' check (candidate_level in ('auto', 'junior', 'middle', 'senior')),
  preferred_company_sizes text[] not null default array['startup', 'scaleup', 'enterprise'],
  last_analyzed_at date,
  consultant_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.resume_analysis (
  client_id text primary key references public.clients (id) on delete cascade,
  profile jsonb not null,
  source_fingerprint text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id text primary key,
  client_id text not null references public.clients (id) on delete cascade,
  title text not null,
  company text not null,
  location text not null default 'United States',
  url text not null,
  posted_at text,
  source_variant text not null default '',
  company_size text not null default 'unknown',
  hiring_contact_role text not null default '',
  evidence text not null default '',
  outreach_message text not null default '',
  fit_score integer not null default 0,
  fit_reason text not null default '',
  status text not null default 'Найдено',
  updated_at timestamptz not null default now()
);

create unique index if not exists jobs_client_id_url_key on public.jobs (client_id, url);
create index if not exists jobs_client_id_idx on public.jobs (client_id);

create table if not exists public.signals (
  id text primary key,
  client_id text not null references public.clients (id) on delete cascade,
  company text not null,
  trigger_type text not null check (trigger_type in ('funding', 'expansion', 'key_hire', 'contract')),
  priority text not null check (priority in ('hot', 'warm', 'cold')),
  hiring_manager text not null default '',
  evidence text not null default '',
  source_url text not null,
  outreach_message text not null default '',
  status text not null default 'Найдено',
  updated_at timestamptz not null default now()
);

create unique index if not exists signals_client_unique_key
  on public.signals (client_id, company, trigger_type, source_url);
create index if not exists signals_client_id_idx on public.signals (client_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at
before update on public.jobs
for each row execute function public.set_updated_at();

drop trigger if exists signals_set_updated_at on public.signals;
create trigger signals_set_updated_at
before update on public.signals
for each row execute function public.set_updated_at();

drop trigger if exists resume_analysis_set_updated_at on public.resume_analysis;
create trigger resume_analysis_set_updated_at
before update on public.resume_analysis
for each row execute function public.set_updated_at();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.current_user_role()
returns text
language sql
stable
as $$
  select role from public.profiles where id = auth.uid()
$$;

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.resume_analysis enable row level security;
alter table public.jobs enable row level security;
alter table public.signals enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
for select using (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
for insert with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
for update using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists clients_select_policy on public.clients;
create policy clients_select_policy on public.clients
for select using (
  public.current_user_role() = 'admin' or consultant_id = auth.uid()
);

drop policy if exists clients_insert_policy on public.clients;
create policy clients_insert_policy on public.clients
for insert with check (
  public.current_user_role() = 'admin' or consultant_id = auth.uid()
);

drop policy if exists clients_update_policy on public.clients;
create policy clients_update_policy on public.clients
for update using (
  public.current_user_role() = 'admin' or consultant_id = auth.uid()
)
with check (
  public.current_user_role() = 'admin' or consultant_id = auth.uid()
);

drop policy if exists clients_delete_policy on public.clients;
create policy clients_delete_policy on public.clients
for delete using (
  public.current_user_role() = 'admin' or consultant_id = auth.uid()
);

drop policy if exists resume_analysis_select_policy on public.resume_analysis;
create policy resume_analysis_select_policy on public.resume_analysis
for select using (
  exists (
    select 1 from public.clients c
    where c.id = resume_analysis.client_id
      and (public.current_user_role() = 'admin' or c.consultant_id = auth.uid())
  )
);

drop policy if exists resume_analysis_upsert_policy on public.resume_analysis;
create policy resume_analysis_upsert_policy on public.resume_analysis
for all using (
  exists (
    select 1 from public.clients c
    where c.id = resume_analysis.client_id
      and (public.current_user_role() = 'admin' or c.consultant_id = auth.uid())
  )
)
with check (
  exists (
    select 1 from public.clients c
    where c.id = resume_analysis.client_id
      and (public.current_user_role() = 'admin' or c.consultant_id = auth.uid())
  )
);

drop policy if exists jobs_access_policy on public.jobs;
create policy jobs_access_policy on public.jobs
for all using (
  exists (
    select 1 from public.clients c
    where c.id = jobs.client_id
      and (public.current_user_role() = 'admin' or c.consultant_id = auth.uid())
  )
)
with check (
  exists (
    select 1 from public.clients c
    where c.id = jobs.client_id
      and (public.current_user_role() = 'admin' or c.consultant_id = auth.uid())
  )
);

drop policy if exists signals_access_policy on public.signals;
create policy signals_access_policy on public.signals
for all using (
  exists (
    select 1 from public.clients c
    where c.id = signals.client_id
      and (public.current_user_role() = 'admin' or c.consultant_id = auth.uid())
  )
)
with check (
  exists (
    select 1 from public.clients c
    where c.id = signals.client_id
      and (public.current_user_role() = 'admin' or c.consultant_id = auth.uid())
  )
);
