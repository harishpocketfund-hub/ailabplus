Use this prompt in Supabase AI SQL (or skip AI and run `supabase/schema.sql` directly):

```
Create a Postgres schema for a project-management app with two workstreams: marketing and development.

Requirements:

1) Enums
- workstream_type: marketing, development
- priority_type: Low, Medium, High
- task_status_type: To Do, In Progress, Review, Done
- member_source_type: internal, external
- commit_scope_type: project, task

2) Trigger helper
- Function set_updated_at() that sets NEW.updated_at = now()

3) Users table
- app_users:
  id text primary key
  email text unique (case-insensitive index on lower(email))
  name text
  title text default 'Member'
  reports_to text default 'Not assigned'
  password_hash text
  is_active boolean default true
  last_login_at timestamptz nullable
  created_at, updated_at timestamps
  trigger set_updated_at

4) Projects table
- projects:
  id text primary key
  workstream workstream_type
  name text
  start_date date
  deadline date nullable
  priority priority_type default 'Medium'
  is_completed boolean default false
  created_by text nullable references app_users(id)
  created_at, updated_at timestamps
  check deadline >= start_date when deadline is not null
  trigger set_updated_at
  indexes on workstream, deadline, priority

5) Tags
- workstream_tags:
  id uuid primary key default gen_random_uuid()
  workstream workstream_type
  name text
  created_at timestamp
  unique(workstream, lower(name))

- project_tags:
  project_id references projects(id) on delete cascade
  tag_id references workstream_tags(id) on delete cascade
  created_at timestamp
  primary key(project_id, tag_id)

6) Project members
- project_members:
  id text primary key
  project_id references projects(id) on delete cascade
  source member_source_type default 'internal'
  user_id text nullable references app_users(id) on delete set null
  name text
  hours_allocated numeric(10,2) default 0 and >= 0
  created_at, updated_at timestamps
  allow internal members with null user_id, but external must have user_id null
  unique(project_id, lower(name))
  trigger set_updated_at
  index on project_id

7) Tasks
- tasks:
  id text primary key
  project_id references projects(id) on delete cascade
  title text
  description text default ''
  due_date date
  status task_status_type default 'To Do'
  order_index integer default 0 and >= 0
  assignee text nullable (assignee name)
  hours_assigned numeric(10,2) default 0 and >= 0
  blocker_reason text default ''
  dependency_task_ids text[] default '{}'
  time_spent numeric(10,2) default 0 and >= 0
  priority priority_type default 'Medium'
  subtasks jsonb default [] and must be json array
  is_recurring boolean default false
  recurring_days text[] default '{}' and values limited to Mon..Sun
  recurring_time_per_occurrence_hours numeric(10,2) default 0 and >= 0
  recurring_completions jsonb default {} and must be json object
  created_on date nullable
  created_at, updated_at timestamps
  trigger set_updated_at
  indexes on (project_id, status, order_index), (project_id, due_date, status), (project_id, priority), (project_id, assignee)

8) Commit logs
- project_commit_logs:
  id text primary key
  project_id references projects(id) on delete cascade
  project_name text
  changed_by_user_id text nullable references app_users(id) on delete set null
  changed_by_name text
  scope commit_scope_type default 'project'
  action text default 'updated'
  task_id text nullable references tasks(id) on delete set null
  task_title text nullable
  field text
  from_value text default ''
  to_value text default ''
  changed_at timestamptz default now()
  changed_at_india text nullable
  created_at timestamptz default now()
  indexes on (project_id, changed_at desc), changed_by_name

9) User preferences
- user_preferences:
  id uuid primary key default gen_random_uuid()
  user_id text references app_users(id) on delete cascade
  namespace text
  context_id text nullable
  data jsonb default {} and must be object
  created_at, updated_at timestamps
  unique(user_id, namespace, coalesce(context_id, ''))
  trigger set_updated_at

10) Transitional sync table (for localStorage migration)
- workstream_state:
  workstream workstream_type primary key
  projects jsonb default [] and must be array
  tags jsonb default [] and must be array
  tasks_by_project jsonb default {} and must be object
  members_by_project jsonb default {} and must be object
  commit_logs jsonb default [] and must be array
  updated_by_user_id text nullable references app_users(id) on delete set null
  updated_at timestamptz default now()

Seed default rows:
- workstream_state rows for marketing and development
- marketing tags: Social Media, Paid Ads, Content, Branding, SEO, Email, Influencer, Analytics, Funnel, Strategy, Launch, Website
- development tags: Backend, Frontend, API, Database, DevOps, QA, Security, Performance, Refactor, Bugfix, Architecture, Mobile

Make all create statements idempotent using IF NOT EXISTS where possible.
```
