-- ============================================================
-- Tiger Soul — email campaigns (a small campaign manager) for the admin portal
-- Run once in Supabase: SQL Editor → paste → Run. Safe to re-run.
-- ============================================================

-- 1) Marketing opt-out. One-click unsubscribe stamps this; sends skip anyone set.
alter table public.profiles
  add column if not exists unsubscribed_at timestamptz;

-- 2) Campaigns. Admins create/edit/duplicate/delete these from the portal;
--    the send Edge Function flips status to 'sent' and stamps the counts.
create table if not exists public.campaigns (
  id                uuid primary key default gen_random_uuid(),
  name              text not null default 'Untitled campaign',
  subject           text not null default '',
  preview_text      text default '',
  content_html      text not null default '',
  audience_type     text not null default 'all'
                      check (audience_type in ('all','program','no_intake','handpick')),
  audience_program  text,
  audience_ids      uuid[] not null default '{}',
  status            text not null default 'draft'
                      check (status in ('draft','scheduled','sending','sent')),
  scheduled_at      timestamptz,
  recipient_count   int not null default 0,
  sent_by           text,
  sent_at           timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- 3) Per-recipient delivery log (history / who-got-what).
create table if not exists public.campaign_recipients (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid references public.campaigns(id) on delete cascade,
  profile_id   uuid references public.profiles(id) on delete set null,
  email        text not null,
  status       text not null default 'sent',   -- sent | error
  provider_id  text,
  error        text,
  created_at   timestamptz default now()
);
create index if not exists campaign_recipients_campaign_idx on public.campaign_recipients(campaign_id);
create index if not exists campaigns_status_idx on public.campaigns(status);

-- ---- Row-level security ----------------------------------------------------
alter table public.campaigns           enable row level security;
alter table public.campaign_recipients enable row level security;

-- Admins manage campaigns straight from the portal (browser, under their JWT).
drop policy if exists "admins read campaigns"   on public.campaigns;
drop policy if exists "admins write campaigns"  on public.campaigns;
drop policy if exists "admins read recipients"  on public.campaign_recipients;

create policy "admins read campaigns"  on public.campaigns
  for select using (public.is_admin());
create policy "admins write campaigns" on public.campaigns
  for all using (public.is_admin()) with check (public.is_admin());
create policy "admins read recipients" on public.campaign_recipients
  for select using (public.is_admin());

grant select, insert, update, delete on public.campaigns to authenticated;
grant select on public.campaign_recipients to authenticated;
grant all on public.campaigns, public.campaign_recipients to service_role;
