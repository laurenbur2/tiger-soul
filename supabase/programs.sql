-- ============================================================
-- Tiger Soul — program dates & enrollment details (admin portal)
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- Safe to re-run.
-- ============================================================

-- Dates a program runs. One row per cohort / retreat window.
create table if not exists public.program_sessions (
  id          uuid primary key default gen_random_uuid(),
  program     text not null,          -- must match the program names in the admin portal
  label       text,                   -- optional, e.g. "Cohort 2"
  starts_on   date,
  ends_on     date,
  location    text,
  created_at  timestamptz default now()
);

-- One row per person per program: their dates, room, and payment plan.
create table if not exists public.program_enrollments (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  program        text not null,
  session_id     uuid references public.program_sessions(id) on delete set null,
  accommodation  text check (accommodation in ('shared','private')),
  payment_plan   text,                -- free text, e.g. "3 × $1,500 monthly"
  payment_link   text,                -- Stripe / payment page URL
  payment_status text check (payment_status in ('unpaid','deposit','paying','paid')),
  status         text not null default 'enrolled' check (status in ('enrolled','removed')),
  notes          text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  unique (profile_id, program)
);

create index if not exists program_sessions_prog_idx on public.program_sessions(program);
create index if not exists program_enrollments_prog_idx on public.program_enrollments(program);
create index if not exists program_enrollments_profile_idx on public.program_enrollments(profile_id);

-- Added later: lets an admin take someone off a program without losing their record.
alter table public.program_enrollments add column if not exists status text not null default 'enrolled';

-- ---- Admins only ------------------------------------------------------------
alter table public.program_sessions    enable row level security;
alter table public.program_enrollments enable row level security;

drop policy if exists "admins all program_sessions"    on public.program_sessions;
drop policy if exists "admins all program_enrollments" on public.program_enrollments;

create policy "admins all program_sessions" on public.program_sessions
  for all using (public.is_admin()) with check (public.is_admin());
create policy "admins all program_enrollments" on public.program_enrollments
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.program_sessions    to authenticated;
grant select, insert, update, delete on public.program_enrollments to authenticated;
grant all on public.program_sessions, public.program_enrollments to service_role;

-- Done. Reload the admin portal: program cards now show dates and open a roster.
