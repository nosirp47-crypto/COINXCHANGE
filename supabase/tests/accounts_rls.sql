-- Run as the database owner against a disposable Supabase project AFTER the migration.
-- Plain SQL: no pgTAP extension is required. Any unexpected result raises an error.
-- All fixture users and data are confined to this transaction and rolled back.
-- With psql: psql "$COINXCHANGE_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/accounts_rls.sql
begin;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['profiles', 'collection_items', 'watchlist_items'] loop
    if not (select relrowsecurity from pg_class
      where oid = ('public.' || table_name)::regclass) then
      raise exception 'RLS must be enabled for %', table_name;
    end if;
    if has_table_privilege('anon', 'public.' || table_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'Anonymous role must have no table privileges on %', table_name;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.profiles', 'INSERT,DELETE,TRUNCATE') then
    raise exception 'Clients must not insert, delete, or truncate profiles';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'id', 'UPDATE')
    or has_column_privilege('authenticated', 'public.profiles', 'created_at', 'UPDATE')
    or has_column_privilege('authenticated', 'public.profiles', 'updated_at', 'UPDATE')
    or has_column_privilege('authenticated', 'public.collection_items', 'id', 'UPDATE')
    or has_column_privilege('authenticated', 'public.collection_items', 'owner_id', 'UPDATE')
    or has_column_privilege('authenticated', 'public.collection_items', 'created_at', 'UPDATE')
    or has_table_privilege('authenticated', 'public.watchlist_items', 'UPDATE') then
    raise exception 'Immutable identity or audit columns are writable';
  end if;
  if has_function_privilege('authenticated',
    'coinxchange_private.create_profile_for_auth_user()', 'EXECUTE') then
    raise exception 'Signup trigger function must not be exposed to clients';
  end if;

  perform set_config('coinxchange_test.user_a', gen_random_uuid()::text, true);
  perform set_config('coinxchange_test.user_b', gen_random_uuid()::text, true);
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values
    (current_setting('coinxchange_test.user_a')::uuid,
      current_setting('coinxchange_test.user_a') || '@coinxchange.invalid',
      '{"display_name":"  Collector A  ","role":"admin"}'::jsonb,
      '{"provider":"email","providers":["email"]}'::jsonb, now(), now()),
    (current_setting('coinxchange_test.user_b')::uuid,
      current_setting('coinxchange_test.user_b') || '@coinxchange.invalid',
      '{"display_name":{"unexpected":"object"}}'::jsonb,
      '{"provider":"email","providers":["email"]}'::jsonb, now(), now());

  if (select display_name from public.profiles
      where id = current_setting('coinxchange_test.user_a')::uuid) <> 'Collector A'
    or (select display_name from public.profiles
      where id = current_setting('coinxchange_test.user_b')::uuid) <> 'Collector' then
    raise exception 'Signup trigger did not safely normalize display names';
  end if;

  insert into public.collection_items (owner_id, name, notes)
  values (current_setting('coinxchange_test.user_b')::uuid, 'Private B coin', 'B notes');
  insert into public.watchlist_items (owner_id, reference_id)
  values (current_setting('coinxchange_test.user_b')::uuid, '1943');
end;
$$;

-- An unauthenticated caller gets no private data, even if a request claims a UUID.
set local role anon;
do $$
declare
  table_name text;
begin
  perform set_config('request.jwt.claim.sub', current_setting('coinxchange_test.user_a'), true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('coinxchange_test.user_a'), 'role', 'anon')::text, true);
  foreach table_name in array array['profiles', 'collection_items', 'watchlist_items'] loop
    begin
      execute 'select count(*) from public.' || quote_ident(table_name);
      raise exception 'Anonymous caller could read %', table_name;
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin
    insert into public.collection_items (name) values ('Anonymous coin');
    raise exception 'Anonymous caller could create a collection item';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- User A is allowed to use only A's profile, collection, and watchlist.
set local role authenticated;
do $$
declare
  changed integer;
  created_id uuid;
begin
  perform set_config('request.jwt.claim.sub', current_setting('coinxchange_test.user_a'), true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('coinxchange_test.user_a'), 'role', 'authenticated',
    'user_metadata', jsonb_build_object('role', 'admin'))::text, true);

  if (select count(*) from public.profiles) <> 1
    or not exists (select 1 from public.profiles
      where id = current_setting('coinxchange_test.user_a')::uuid) then
    raise exception 'Profile policy must reveal exactly the caller profile';
  end if;
  if exists (select 1 from public.collection_items)
    or exists (select 1 from public.watchlist_items) then
    raise exception 'User A can see User B private data';
  end if;

  insert into public.collection_items (name, notes, reference_id)
  values ('Private A coin', 'A notes', '1909') returning id into created_id;
  perform set_config('coinxchange_test.collection_a', created_id::text, true);
  if not exists (select 1 from public.collection_items
    where id = created_id and owner_id = current_setting('coinxchange_test.user_a')::uuid) then
    raise exception 'Collection default owner or read-back failed';
  end if;
  insert into public.watchlist_items (reference_id) values ('1955');
  -- The client may use ignoreDuplicates:true for an idempotent watch action.
  insert into public.watchlist_items (owner_id, reference_id)
  values (current_setting('coinxchange_test.user_a')::uuid, '1955')
  on conflict (owner_id, reference_id) do nothing;
  if (select count(*) from public.watchlist_items) <> 1 then
    raise exception 'Watchlist must be private and deduplicated';
  end if;

  update public.profiles set display_name = 'Updated A';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Owner profile update failed'; end if;
  update public.collection_items set notes = 'Updated A notes' where id = created_id;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Owner collection update failed'; end if;

  update public.profiles set display_name = 'Stolen B'
  where id = current_setting('coinxchange_test.user_b')::uuid;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Cross-account profile update succeeded'; end if;
  update public.collection_items set name = 'Stolen B'
  where owner_id = current_setting('coinxchange_test.user_b')::uuid;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Cross-account collection update succeeded'; end if;
  delete from public.collection_items
  where owner_id = current_setting('coinxchange_test.user_b')::uuid;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Cross-account collection delete succeeded'; end if;
  delete from public.watchlist_items
  where owner_id = current_setting('coinxchange_test.user_b')::uuid;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Cross-account watchlist delete succeeded'; end if;

  begin
    insert into public.collection_items (owner_id, name)
    values (current_setting('coinxchange_test.user_b')::uuid, 'Impersonated coin');
    raise exception 'Cross-account collection insert succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.watchlist_items (owner_id, reference_id)
    values (current_setting('coinxchange_test.user_b')::uuid, '1955');
    raise exception 'Cross-account watchlist insert succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.collection_items set owner_id = current_setting('coinxchange_test.user_b')::uuid
    where id = created_id;
    raise exception 'Collection owner is mutable';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.collection_items set id = gen_random_uuid() where id = created_id;
    raise exception 'Collection ID is mutable';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set updated_at = '2000-01-01'::timestamptz;
    raise exception 'Profile audit timestamp is mutable by a client';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.profiles (id, display_name) values (gen_random_uuid(), 'Impersonation');
    raise exception 'Client profile creation is permitted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.collection_items (name) values (repeat('x', 161));
    raise exception 'Oversized collection name was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.collection_items set notes = repeat('x', 2001) where id = created_id;
    raise exception 'Oversized notes were accepted';
  exception when check_violation then null;
  end;
  begin
    update public.profiles set display_name = ' ';
    raise exception 'Blank display name was accepted';
  exception when check_violation then null;
  end;
end;
$$;

-- Switching identities must change every private result set.
do $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('coinxchange_test.user_b'), true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('coinxchange_test.user_b'), 'role', 'authenticated')::text, true);
  if (select count(*) from public.profiles) <> 1
    or not exists (select 1 from public.profiles
      where id = current_setting('coinxchange_test.user_b')::uuid and display_name = 'Collector')
    or (select count(*) from public.collection_items) <> 1
    or not exists (select 1 from public.collection_items where name = 'Private B coin')
    or (select count(*) from public.watchlist_items) <> 1 then
    raise exception 'User B data was modified or User A data leaked';
  end if;
  if exists (select 1 from public.collection_items
    where id = current_setting('coinxchange_test.collection_a')::uuid) then
    raise exception 'Known IDs must not bypass RLS';
  end if;
end;
$$;

-- Even the authenticated role must supply a valid authenticated subject.
do $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  if exists (select 1 from public.profiles)
    or exists (select 1 from public.collection_items)
    or exists (select 1 from public.watchlist_items) then
    raise exception 'Missing identity can read private rows';
  end if;
  begin
    insert into public.collection_items (owner_id, name)
    values (current_setting('coinxchange_test.user_a')::uuid, 'Missing identity');
    raise exception 'Missing identity can insert private rows';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- Account deletion by the trusted Auth/admin service removes that member's data.
do $$
begin
  delete from auth.users where id = current_setting('coinxchange_test.user_b')::uuid;
  if exists (select 1 from public.profiles where id = current_setting('coinxchange_test.user_b')::uuid)
    or exists (select 1 from public.collection_items where owner_id = current_setting('coinxchange_test.user_b')::uuid)
    or exists (select 1 from public.watchlist_items where owner_id = current_setting('coinxchange_test.user_b')::uuid) then
    raise exception 'Auth account deletion did not cascade to private data';
  end if;
end;
$$;

select 'COINXCHANGE account/RLS checks passed; all test data is rolled back next.' as result;
rollback;
