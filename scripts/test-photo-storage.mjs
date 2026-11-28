import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Isolated SQL tests of the real migration. The Storage HTTP service is not
// simulated here; hosted upload/download testing remains a separate gate.
const db = new PGlite();
const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
const photo = `${a}/11111111-1111-4111-8111-111111111111.jpg`;
const otherPhoto = `${b}/22222222-2222-4222-8222-222222222222.jpg`;
let checks = 0;
async function rejected(sql, code) {
  await assert.rejects(db.exec(sql), error => error.code === code);
  checks += 1;
}
async function count(sql, expected) {
  const result = await db.query(sql);
  assert.equal(result.rows.length, expected);
  checks += 1;
  return result.rows;
}

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    grant usage on schema auth to anon, authenticated;
    create table auth.users (
      id uuid primary key, email text, raw_user_meta_data jsonb,
      raw_app_meta_data jsonb, created_at timestamptz, updated_at timestamptz
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create schema storage;
    create table storage.buckets (
      id text primary key, name text, public boolean default false,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text references storage.buckets(id), name text not null,
      unique(bucket_id, name)
    );
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated;
    grant all on storage.objects to anon, authenticated;
    -- Deliberately insecure pre-existing policies prove the bucket guard works.
    create policy unrelated_broad_policy on storage.objects
      for all to public using (true) with check (true);
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20261122000100_accounts_and_private_data.sql', import.meta.url), 'utf8'));
  await db.exec(`
    insert into auth.users (id) values ('${a}'), ('${b}');
    insert into public.collection_items (owner_id,name) values ('${a}', 'Existing note');
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20261128073948_private_coin_photos.sql', import.meta.url), 'utf8'));
  assert.deepEqual((await db.query(`select public,file_size_limit,allowed_mime_types from storage.buckets where id='coin-photos'`)).rows,
    [{ public: false, file_size_limit: 512000, allowed_mime_types: ['image/jpeg'] }]);
  checks += 1;
  await count(`select name from public.collection_items where name='Existing note' and photo_path is null`, 1);
  await db.exec(`
    insert into storage.buckets (id,name) values ('unrelated','unrelated');
    insert into storage.objects (bucket_id,name) values ('unrelated','unchanged.txt');
    set role authenticated;
    select set_config('request.jwt.claim.sub','${a}',false);
    insert into storage.objects (bucket_id,name) values ('coin-photos','${photo}');
  `);
  await count(`select * from storage.objects where bucket_id='coin-photos'`, 1);
  await rejected(`insert into storage.objects (bucket_id,name) values ('coin-photos','${otherPhoto}')`, '42501');
  await rejected(`insert into storage.objects (bucket_id,name) values ('coin-photos','${a}/../bad.jpg')`, '42501');
  await rejected(`insert into storage.objects (bucket_id,name) values ('coin-photos','${a}/33333333-3333-4333-8333-333333333333.svg')`, '42501');
  await db.exec(`insert into public.collection_items (owner_id,name,photo_path) values ('${a}','With photo','${photo}')`);
  await rejected(`insert into public.collection_items (owner_id,name,photo_path) values ('${a}','Stolen photo','${otherPhoto}')`, '23514');
  await rejected(`insert into public.collection_items (owner_id,name,photo_path) values ('${a}','Duplicate photo','${photo}')`, '23505');
  await count(`delete from storage.objects where bucket_id='coin-photos' returning name`, 0);
  await count(`update storage.objects set name='${a}/44444444-4444-4444-8444-444444444444.jpg' where bucket_id='coin-photos' returning name`, 0);
  await db.exec(`select set_config('request.jwt.claim.sub','${b}',false)`);
  await count(`select * from storage.objects where bucket_id='coin-photos'`, 0);
  await count(`delete from storage.objects where bucket_id='coin-photos' returning name`, 0);
  await rejected(`insert into storage.objects (bucket_id,name) values ('coin-photos','${photo}')`, '42501');
  await count(`select * from public.collection_items`, 0);
  await db.exec(`reset role; set role anon; select set_config('request.jwt.claim.sub','',false)`);
  await count(`select * from storage.objects where bucket_id='coin-photos'`, 0);
  await rejected(`insert into storage.objects (bucket_id,name) values ('coin-photos','${otherPhoto}')`, '42501');
  await count(`select * from storage.objects where bucket_id='unrelated'`, 1);
  await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${a}',false)`);
  await count(`delete from public.collection_items where photo_path='${photo}' returning id`, 1);
  await count(`delete from storage.objects where bucket_id='coin-photos' and name='${photo}' returning name`, 1);
  await count(`select * from public.collection_items where name='Existing note'`, 1);
  console.log(`PASS: ${checks} private-photo SQL checks (owner access, cross-account and anonymous rejection, path constraints, no overwrite, safe deletion, and existing data preservation).`);
} finally {
  await db.close();
}
