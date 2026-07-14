-- ============================================================
--  TIGER SOUL — SECURITY PATCH
--  Locks members out of admin/elevated access.
--  A member can update their own name/avatar, but CANNOT
--  change their role or membership status — only admins can.
--  Paste into Supabase → SQL Editor → Run. Safe to re-run.
-- ============================================================
set check_function_bodies = off;

create or replace function public.protect_profile_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Only an admin may change a role or membership status.
  if (new.role is distinct from old.role
      or new.membership_status is distinct from old.membership_status)
     and not public.is_admin() then
    raise exception 'Not allowed: only an administrator can change role or membership status.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_privileges on public.profiles;
create trigger protect_profile_privileges
  before update on public.profiles
  for each row execute function public.protect_profile_privileges();

-- Done. Members can no longer promote themselves to admin.
