-- Founder totals are authorized by an administrator-managed UUID allowlist.
-- This migration intentionally does not assign founder access to anyone.
begin;

create table coinxchange_private.founder_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now()
);
alter table coinxchange_private.founder_members enable row level security;
revoke all on coinxchange_private.founder_members from public, anon, authenticated;
comment on table coinxchange_private.founder_members is
  'Trusted founder allowlist, provisioned only by a database administrator after account ownership verification. Never populated from signup metadata.';

create function coinxchange_private.read_founder_signup_counts()
returns table (
  total_members bigint,
  confirmed_members bigint,
  joined_last_7_days bigint,
  joined_last_30_days bigint,
  as_of timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  checked_at timestamptz := pg_catalog.statement_timestamp();
begin
  if caller is null or not exists (
    select 1
    from coinxchange_private.founder_members as founders
    join auth.users as member on member.id = founders.user_id
    where founders.user_id = caller
      and member.deleted_at is null
      and member.is_anonymous is not true
      and member.email_confirmed_at is not null
  ) then
    raise exception using errcode = '42501', message = 'Founder access is required.';
  end if;

  return query
    select
      pg_catalog.count(*),
      pg_catalog.count(*) filter (where member.email_confirmed_at is not null),
      pg_catalog.count(*) filter (where member.created_at >= checked_at - interval '7 days'),
      pg_catalog.count(*) filter (where member.created_at >= checked_at - interval '30 days'),
      checked_at
    from auth.users as member
    where member.deleted_at is null
      and member.is_anonymous is not true
      and nullif(pg_catalog.btrim(member.email), '') is not null;
end;
$$;

revoke all on function coinxchange_private.read_founder_signup_counts()
  from public, anon, authenticated;

-- Keep the privileged implementation out of the exposed public schema.
-- The public wrapper runs as the caller; only the guarded helper can read Auth.
create function public.founder_signup_counts()
returns table (
  total_members bigint,
  confirmed_members bigint,
  joined_last_7_days bigint,
  joined_last_30_days bigint,
  as_of timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from coinxchange_private.read_founder_signup_counts();
$$;

revoke all on function public.founder_signup_counts() from public, anon, authenticated;
grant usage on schema coinxchange_private to authenticated;
grant execute on function coinxchange_private.read_founder_signup_counts() to authenticated;
grant execute on function public.founder_signup_counts() to authenticated;

comment on function public.founder_signup_counts() is
  'Founder-only aggregate account counts. Returns no names, emails, IDs, coin data, or visitor tracking.';

commit;
