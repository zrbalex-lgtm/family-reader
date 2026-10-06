import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Use real Postgres execution for grants, RLS, triggers, constraints and cascades.
// Only Supabase-owned auth/storage tables and auth.uid() are minimal fixtures.
test('schema enforces family access and individual privacy', async (t) => {
  const db = new PGlite();
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';
  const book = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      create schema storage;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated;
      grant select, insert, update, delete on storage.objects to anon, authenticated;
      insert into auth.users (id, email) values ('${a}', 'alex@reader.local');
    `);
    const migration = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [b, 'olga@reader.local', { display_name: 'Olga' }]);

    async function asUser(id) {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id || '']);
      await db.exec(`set role ${id ? 'authenticated' : 'anon'}`);
    }

    await t.test('profile backfill and new-user trigger work; other profiles stay private', async () => {
      await asUser(a);
      assert.deepEqual((await db.query('select display_name from public.profiles')).rows, [{ display_name: 'alex' }]);
      await asUser(b);
      assert.deepEqual((await db.query('select display_name from public.profiles')).rows, [{ display_name: 'Olga' }]);
      await assert.rejects(db.query('update public.profiles set user_id = $1 where user_id = $2', [a, b]));
      await assert.rejects(db.exec('select reader_private.handle_new_user()'));
    });

    await t.test('authenticated users can add shared books without spoofing the uploader', async () => {
      await asUser(a);
      await db.query('insert into public.books (id, kind, title, file_path, file_hash, size_bytes) values ($1, $2, $3, $4, $5, $6)', [book, 'fb2', 'Test book', 'books/test.fb2', 'a'.repeat(64), 100]);
      await asUser(b);
      assert.equal((await db.query('select * from public.books')).rows.length, 1);
      await assert.rejects(db.query('insert into public.books (kind, title, file_path, file_hash, size_bytes, uploaded_by) values ($1,$2,$3,$4,$5,$6)', ['fb2', 'Spoofed', 'books/spoof.fb2', 'b'.repeat(64), 100, a]));
      await assert.rejects(db.exec("update public.books set title = 'Changed'"));
      await assert.rejects(db.query('insert into public.books (kind, title, file_path, file_hash, size_bytes) values ($1,$2,$3,$4,$5)', ['fb2', 'Duplicate', 'books/duplicate.fb2', 'a'.repeat(64), 100]));
    });

    await t.test('progress, bookmarks and device settings are private on all write paths', async () => {
      for (const id of [a, b]) {
        await asUser(id);
        await db.query('insert into public.reading_progress (book_id, position, percent) values ($1,$2,$3)', [book, { section: 0, paragraph: 5, charOffset: 0 }, 20]);
        await db.query('insert into public.bookmarks (book_id, position) values ($1,$2)', [book, { section: 0, paragraph: 5, charOffset: 0 }]);
        await db.exec("insert into public.user_settings (device_class, settings) values ('phone', '{\"fontSize\":18}')");
      }
      await asUser(a);
      for (const table of ['reading_progress', 'bookmarks', 'user_settings', 'profiles']) {
        const result = await db.query(`select user_id from public.${table}`);
        assert.deepEqual(result.rows, [{ user_id: a }]);
        assert.equal((await db.query(`update public.${table} set user_id = user_id where user_id = $1 returning user_id`, [b])).rows.length, 0);
        assert.equal((await db.query(`delete from public.${table} where user_id = $1 returning user_id`, [b])).rows.length, 0);
        await assert.rejects(db.query(`update public.${table} set user_id = $1 where user_id = $2`, [b, a]));
      }
      await assert.rejects(db.query('insert into public.reading_progress (user_id, book_id) values ($1,$2)', [b, book]));
      await assert.rejects(db.query('insert into public.bookmarks (user_id, book_id, position) values ($1,$2,$3)', [b, book, {}]));
      await assert.rejects(db.query('insert into public.user_settings (user_id, device_class) values ($1,$2)', [b, 'tablet']));
      await assert.rejects(db.exec("insert into public.user_settings (device_class) values ('watch')"));
      await assert.rejects(db.exec('update public.reading_progress set percent = 101'));
      await db.exec('update public.reading_progress set percent = 30');
      assert.equal((await db.query('select percent from public.reading_progress')).rows[0].percent, '30');
    });

    await t.test('Storage policies allow only private library reads, uploads and deletes', async () => {
      await asUser(a);
      await db.exec("insert into storage.objects (bucket_id, name) values ('library', 'books/test.fb2')");
      await assert.rejects(db.exec("insert into storage.objects (bucket_id, name) values ('other', 'private.txt')"));
      assert.equal((await db.query("update storage.objects set name = 'overwritten' returning id")).rows.length, 0);
      await asUser(null);
      assert.equal((await db.query('select * from storage.objects')).rows.length, 0);
      await assert.rejects(db.exec("insert into storage.objects (bucket_id, name) values ('library', 'anonymous.fb2')"));
      assert.equal((await db.query('delete from storage.objects returning id')).rows.length, 0);
      await asUser(b);
      assert.equal((await db.query('select * from storage.objects')).rows.length, 1);
      assert.equal((await db.query('delete from storage.objects returning id')).rows.length, 1);
    });

    await t.test('signed-out users cannot access application tables', async () => {
      await asUser(null);
      for (const table of ['books', 'profiles', 'reading_progress', 'bookmarks', 'user_settings']) {
        await assert.rejects(db.exec(`select * from public.${table}`));
        await assert.rejects(db.exec(`delete from public.${table}`));
      }
    });

    await t.test('any family member can delete a book, cascading both users’ personal rows', async () => {
      await asUser(b);
      assert.equal((await db.query('delete from public.books where id = $1 returning id', [book])).rows.length, 1);
      await db.exec('reset role');
      assert.equal((await db.query('select * from public.reading_progress')).rows.length, 0);
      assert.equal((await db.query('select * from public.bookmarks')).rows.length, 0);
      assert.equal((await db.query("select public from storage.buckets where id = 'library'")).rows[0].public, false);
    });
  } finally { await db.close(); }
});
