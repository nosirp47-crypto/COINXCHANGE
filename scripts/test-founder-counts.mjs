import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const founder = '00000000-0000-4000-8000-000000000001';
const ordinary = '00000000-0000-4000-8000-000000000002';
let checks = 0;
async function denied(sql) {
  await assert.rejects(db.exec(sql), error => error.code === '42501');
  checks += 1;
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
      raw_app_meta_data jsonb, created_at timestamptz, updated_at timestamptz,
      deleted_at timestamptz, email_confirmed_at timestamptz, is_anonymous boolean default false
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true), '')::uuid;
    $$;
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20261122000100_accounts_and_private_data.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20261128074147_founder_signup_counts.sql', import.meta.url), 'utf8'));
  assert.equal((await db.query('select * from coinxchange_private.founder_members')).rows.length, 0);
  checks += 1;
  await db.exec(`
    insert into auth.users(id,email,created_at,email_confirmed_at,raw_user_meta_data) values
      ('${founder}','founder@example.test',now()-interval '60 days',now(),'{"role":"founder"}'),
      ('${ordinary}','ordinary@example.test',now()-interval '2 days',now(),'{"role":"founder","is_admin":true}'),
      ('00000000-0000-4000-8000-000000000003','pending@example.test',now()-interval '10 days',null,'{}'),
      ('00000000-0000-4000-8000-000000000004','recent@example.test',now()-interval '1 day',now(),'{}'),
      ('00000000-0000-4000-8000-000000000005','',now(),now(),'{}'),
      ('00000000-0000-4000-8000-000000000006','anonymous@example.test',now(),now(),'{}'),
      ('00000000-0000-4000-8000-000000000007','deleted@example.test',now(),now(),'{}');
    update auth.users set is_anonymous=true where id='00000000-0000-4000-8000-000000000006';
    update auth.users set deleted_at=now() where id='00000000-0000-4000-8000-000000000007';
    set role anon;
  `);
  await denied('select * from public.founder_signup_counts()');
  await denied('select * from coinxchange_private.read_founder_signup_counts()');
  await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${founder}',false)`);
  await denied('select * from public.founder_signup_counts()');
  await denied(`insert into coinxchange_private.founder_members(user_id) values('${founder}')`);
  await denied('select * from coinxchange_private.founder_members');
  await denied('select * from auth.users');
  await db.exec(`reset role; insert into coinxchange_private.founder_members(user_id) values('${founder}'); set role authenticated;
    select set_config('request.jwt.claim.sub','${ordinary}',false)`);
  await denied('select * from public.founder_signup_counts()');
  await denied('select * from coinxchange_private.read_founder_signup_counts()');
  await db.exec(`select set_config('request.jwt.claim.sub','${founder}',false)`);
  const { rows: [totals] } = await db.query('select * from public.founder_signup_counts()');
  assert.deepEqual(Object.keys(totals).sort(), ['as_of','confirmed_members','joined_last_30_days','joined_last_7_days','total_members']);
  assert.deepEqual({ ...totals, as_of: null }, {
    total_members: 4, confirmed_members: 3, joined_last_7_days: 2, joined_last_30_days: 3, as_of: null
  });
  assert.ok(Number.isFinite(new Date(totals.as_of).getTime()));
  checks += 3;
  await db.exec(`reset role; update auth.users set email_confirmed_at=null where id='${founder}'; set role authenticated;`);
  await denied('select * from public.founder_signup_counts()');
  await db.exec(`reset role; update auth.users set email_confirmed_at=now(), deleted_at=now() where id='${founder}'; set role authenticated;`);
  await denied('select * from public.founder_signup_counts()');
  await db.exec(`reset role; update auth.users set deleted_at=null where id='${founder}'; delete from coinxchange_private.founder_members; set role authenticated;`);
  await denied('select * from public.founder_signup_counts()');
  const { rows } = await db.query(`select p.prosecdef, n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.proname in ('founder_signup_counts','read_founder_signup_counts') order by p.prosecdef`);
  assert.deepEqual(rows, [{ prosecdef: false, nspname: 'public' }, { prosecdef: true, nspname: 'coinxchange_private' }]);
  checks += 1;
  console.log(`PASS: ${checks} founder-count SQL checks (deny by default, metadata spoof rejection, private allowlist, accurate aggregate-only totals, revocation, and narrow function privileges).`);
} finally { await db.close(); }
