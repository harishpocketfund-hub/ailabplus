-- Optional: run this only if you previously created an older schema version
-- and want a clean rebuild.

drop table if exists public.workstream_state cascade;
drop table if exists public.user_preferences cascade;
drop table if exists public.project_commit_logs cascade;
drop table if exists public.tasks cascade;
drop table if exists public.project_members cascade;
drop table if exists public.project_tags cascade;
drop table if exists public.workstream_tags cascade;
drop table if exists public.projects cascade;
drop table if exists public.app_users cascade;

drop function if exists public.set_updated_at cascade;

drop type if exists public.commit_scope_type cascade;
drop type if exists public.member_source_type cascade;
drop type if exists public.task_status_type cascade;
drop type if exists public.priority_type cascade;
drop type if exists public.workstream_type cascade;
