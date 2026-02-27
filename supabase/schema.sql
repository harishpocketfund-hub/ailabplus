-- Company System - Supabase Schema
-- Run this in Supabase SQL Editor.
-- This supports:
-- 1) secure login accounts
-- 2) normalized project/task/member data
-- 3) transitional synced snapshots from current localStorage app state

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'workstream_type') then
    create type public.workstream_type as enum ('marketing', 'development');
  end if;

  if not exists (select 1 from pg_type where typname = 'priority_type') then
    create type public.priority_type as enum ('Low', 'Medium', 'High');
  end if;

  if not exists (select 1 from pg_type where typname = 'task_status_type') then
    create type public.task_status_type as enum ('To Do', 'In Progress', 'Review', 'Done');
  end if;

  if not exists (select 1 from pg_type where typname = 'member_source_type') then
    create type public.member_source_type as enum ('internal', 'external');
  end if;

  if not exists (select 1 from pg_type where typname = 'commit_scope_type') then
    create type public.commit_scope_type as enum ('project', 'task');
  end if;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Login + user directory used by current custom auth flow.
create table if not exists public.app_users (
  id text primary key,
  email text not null,
  name text not null,
  title text not null default 'Member',
  reports_to text not null default 'Not assigned',
  password_hash text not null,
  is_active boolean not null default true,
  last_login_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_users_id_not_blank_chk check (length(trim(id)) > 0),
  constraint app_users_email_format_chk check (position('@' in email) > 1)
);

create unique index if not exists app_users_email_lower_uidx
  on public.app_users (lower(email));

create trigger trg_app_users_updated_at
before update on public.app_users
for each row execute function public.set_updated_at();

create table if not exists public.projects (
  id text primary key,
  workstream public.workstream_type not null,
  name text not null,
  start_date date not null,
  deadline date null,
  priority public.priority_type not null default 'Medium',
  is_completed boolean not null default false,
  created_by text null references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_id_not_blank_chk check (length(trim(id)) > 0),
  constraint projects_deadline_after_start_chk
    check (deadline is null or deadline >= start_date)
);

create index if not exists projects_workstream_idx on public.projects (workstream);
create index if not exists projects_deadline_idx on public.projects (deadline);
create index if not exists projects_priority_idx on public.projects (priority);

create trigger trg_projects_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

create table if not exists public.workstream_tags (
  id uuid primary key default gen_random_uuid(),
  workstream public.workstream_type not null,
  name text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists workstream_tags_name_uidx
  on public.workstream_tags (workstream, lower(name));

create table if not exists public.project_tags (
  project_id text not null references public.projects(id) on delete cascade,
  tag_id uuid not null references public.workstream_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, tag_id)
);

create table if not exists public.project_members (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  source public.member_source_type not null default 'internal',
  user_id text null references public.app_users(id) on delete set null,
  name text not null,
  hours_allocated numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_members_id_not_blank_chk check (length(trim(id)) > 0),
  constraint project_members_hours_non_negative_chk check (hours_allocated >= 0),
  constraint project_members_external_user_chk
    check (source <> 'external' or user_id is null)
);

create unique index if not exists project_members_project_name_uidx
  on public.project_members (project_id, lower(name));

create index if not exists project_members_project_idx
  on public.project_members (project_id);

create trigger trg_project_members_updated_at
before update on public.project_members
for each row execute function public.set_updated_at();

create table if not exists public.tasks (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  title text not null,
  description text not null default '',
  due_date date not null,
  status public.task_status_type not null default 'To Do',
  order_index integer not null default 0,
  assignee text null,
  hours_assigned numeric(10,2) not null default 0,
  blocker_reason text not null default '',
  dependency_task_ids text[] not null default '{}',
  time_spent numeric(10,2) not null default 0,
  priority public.priority_type not null default 'Medium',
  subtasks jsonb not null default '[]'::jsonb,
  is_recurring boolean not null default false,
  recurring_days text[] not null default '{}',
  recurring_time_per_occurrence_hours numeric(10,2) not null default 0,
  recurring_completions jsonb not null default '{}'::jsonb,
  created_on date null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_id_not_blank_chk check (length(trim(id)) > 0),
  constraint tasks_order_non_negative_chk check (order_index >= 0),
  constraint tasks_hours_assigned_non_negative_chk check (hours_assigned >= 0),
  constraint tasks_time_spent_non_negative_chk check (time_spent >= 0),
  constraint tasks_recurring_hours_non_negative_chk
    check (recurring_time_per_occurrence_hours >= 0),
  constraint tasks_recurring_days_chk
    check (recurring_days <@ array['Mon','Tue','Wed','Thu','Fri','Sat','Sun']),
  constraint tasks_subtasks_chk check (jsonb_typeof(subtasks) = 'array'),
  constraint tasks_recurring_completions_chk
    check (jsonb_typeof(recurring_completions) = 'object')
);

create index if not exists tasks_project_status_order_idx
  on public.tasks (project_id, status, order_index);
create index if not exists tasks_project_due_status_idx
  on public.tasks (project_id, due_date, status);
create index if not exists tasks_project_priority_idx
  on public.tasks (project_id, priority);
create index if not exists tasks_project_assignee_idx
  on public.tasks (project_id, assignee);

create trigger trg_tasks_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

create table if not exists public.project_commit_logs (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  project_name text not null,
  changed_by_user_id text null references public.app_users(id) on delete set null,
  changed_by_name text not null,
  scope public.commit_scope_type not null default 'project',
  action text not null default 'updated',
  task_id text null references public.tasks(id) on delete set null,
  task_title text null,
  field text not null,
  from_value text not null default '',
  to_value text not null default '',
  changed_at timestamptz not null default now(),
  changed_at_india text null,
  created_at timestamptz not null default now(),
  constraint project_commit_logs_id_not_blank_chk check (length(trim(id)) > 0)
);

create index if not exists project_commit_logs_project_changed_at_idx
  on public.project_commit_logs (project_id, changed_at desc);
create index if not exists project_commit_logs_changed_by_idx
  on public.project_commit_logs (changed_by_name);

create table if not exists public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.app_users(id) on delete cascade,
  namespace text not null,
  context_id text null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_preferences_data_object_chk check (jsonb_typeof(data) = 'object')
);

create unique index if not exists user_preferences_unique_idx
  on public.user_preferences (user_id, namespace, coalesce(context_id, ''));

create trigger trg_user_preferences_updated_at
before update on public.user_preferences
for each row execute function public.set_updated_at();

-- Transitional snapshot table used by current UI while localStorage is migrated.
create table if not exists public.workstream_state (
  workstream public.workstream_type primary key,
  projects jsonb not null default '[]'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  tasks_by_project jsonb not null default '{}'::jsonb,
  members_by_project jsonb not null default '{}'::jsonb,
  commit_logs jsonb not null default '[]'::jsonb,
  updated_by_user_id text null references public.app_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint workstream_state_projects_array_chk check (jsonb_typeof(projects) = 'array'),
  constraint workstream_state_tags_array_chk check (jsonb_typeof(tags) = 'array'),
  constraint workstream_state_tasks_object_chk
    check (jsonb_typeof(tasks_by_project) = 'object'),
  constraint workstream_state_members_object_chk
    check (jsonb_typeof(members_by_project) = 'object'),
  constraint workstream_state_commit_logs_array_chk
    check (jsonb_typeof(commit_logs) = 'array')
);

insert into public.workstream_state (workstream)
values ('marketing'), ('development')
on conflict (workstream) do nothing;

insert into public.workstream_tags (workstream, name)
values
  ('marketing', 'Social Media'),
  ('marketing', 'Paid Ads'),
  ('marketing', 'Content'),
  ('marketing', 'Branding'),
  ('marketing', 'SEO'),
  ('marketing', 'Email'),
  ('marketing', 'Influencer'),
  ('marketing', 'Analytics'),
  ('marketing', 'Funnel'),
  ('marketing', 'Strategy'),
  ('marketing', 'Launch'),
  ('marketing', 'Website'),
  ('development', 'Backend'),
  ('development', 'Frontend'),
  ('development', 'API'),
  ('development', 'Database'),
  ('development', 'DevOps'),
  ('development', 'QA'),
  ('development', 'Security'),
  ('development', 'Performance'),
  ('development', 'Refactor'),
  ('development', 'Bugfix'),
  ('development', 'Architecture'),
  ('development', 'Mobile')
on conflict do nothing;
