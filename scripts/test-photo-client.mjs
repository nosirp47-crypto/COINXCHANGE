import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPhotoStore, COIN_PHOTO_MAX_BYTES } from '../coinxchange/collection-photos.js';

const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const path = owner + '/11111111-1111-4111-8111-111111111111.jpg';
const bytes = new Uint8Array([255,216,255,224,1,2,3,255,217]);
const jpeg = new Blob([bytes], { type: 'image/jpeg' });
const dataUrl = 'data:image/jpeg;base64,' + Buffer.from(bytes).toString('base64');
const row = { id: 'coin-id', owner_id: owner, name: 'Saved penny', photo_path: path };
const makeStore = methods => createPhotoStore({ storage: { from(bucket) {
  assert.equal(bucket, 'coin-photos');
  return methods;
} } });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('upload stores a bounded JPEG under the owner and a fresh identifier', async () => {
  let saved;
  const store = makeStore({ async upload(p, blob, options) {
    saved = { path: p, blob, options };
    return { data: { path: p }, error: null };
  } });
  const result = await store.upload(owner, dataUrl);
  assert.match(result, new RegExp('^' + owner + '/[0-9a-f-]{36}\\.jpg$'));
  assert.equal(saved.blob.type, 'image/jpeg');
  assert.deepEqual(new Uint8Array(await saved.blob.arrayBuffer()), bytes);
  assert.deepEqual(saved.options, { contentType: 'image/jpeg', cacheControl: '0', upsert: false });
});

test('invalid, oversized and executable image payloads never reach Storage', async () => {
  let writes = 0;
  const store = makeStore({ async upload() { writes++; } });
  for (const value of ['https://foreign.test/photo.jpg', 'data:image/svg+xml;base64,AAAA',
    'data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,@@@=',
    'data:image/jpeg;base64,' + 'A'.repeat(Math.ceil(COIN_PHOTO_MAX_BYTES / 3) * 4 + 4)]) {
    await assert.rejects(store.upload(owner, value));
  }
  await assert.rejects(store.upload('../' + owner, dataUrl));
  assert.equal(writes, 0);
});

test('private photos use authenticated download with no-store and in-memory URLs', async () => {
  const store = makeStore({ async download(p, options, fetchOptions) {
    assert.equal(p, path);
    assert.deepEqual(fetchOptions, { cache: 'no-store' });
    return { data: jpeg, error: null };
  } });
  const [result] = await store.hydrate([row], owner);
  assert.match(result.photoUrl, /^blob:/);
  assert.equal(result.photoUnavailable, false);
  assert.equal((await fetch(result.photoUrl)).status, 200);
  store.clear();
  await assert.rejects(fetch(result.photoUrl));
});

test('untrusted owner paths and download failures keep details and show photo unavailable', async () => {
  let downloads = 0;
  const store = makeStore({ async download() { downloads++; return { error: new Error('Denied') }; } });
  const rows = await store.hydrate([
    { ...row, photo_path: path.replace(owner, other) },
    { ...row, owner_id: other },
    { ...row, photo_path: 'https://foreign.test/pixel' },
    row,
    { ...row, photo_path: null }
  ], owner);
  assert.equal(downloads, 1);
  assert.equal(rows.length, 5);
  assert.ok(rows.slice(0, 4).every(item => item.name === 'Saved penny' && item.photoUnavailable && !item.photoUrl));
  assert.equal(rows[4].photoUnavailable, false);
});

test('sign-out during a download prevents stale photo URLs', async () => {
  const pending = deferred();
  const store = makeStore({ download: () => pending.promise });
  const task = store.hydrate([row], owner);
  store.clear();
  pending.resolve({ data: jpeg, error: null });
  const [result] = await task;
  assert.equal(result.photoUrl, null);
  assert.equal(result.photoUnavailable, true);
});

test('a newer collection load invalidates an older in-flight load', async () => {
  const pending = deferred();
  let calls = 0;
  const store = makeStore({ download: () => ++calls === 1 ? pending.promise : Promise.resolve({ data: jpeg }) });
  const first = store.hydrate([row], owner);
  const second = await store.hydrate([row], owner);
  pending.resolve({ data: jpeg });
  const old = await first;
  assert.equal(old[0].photoUrl, null);
  assert.match(second[0].photoUrl, /^blob:/);
  store.clear();
});

test('account change during upload prevents subsequent use of its path', async () => {
  const pending = deferred();
  let uploadedPath;
  const store = makeStore({ upload: p => { uploadedPath = p; return pending.promise; } });
  const task = store.upload(owner, dataUrl);
  store.clear();
  pending.resolve({ data: { path: uploadedPath }, error: null });
  await assert.rejects(task, /account changed/);
});

test('removal rejects foreign paths and unconfirmed or denied deletes', async () => {
  let calls = 0;
  const store = makeStore({ async remove(paths) {
    calls++;
    assert.deepEqual(paths, [path]);
    return { data: calls === 1 ? [] : [{ name: path }], error: null };
  } });
  await assert.rejects(store.remove(path, other), /does not belong/);
  await assert.rejects(store.remove(path, owner), /could not be confirmed/);
  await store.remove(path, owner);
  assert.equal(calls, 2);
});
