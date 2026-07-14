-- ============================================================
--  TIGER SOUL — PAYMENT PLANS & TRACKING
--  Run AFTER schema.sql. Paste into Supabase → SQL Editor → Run.
--  Safe to re-run.
-- ============================================================
set check_function_bodies = off;

-- ---------- Packages you offer (admin-defined, editable) ----------
create table if not exists public.packages (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  total_cents   int not null,
  deposit_cents int not null default 0,
  allowed_terms int[] not null default '{3,6}',   -- month options
  published     boolean not null default true,
  created_at    timestamptz default now()
);

-- ---------- A member's chosen plan (snapshot of price at signup) ----------
create table if not exists public.member_plans (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  package_id    uuid references public.packages(id) on delete set null,
  name          text not null,
  total_cents   int not null,
  deposit_cents int not null default 0,
  term_months   int not null,
  status        text not null default 'active' check (status in ('active','paid','cancelled')),
  started_at    date not null default current_date,
  created_at    timestamptz default now()
);

-- ---------- The schedule: deposit + monthly installments ----------
create table if not exists public.installments (
  id             uuid primary key default gen_random_uuid(),
  member_plan_id uuid not null references public.member_plans(id) on delete cascade,
  seq            int not null,                    -- 0 = deposit, 1..n = installments
  kind           text not null default 'installment' check (kind in ('deposit','installment')),
  amount_cents   int not null,
  due_date       date not null,
  paid           boolean not null default false,
  paid_at        timestamptz,
  method         text,                            -- 'stripe' | 'manual' | ...
  stripe_ref     text,
  created_at     timestamptz default now()
);
create index if not exists installments_plan_idx on public.installments(member_plan_id);

-- ============================================================
--  ENROLL a member into a package → builds their schedule
-- ============================================================
create or replace function public.enroll_in_plan(p_profile uuid, p_package uuid, p_term int, p_start date default current_date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  pkg public.packages;
  plan_id uuid;
  remaining int;
  each_amt int;
  i int;
begin
  select * into pkg from public.packages where id = p_package;
  if pkg.id is null then raise exception 'package not found'; end if;

  insert into public.member_plans (profile_id, package_id, name, total_cents, deposit_cents, term_months, started_at)
  values (p_profile, p_package, pkg.name, pkg.total_cents, pkg.deposit_cents, p_term, p_start)
  returning id into plan_id;

  if pkg.deposit_cents > 0 then
    insert into public.installments (member_plan_id, seq, kind, amount_cents, due_date)
    values (plan_id, 0, 'deposit', pkg.deposit_cents, p_start);
  end if;

  remaining := pkg.total_cents - pkg.deposit_cents;
  each_amt  := remaining / p_term;
  for i in 1..p_term loop
    insert into public.installments (member_plan_id, seq, kind, amount_cents, due_date)
    values (
      plan_id, i, 'installment',
      case when i = p_term then remaining - each_amt * (p_term - 1) else each_amt end, -- last absorbs rounding
      (p_start + (i || ' month')::interval)::date
    );
  end loop;

  return plan_id;
end;
$$;

-- ============================================================
--  ADMIN: mark an installment paid (used until Stripe is wired,
--  and for cash/transfer payments after)
-- ============================================================
create or replace function public.mark_installment_paid(p_installment uuid, p_method text default 'manual')
returns void language plpgsql security definer set search_path = public as $$
declare v_plan uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.installments set paid = true, paid_at = now(), method = p_method
    where id = p_installment returning member_plan_id into v_plan;
  update public.member_plans mp set status = 'paid'
    where mp.id = v_plan
      and not exists (select 1 from public.installments i where i.member_plan_id = v_plan and i.paid = false);
end;
$$;

-- ============================================================
--  ROW LEVEL SECURITY
-- ============================================================
alter table public.packages     enable row level security;
alter table public.member_plans enable row level security;
alter table public.installments enable row level security;

drop policy if exists "packages: read" on public.packages;
create policy "packages: read" on public.packages
  for select to authenticated using (published or public.is_admin());
drop policy if exists "packages: admin write" on public.packages;
create policy "packages: admin write" on public.packages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "plans: read own or admin" on public.member_plans;
create policy "plans: read own or admin" on public.member_plans
  for select to authenticated using (profile_id = auth.uid() or public.is_admin());
drop policy if exists "plans: admin write" on public.member_plans;
create policy "plans: admin write" on public.member_plans
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "installments: read own or admin" on public.installments;
create policy "installments: read own or admin" on public.installments
  for select to authenticated using (
    public.is_admin()
    or exists (select 1 from public.member_plans mp where mp.id = member_plan_id and mp.profile_id = auth.uid())
  );
drop policy if exists "installments: admin write" on public.installments;
create policy "installments: admin write" on public.installments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.packages, public.member_plans, public.installments to authenticated;

-- ============================================================
--  SEED: one sample package + enroll your account so you can see it
-- ============================================================
insert into public.packages (name, description, total_cents, deposit_cents, allowed_terms)
values ('Tiger Soul Journey Package',
        'Your full retreat + integration journey. $1,000 deposit, then the balance over 3 or 6 monthly payments.',
        400000, 100000, '{3,6}')
on conflict do nothing;

do $$
declare v_prof uuid; v_pkg uuid; v_plan uuid;
begin
  select id into v_prof from public.profiles where email = 'lburandt2@gmail.com' limit 1;
  select id into v_pkg  from public.packages where name = 'Tiger Soul Journey Package' limit 1;
  if v_prof is not null and v_pkg is not null
     and not exists (select 1 from public.member_plans where profile_id = v_prof) then
    -- started ~2.5 months ago so the schedule shows paid, overdue, and upcoming
    v_plan := public.enroll_in_plan(v_prof, v_pkg, 6, (current_date - interval '75 days')::date);
    update public.installments set paid = true, paid_at = now(), method = 'manual'
      where member_plan_id = v_plan and seq in (0, 1);   -- deposit + first payment paid
  end if;
end $$;

-- Done. The Payments section in the portal now reads from these tables.
