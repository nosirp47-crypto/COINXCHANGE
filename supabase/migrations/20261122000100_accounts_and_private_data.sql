-- COINXCHANGE Phase 3: managed Auth + private member data.
-- Apply once to a fresh Supabase project as the database owner.
-- Email addresses/passwords remain in Supabase Auth, never in these public tables.
begin;

create schema if not exists coinxchange_private;
revoke all on schema coinxchange_private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length
    check (char_length(display_name) between 1 and 40),
  constraint profiles_display_name_format
    check (display_name = btrim(display_name) and display_name !~ '[[:cntrl:]]')
);

create table public.collection_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  notes text not null default '',
  reference_id text,
  created_at timestamptz not null default now(),
  constraint collection_items_name_length
    check (char_length(name) between 1 and 160),
  constraint collection_items_name_format
    check (name = btrim(name) and name !~ '[[:cntrl:]]'),
  constraint collection_items_notes_length
    check (char_length(notes) <= 2000),
  constraint collection_items_reference_length
    check (reference_id is null or (char_length(reference_id) between 1 and 80
      and reference_id = btrim(reference_id) and reference_id !~ '[[:cntrl:]]'))
);

create index collection_items_owner_created_idx
  on public.collection_items (owner_id, created_at desc, id desc);

create table public.watchlist_items (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reference_id text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, reference_id),
  constraint watchlist_items_reference_length
    check (char_length(reference_id) between 1 and 80),
  constraint watchlist_items_reference_format
    check (reference_id = btrim(reference_id) and reference_id !~ '[[:cntrl:]]')
);

-- This trigger is the only client signup path that creates a profile.
-- User metadata supplies a display label only; it never supplies permissions.
create function coinxchange_private.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  chosen_name text;
begin
  chosen_name := case
    when pg_catalog.jsonb_typeof(new.raw_user_meta_data -> 'display_name') = 'string'
    then new.raw_user_meta_data ->> 'display_name'
    else ''
  end;
  chosen_name := pg_catalog.btrim(pg_catalog.left(pg_catalog.btrim(
    pg_catalog.regexp_replace(chosen_name, '[[:cntrl:]]', '', 'g')
  ), 40));
  chosen_name := coalesce(nullif(chosen_name, ''), 'Collector');

  insert into public.profiles (id, display_name)
  values (new.id, chosen_name);
  return new;
end;
$$;

revoke all on function coinxchange_private.create_profile_for_auth_user()
  from public, anon, authenticated;

create trigger coinxchange_create_profile
after insert on auth.users
for each row execute function coinxchange_private.create_profile_for_auth_user();

create function coinxchange_private.touch_profile_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function coinxchange_private.touch_profile_updated_at()
  from public, anon, authenticated;

create trigger coinxchange_touch_profile
before update on public.profiles
for each row execute function coinxchange_private.touch_profile_updated_at();

-- Also create profiles for any test accounts added before this migration.
insert into public.profiles (id, display_name)
select
  users.id,
  coalesce(nullif(pg_catalog.btrim(pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(
    case when pg_catalog.jsonb_typeof(users.raw_user_meta_data -> 'display_name') = 'string'
      then users.raw_user_meta_data ->> 'display_name' else '' end,
    '[[:cntrl:]]', '', 'g'
  )), 40)), ''), 'Collector')
from auth.users as users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.collection_items enable row level security;
alter table public.watchlist_items enable row level security;

-- Supabase projects can have permissive default grants. Reset this batch's
-- tables first; policies complement grants and do not replace them.
revoke all on public.profiles, public.collection_items, public.watchlist_items
  from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.profiles, public.collection_items, public.watchlist_items
  to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant insert (owner_id, name, notes, reference_id) on public.collection_items
  to authenticated;
grant update (name, notes, reference_id) on public.collection_items
  to authenticated;
grant delete on public.collection_items to authenticated;
grant insert (owner_id, reference_id) on public.watchlist_items to authenticated;
grant delete on public.watchlist_items to authenticated;

create policy profiles_select_own on public.profiles
for select to authenticated
using ((select auth.uid()) = id);

create policy profiles_update_own on public.profiles
for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy collection_items_select_own on public.collection_items
for select to authenticated
using ((select auth.uid()) = owner_id);

create policy collection_items_insert_own on public.collection_items
for insert to authenticated
with check ((select auth.uid()) = owner_id);

create policy collection_items_update_own on public.collection_items
for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy collection_items_delete_own on public.collection_items
for delete to authenticated
using ((select auth.uid()) = owner_id);

create policy watchlist_items_select_own on public.watchlist_items
for select to authenticated
using ((select auth.uid()) = owner_id);

create policy watchlist_items_insert_own on public.watchlist_items
for insert to authenticated
with check ((select auth.uid()) = owner_id);

create policy watchlist_items_delete_own on public.watchlist_items
for delete to authenticated
using ((select auth.uid()) = owner_id);

comment on table public.profiles is
  'Private member profile. Auth owns credentials; display_name is not a role or verified identity.';
comment on table public.collection_items is
  'Private, owner-scoped vault notes. Claims about a coin are not authenticated valuations.';
comment on table public.watchlist_items is
  'Private watchlist of educational catalog reference IDs.';

commit;
