-- Family Reader / Stage 1
-- Run this entire file in the SQL Editor of a dedicated Supabase project.
-- Re-running this migration is safe for this schema; it does not reset data.
begin;

create schema if not exists reader_private;
revoke all on schema reader_private from public, anon, authenticated;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80)
);

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('fb2', 'docx')),
  title text not null check (char_length(btrim(title)) > 0),
  author text,
  series text,
  series_index numeric,
  lang text,
  annotation text,
  file_path text not null unique check (char_length(btrim(file_path)) > 0),
  cover_path text,
  file_hash text not null unique check (file_hash ~ '^[a-f0-9]{64}$'),
  size_bytes bigint not null check (size_bytes > 0),
  uploaded_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.reading_progress (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  position jsonb not null default '{}'::jsonb check (jsonb_typeof(position) = 'object'),
  percent numeric not null default 0 check (percent between 0 and 100),
  device_label text,
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

create table if not exists public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  position jsonb not null check (jsonb_typeof(position) = 'object'),
  excerpt text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  device_class text not null check (device_class in ('phone', 'tablet', 'desktop')),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  primary key (user_id, device_class)
);

create index if not exists books_kind_created_at_idx on public.books(kind, created_at desc);
create index if not exists books_title_idx on public.books(lower(title));
create index if not exists books_author_idx on public.books(lower(author));
create index if not exists books_series_idx on public.books(series, series_index);
create index if not exists books_uploaded_by_idx on public.books(uploaded_by);
create index if not exists progress_user_updated_at_idx on public.reading_progress(user_id, updated_at desc);
create index if not exists progress_book_idx on public.reading_progress(book_id);
create index if not exists bookmarks_user_book_idx on public.bookmarks(user_id, book_id, created_at desc);
create index if not exists bookmarks_book_idx on public.bookmarks(book_id);

alter table public.profiles enable row level security;
alter table public.books enable row level security;
alter table public.reading_progress enable row level security;
alter table public.bookmarks enable row level security;
alter table public.user_settings enable row level security;

-- Explicit grants are required in addition to RLS. No signed-out table access.
revoke all on public.profiles, public.books, public.reading_progress, public.bookmarks, public.user_settings from anon, authenticated, public;
grant usage on schema public to authenticated;
grant select, insert, delete on public.books to authenticated;
grant select, insert, update, delete on public.profiles, public.reading_progress, public.bookmarks, public.user_settings to authenticated;
grant all on public.profiles, public.books, public.reading_progress, public.bookmarks, public.user_settings to service_role;

drop policy if exists books_read_family on public.books;
create policy books_read_family on public.books for select to authenticated using (true);
drop policy if exists books_insert_family on public.books;
create policy books_insert_family on public.books for insert to authenticated
  with check (uploaded_by = (select auth.uid()));
drop policy if exists books_delete_family on public.books;
create policy books_delete_family on public.books for delete to authenticated using (true);

-- WITH CHECK also prevents a user changing the owner of an existing row.
drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists progress_own on public.reading_progress;
create policy progress_own on public.reading_progress for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists bookmarks_own on public.bookmarks;
create policy bookmarks_own on public.bookmarks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists settings_own on public.user_settings;
create policy settings_own on public.user_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Create a private profile when an administrator adds a confirmed Auth user.
-- The function has no callable API grants and an empty search path.
create or replace function reader_private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
                  nullif(split_part(new.email, '@', 1), ''), 'Reader'), 80)
  ) on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function reader_private.handle_new_user() from public, anon, authenticated;
drop trigger if exists family_reader_create_profile on auth.users;
create trigger family_reader_create_profile after insert on auth.users
  for each row execute function reader_private.handle_new_user();

-- Also handle family accounts created before this migration.
insert into public.profiles (user_id, display_name)
select id, left(coalesce(nullif(btrim(raw_user_meta_data ->> 'display_name'), ''),
                        nullif(split_part(email, '@', 1), ''), 'Reader'), 80)
from auth.users on conflict (user_id) do nothing;

-- Storage object deletion must use the Storage API, never SQL DELETE.
-- Stage 2 will remove the file and optional cover when deleting a book.
-- The bucket accepts the browsers' differing FB2/DOCX MIME types.
insert into storage.buckets (id, name, public, file_size_limit)
values ('library', 'library', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists family_reader_storage_read on storage.objects;
create policy family_reader_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'library');
drop policy if exists family_reader_storage_insert on storage.objects;
create policy family_reader_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'library');
drop policy if exists family_reader_storage_delete on storage.objects;
create policy family_reader_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'library');

commit;
