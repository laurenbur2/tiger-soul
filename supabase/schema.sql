-- ============================================================
--  TIGER SOUL — MEMBER PORTAL DATABASE SCHEMA
--  Paste this whole file into: Supabase → SQL Editor → New query → Run
--  Safe to re-run: it drops & recreates policies and uses IF NOT EXISTS.
-- ============================================================

-- Allow functions to reference tables created later in this same script.
set check_function_bodies = off;

-- ---------- Helper: is the current user an admin? ----------
-- (security definer so it can read profiles without tripping RLS recursion)
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

create or replace function public.is_enrolled(p_program uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.enrollments e where e.program_id = p_program and e.profile_id = auth.uid());
$$;

create or replace function public.in_conversation(p_conv uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.conversation_members m where m.conversation_id = p_conv and m.profile_id = auth.uid());
$$;

-- ============================================================
--  TABLES
-- ============================================================

-- Members (one row per auth user, created automatically on signup)
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  full_name         text,
  email             text,
  avatar_url        text,
  role              text not null default 'member' check (role in ('member','admin')),
  membership_status text not null default 'active',
  member_since      date default current_date,
  renews_at         date,
  created_at        timestamptz default now()
);

-- Retreats & programs (the offerings)
create table if not exists public.programs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('retreat','program')),
  title        text not null,
  tag          text,
  description  text,
  location     text,
  starts_at    timestamptz not null,
  nights       int default 0,
  image_url    text,
  published    boolean not null default true,
  created_at   timestamptz default now()
);

-- Which members are enrolled in which programs
create table if not exists public.enrollments (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  program_id  uuid not null references public.programs(id) on delete cascade,
  status      text not null default 'confirmed' check (status in ('confirmed','waitlist','applied','complete')),
  created_at  timestamptz default now(),
  unique (profile_id, program_id)
);

-- Resources & program materials
create table if not exists public.resources (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  description    text,
  resource_type  text,
  icon           text,
  url            text,
  category       text not null default 'general' check (category in ('general','program')),
  program_id     uuid references public.programs(id) on delete cascade,
  locked         boolean not null default false,
  meta           text,
  sort           int default 0,
  created_at     timestamptz default now()
);

-- Home-feed announcements
create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  author_name text not null default 'Tiger Soul',
  body        text not null,
  created_at  timestamptz default now()
);

-- Messaging: conversations, membership, messages
create table if not exists public.conversations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  subtitle    text,
  kind        text not null default 'group' check (kind in ('broadcast','group','direct')),
  program_id  uuid references public.programs(id) on delete set null,
  avatar      text,
  created_at  timestamptz default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  primary key (conversation_id, profile_id)
);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid references public.profiles(id) on delete set null,
  body            text not null,
  created_at      timestamptz default now()
);

-- Scholarship donations
create table if not exists public.donations (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid references public.profiles(id) on delete set null,
  amount_cents int not null,
  note        text,
  monthly     boolean default false,
  created_at  timestamptz default now()
);

-- FAQ
create table if not exists public.faqs (
  id        uuid primary key default gen_random_uuid(),
  question  text not null,
  answer    text not null,
  sort      int default 0
);

-- ============================================================
--  AUTO-CREATE A PROFILE WHEN SOMEONE SIGNS UP
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, renews_at)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email,'@',1)),
    new.email,
    (current_date + interval '1 year')::date
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
--  ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles              enable row level security;
alter table public.programs              enable row level security;
alter table public.enrollments           enable row level security;
alter table public.resources             enable row level security;
alter table public.announcements         enable row level security;
alter table public.conversations         enable row level security;
alter table public.conversation_members  enable row level security;
alter table public.messages              enable row level security;
alter table public.donations             enable row level security;
alter table public.faqs                  enable row level security;

-- ---- profiles ----
drop policy if exists "profiles: read own or admin" on public.profiles;
create policy "profiles: read own or admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles: update own or admin" on public.profiles;
create policy "profiles: update own or admin" on public.profiles
  for update to authenticated using (id = auth.uid() or public.is_admin());

-- ---- programs ----
drop policy if exists "programs: read published" on public.programs;
create policy "programs: read published" on public.programs
  for select to authenticated using (published or public.is_admin());
drop policy if exists "programs: admin write" on public.programs;
create policy "programs: admin write" on public.programs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---- enrollments ----
drop policy if exists "enrollments: read own or admin" on public.enrollments;
create policy "enrollments: read own or admin" on public.enrollments
  for select to authenticated using (profile_id = auth.uid() or public.is_admin());
drop policy if exists "enrollments: admin write" on public.enrollments;
create policy "enrollments: admin write" on public.enrollments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---- resources ----
drop policy if exists "resources: read general or enrolled" on public.resources;
create policy "resources: read general or enrolled" on public.resources
  for select to authenticated using (
    category = 'general'
    or (category = 'program' and program_id is not null and public.is_enrolled(program_id))
    or public.is_admin()
  );
drop policy if exists "resources: admin write" on public.resources;
create policy "resources: admin write" on public.resources
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---- announcements ----
drop policy if exists "announcements: read all" on public.announcements;
create policy "announcements: read all" on public.announcements
  for select to authenticated using (true);
drop policy if exists "announcements: admin write" on public.announcements;
create policy "announcements: admin write" on public.announcements
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---- conversations ----
drop policy if exists "conversations: read if member or broadcast" on public.conversations;
create policy "conversations: read if member or broadcast" on public.conversations
  for select to authenticated using (kind = 'broadcast' or public.in_conversation(id) or public.is_admin());

-- ---- conversation_members ----
drop policy if exists "conv members: read own or admin" on public.conversation_members;
create policy "conv members: read own or admin" on public.conversation_members
  for select to authenticated using (profile_id = auth.uid() or public.is_admin());

-- ---- messages ----
drop policy if exists "messages: read if in conversation" on public.messages;
create policy "messages: read if in conversation" on public.messages
  for select to authenticated using (
    public.in_conversation(conversation_id)
    or exists (select 1 from public.conversations c where c.id = conversation_id and c.kind = 'broadcast')
    or public.is_admin()
  );
drop policy if exists "messages: send as self in conversation" on public.messages;
create policy "messages: send as self in conversation" on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and (public.in_conversation(conversation_id) or public.is_admin())
  );

-- ---- donations ----
drop policy if exists "donations: read own or admin" on public.donations;
create policy "donations: read own or admin" on public.donations
  for select to authenticated using (profile_id = auth.uid() or public.is_admin());
drop policy if exists "donations: give" on public.donations;
create policy "donations: give" on public.donations
  for insert to authenticated with check (profile_id = auth.uid() or profile_id is null);

-- ---- faqs ----
drop policy if exists "faqs: read all" on public.faqs;
create policy "faqs: read all" on public.faqs
  for select to authenticated using (true);
drop policy if exists "faqs: admin write" on public.faqs;
create policy "faqs: admin write" on public.faqs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ============================================================
--  GRANTS  (needed because "auto-expose new tables" was left OFF)
-- ============================================================
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to authenticated;
grant insert on public.messages, public.donations to authenticated;
grant update on public.profiles to authenticated;

-- ============================================================
--  SEED DATA  (sample content so the portal isn't empty — edit freely
--  in Supabase → Table Editor, or delete these rows later)
-- ============================================================
insert into public.faqs (question, answer, sort) values
  ('How do I access my retreat materials?', 'Everything for the programs and retreats you''re enrolled in lives under Resources → My Program Materials. New materials unlock as your program progresses.', 1),
  ('Can I message other members directly?', 'Yes. Members in the same retreat or program circle can message one another, and you can always reach the Tiger Soul team. Please hold everything shared here in confidence.', 2),
  ('How does the Scholarship Circle work?', 'Your gift goes into a shared fund that sponsors a place in ceremony for someone who cannot afford one. You can give once or monthly.', 3),
  ('When does my membership renew?', 'Membership is annual at $25/year and renews on your join date. You can manage renewal any time by messaging us.', 4),
  ('What if I need to reschedule a retreat?', 'Reach out through Messages or email hello@tigersoulretreats.com as early as you can. We''ll always work with you.', 5),
  ('Is my information private?', 'Deeply. Your participation, health disclosures, and anything shared in the circle are strictly confidential.', 6)
on conflict do nothing;

insert into public.programs (kind, title, tag, description, location, starts_at, nights, image_url) values
  ('retreat', 'Costa Rica Awakening', 'Immersive Retreat', 'Seven days of Bufo, Kambo & cacao ceremony in the jungle canopy, held in a small circle.', 'Nosara, Costa Rica', '2026-08-15 00:00:00+00', 6, '../assets/images/pages/retreats-hero.webp'),
  ('program', 'Integration Circle — Cohort III', '8-Week Program', 'Weekly live integration calls with the circle.', 'Online · Thursdays 6pm PT', '2026-07-16 00:00:00+00', 0, '../assets/images/pages/retreats-cta.webp'),
  ('retreat', 'New Moon Kambo Circle', 'Weekend Ceremony', 'A cleansing weekend of Kambo and Rapéh under the new moon.', 'Topanga, California', '2026-09-20 00:00:00+00', 1, '../assets/images/pages/retreats-cta.webp')
on conflict do nothing;

insert into public.resources (title, description, resource_type, icon, category, meta, sort) values
  ('Preparing for Ceremony', 'Diet, mindset, and the days before. How to arrive open and ready.', 'Guide · PDF', '❧', 'general', '12 pages', 1),
  ('The Art of Integration', 'Weaving your insights into daily life so the medicine keeps working.', 'Guide · PDF', '☙', 'general', '18 pages', 2),
  ('Grounding Meditation', 'A 20-minute practice to steady the nervous system before or after.', 'Audio', '♪', 'general', '20 min', 3),
  ('Safety & Contraindications', 'Medications, conditions, and honesty. Please read before any medicine.', 'Guide · PDF', '✦', 'general', '6 pages', 4),
  ('Community Agreements', 'How we hold this circle with consent, confidentiality, and care.', 'Reading', '❋', 'general', 'Web', 5)
on conflict do nothing;

insert into public.announcements (author_name, body) values
  ('Blaine · Tiger Soul', 'Costa Rica travel details are now in your Resources. Please review the arrival-day instructions before booking flights.'),
  ('Tiger Soul', 'New guided meditation added to the library — a grounding practice for the days after ceremony.'),
  ('Integration Circle', 'Reminder: our week 3 call is Thursday at 6pm PT. This week we sit with grief.')
on conflict do nothing;

insert into public.conversations (name, subtitle, kind, avatar) values
  ('Tiger Soul Announcements', 'Official updates · broadcast', 'broadcast', '✦')
on conflict do nothing;

-- Done. Next: Settings → API → copy your Project URL + anon public key.
