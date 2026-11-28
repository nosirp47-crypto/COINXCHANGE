-- Add private photographs without moving or rewriting existing collection data.
-- Deploy to the isolated staging project first. Production requires approval.
begin;

alter table public.collection_items add column photo_path text;
alter table public.collection_items add constraint collection_items_photo_path_owner
  check (photo_path is null or photo_path ~ (
    '^' || owner_id::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
  ));

-- A photo belongs to one collection record, so removing one record cannot
-- accidentally remove another record's image.
create unique index collection_items_photo_path_unique
  on public.collection_items (photo_path) where photo_path is not null;

grant insert (photo_path), update (photo_path)
  on public.collection_items to authenticated;
comment on column public.collection_items.photo_path is
  'Private coin-photos object path: owner UUID/random UUID.jpg. Never a public or signed URL.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('coin-photos', 'coin-photos', false, 512000, array['image/jpeg']);

-- The guard also covers unrelated pre-existing permissive Storage policies.
-- It has no effect on other buckets. No SECURITY DEFINER helpers are needed.
create policy coin_photos_owner_guard on storage.objects
as restrictive for all to public
using (
  bucket_id <> 'coin-photos' or (
    (select auth.uid()) is not null and
    name ~ ('^' || (select auth.uid())::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
  )
)
with check (
  bucket_id <> 'coin-photos' or (
    (select auth.uid()) is not null and
    name ~ ('^' || (select auth.uid())::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
  )
);

create policy coin_photos_insert_own on storage.objects
for insert to authenticated
with check (bucket_id = 'coin-photos');

create policy coin_photos_select_own on storage.objects
for select to authenticated
using (bucket_id = 'coin-photos');

-- New uploads always use a unique filename. Replacing an existing object is
-- deliberately unavailable, even if another bucket has a broad UPDATE policy.
create policy coin_photos_no_overwrite on storage.objects
as restrictive for update to public
using (bucket_id <> 'coin-photos')
with check (bucket_id <> 'coin-photos');

create policy coin_photos_delete_unreferenced on storage.objects
for delete to authenticated
using (bucket_id = 'coin-photos');

-- Delete the collection record before its photo. This also prevents cleanup
-- after a lost insert response from removing an image that was actually saved.
create policy coin_photos_keep_referenced on storage.objects
as restrictive for delete to public
using (bucket_id <> 'coin-photos' or not exists (
  select 1 from public.collection_items
  where collection_items.photo_path = objects.name
));

commit;
