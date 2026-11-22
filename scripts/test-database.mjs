import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// This is an isolated Postgres engine, not a Supabase cloud connection.
// The Auth table/helper below model the pieces consumed by our migration;
// hosted email delivery, JWT validation, and the Data API need separate checks.
const database = new PGlite();
const migrationFile = new URL(
  '../supabase/migrations/20261122000100_accounts_and_private_data.sql',
  import.meta.url
);
const checksFile = new URL('../supabase/tests/accounts_rls.sql', import.meta.url);

try {
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    grant usage on schema auth to anon, authenticated;
    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb,
      raw_app_meta_data jsonb,
      created_at timestamptz,
      updated_at timestamptz
    );
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
      )::uuid;
    $$;

    -- Simulate a project's permissive defaults to verify explicit revocation.
    alter default privileges in schema public grant all on tables to anon, authenticated;

    -- An existing account exercises migration backfill. Truncating this name
    -- at 40 characters must not leave trailing whitespace and block migration.
    insert into auth.users (id, raw_user_meta_data) values (
      '00000000-0000-4000-8000-000000000001',
      jsonb_build_object('display_name', repeat('a', 39) || ' ' || repeat('b', 20))
    );
  `);

  await database.exec(await readFile(migrationFile, 'utf8'));
  const backfilled = await database.query(`
    select display_name from public.profiles
    where id = '00000000-0000-4000-8000-000000000001'
  `);
  assert.deepEqual(backfilled.rows, [{ display_name: 'a'.repeat(39) }],
    'The existing user must receive a safely normalized profile.');
  console.log('PASS: migration and existing-user profile backfill');

  const results = await database.exec(await readFile(checksFile, 'utf8'));
  const success = results.some(result => result.rows?.some(row =>
    row.result === 'COINXCHANGE account/RLS checks passed; all test data is rolled back next.'
  ));
  assert.ok(success, 'The SQL security checks must reach their success result.');
  console.log('PASS: owner permissions, anonymous rejection, cross-account isolation, and constraints');

  const afterRollback = await database.query(`
    select
      (select count(*) from auth.users) as users,
      (select count(*) from public.profiles) as profiles,
      (select count(*) from public.collection_items) as coins,
      (select count(*) from public.watchlist_items) as watches
  `);
  assert.deepEqual(afterRollback.rows, [{ users: 1, profiles: 1, coins: 0, watches: 0 }],
    'Security-test fixtures must roll back without removing the existing account.');
  console.log('PASS: fixture rollback preserves existing data');
  console.log('Database checks passed in isolated PGlite. Hosted Supabase/Auth checks remain separate.');
} catch (error) {
  console.error('Database checks failed:', error.message);
  if (error.code) console.error('Postgres error code:', error.code);
  if (error.where) console.error('Context:', error.where);
  process.exitCode = 1;
} finally {
  await database.close();
}
