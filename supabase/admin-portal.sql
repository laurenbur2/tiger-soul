-- ============================================================
-- Tiger Soul — admin portal schema
-- Run this once in the Supabase dashboard: SQL Editor → paste → Run.
-- ============================================================

-- One profile per client, keyed by email.
create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  first_name  text,
  last_name   text,
  email       text unique not null,
  phone       text,
  country     text,
  notes       text default '',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Signed Informed Consent & Liability Waivers.
create table if not exists public.waivers (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid references public.profiles(id) on delete cascade,
  full_name   text,
  email       text,
  phone       text,
  signature   text,          -- data:image/png;base64,... of the drawn signature
  date_signed text,
  signed_at   timestamptz,
  created_at  timestamptz default now()
);

-- Medical / health intake screenings.
create table if not exists public.screenings (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid references public.profiles(id) on delete cascade,
  full_name   text,
  email       text,
  phone       text,
  offering    text,
  answers     jsonb,         -- all screening answers (q5..q47) with their questions
  created_at  timestamptz default now()
);

create index if not exists waivers_profile_idx  on public.waivers(profile_id);
create index if not exists screenings_profile_idx on public.screenings(profile_id);

-- ---- Admin allowlist -------------------------------------------------------
-- Only these Google accounts can read the data once logged in.
create table if not exists public.admins ( email text primary key );

-- Admin accounts allowed into the portal (lower-case).
insert into public.admins (email) values
  ('tigersoulretreat@gmail.com'),
  ('lburandt2@gmail.com'),
  ('admin@tigersoulretreats.com')
on conflict do nothing;

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;
grant execute on function public.is_admin() to authenticated, anon;

-- ---- Row-level security: locked down, admins only ---------------------------
alter table public.profiles   enable row level security;
alter table public.waivers    enable row level security;
alter table public.screenings enable row level security;
alter table public.admins     enable row level security;

drop policy if exists "admins read profiles"   on public.profiles;
drop policy if exists "admins update profiles"  on public.profiles;
drop policy if exists "admins read waivers"     on public.waivers;
drop policy if exists "admins read screenings"  on public.screenings;

create policy "admins read profiles"  on public.profiles   for select using (public.is_admin());
create policy "admins update profiles" on public.profiles  for update using (public.is_admin()) with check (public.is_admin());
create policy "admins read waivers"    on public.waivers    for select using (public.is_admin());
create policy "admins read screenings" on public.screenings for select using (public.is_admin());

-- Base table privileges (RLS still restricts rows to admins). Edge Functions
-- write with the service_role key.
grant select, update, delete on public.profiles   to authenticated;
grant select, delete on public.waivers    to authenticated;
grant select, delete on public.screenings to authenticated;
grant all on public.profiles, public.waivers, public.screenings to service_role;

create policy "admins delete profiles"   on public.profiles   for delete using (public.is_admin());
create policy "admins delete waivers"    on public.waivers    for delete using (public.is_admin());
create policy "admins delete screenings" on public.screenings for delete using (public.is_admin());
-- (No policies on public.admins => not readable/writable by clients; manage it here in SQL.)
-- The Edge Functions write with the service_role key, which bypasses RLS.
