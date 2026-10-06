import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectConfig, repositoryBase } from '../src/lib/config.js';
import { usernameToEmail } from '../src/lib/username.js';

const jwt = (role) => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;

test('username mapping is canonical and rejects ambiguous email inputs', () => {
  assert.equal(usernameToEmail('  ALEX  '), 'alex@reader.local');
  assert.equal(usernameToEmail('misha_8'), 'misha_8@reader.local');
  for (const invalid of ['', 'alex@elsewhere.com', 'a+b', '.alex', 'a b', 'a'.repeat(33)]) {
    assert.throws(() => usernameToEmail(invalid));
  }
});

test('Pages assets use the actual repository name including renamed repositories', () => {
  assert.equal(repositoryBase({}), '/family-reader/');
  assert.equal(repositoryBase({ VITE_REPO_NAME: 'reading-room' }), '/reading-room/');
  assert.equal(repositoryBase({ GITHUB_REPOSITORY: 'family/books', VITE_REPO_NAME: 'old-name' }), '/books/');
  assert.equal(repositoryBase({ GITHUB_REPOSITORY: 'family/family.github.io' }), '/');
  assert.throws(() => repositoryBase({ VITE_REPO_NAME: 'wrong/name' }));
});

test('missing, malformed and privileged frontend configuration is rejected', () => {
  const env = { VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: jwt('anon') };
  assert.equal(inspectConfig(env), null);
  assert.ok(inspectConfig({}));
  assert.ok(inspectConfig({ ...env, VITE_SUPABASE_URL: 'https://YOUR_PROJECT_REF.supabase.co' }));
  assert.ok(inspectConfig({ ...env, VITE_SUPABASE_URL: 'https://example.supabase.co/rest/v1' }));
  assert.ok(inspectConfig({ ...env, VITE_SUPABASE_ANON_KEY: jwt('service_role') }));
  assert.ok(inspectConfig({ ...env, VITE_SUPABASE_ANON_KEY: 'sb_secret_example' }));
  assert.ok(inspectConfig({ ...env, VITE_SUPABASE_ANON_KEY: 'not-a-key' }));
});
