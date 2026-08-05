-- ============================================================
-- Tiger Soul — email campaigns (announcements) for the admin portal
-- Run once in Supabase: SQL Editor → paste → Run. Safe to re-run.
-- ============================================================

-- 1) Marketing opt-out. A one-click unsubscribe link stamps this; the
--    campaign sender skips anyone who has it set.
alter table public.profiles
  add column if not exists unsubscribed_at timestamptz;

-- 2) One row per announcement that was sent.
create table if not exists public.campaigns (
  id               uuid primary key default gen_random_uuid(),
  subject          text not null,
  body_html        text not null,     -- the composed message (inner HTML)
  audience         text not null default 'all',
  recipient_count  int  not null default 0,
  sent_by          text,              -- admin email that pressed send
  sent_at          timestamptz default now(),
  created_at       timestamptz default now()
);

-- 3) One row per recipient of a campaign (delivery log / CRM history).
create table if not exists public.campaign_recipients (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid references public.campaigns(id) on delete cascade,
  profile_id   uuid references public.profiles(id) on delete set null,
  email        text not null,
  status       text not null default 'sent',   -- sent | error
  provider_id  text,                            -- Resend message id
  error        text,
  created_at   timestamptz default now()
);

create index if not exists campaign_recipients_campaign_idx on public.campaign_recipients(campaign_id);

-- ---- Row-level security: admins read; Edge Functions (service_role) write ----
alter table public.campaigns           enable row level security;
alter table public.campaign_recipients enable row level security;

drop policy if exists "admins read campaigns"  on public.campaigns;
drop policy if exists "admins read recipients" on public.campaign_recipients;

create policy "admins read campaigns"  on public.campaigns           for select using (public.is_admin());
create policy "admins read recipients" on public.campaign_recipients for select using (public.is_admin());

grant select on public.campaigns, public.campaign_recipients to authenticated;
grant all on public.campaigns, public.campaign_recipients to service_role;
