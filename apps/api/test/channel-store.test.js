import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ChannelError, SecretBox, validateChannelStep, ChannelStore, resolveChannelEncryptionKey } from '../src/channel-store.js';

const KEY = 'a'.repeat(64);

test('private Android server creates and reuses an encryption key without login setup', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'streamforge-private-key-'));
  try {
    const env = { LOCAL_ONLY_MODE: 'true', DATA_DIR: dir, CHANNEL_ENCRYPTION_KEY: 'YOUR_GENERATED_64_CHARACTER_KEY' };
    const key = await resolveChannelEncryptionKey(env);
    assert.match(key, /^[a-f0-9]{64}$/);
    assert.equal(await resolveChannelEncryptionKey({ ...env, CHANNEL_ENCRYPTION_KEY: '' }), key);
    assert.equal((await fs.stat(path.join(dir, 'channel-encryption.key'))).mode & 0o777, 0o600);
    assert.equal(await resolveChannelEncryptionKey({ ...env, CHANNEL_ENCRYPTION_KEY: KEY }), KEY);
    assert.equal(await resolveChannelEncryptionKey({ LOCAL_ONLY_MODE: 'false' }), '');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('encrypts stream keys with authenticated encryption and never stores plaintext', () => {
  const box = new SecretBox(KEY);
  const secret = 'abc0-qw_very-private-stream-key';
  const encrypted = box.encrypt(secret);
  assert.equal(encrypted.includes(secret), false);
  assert.equal(box.decrypt(encrypted), secret);
  assert.notEqual(box.encrypt(secret), encrypted);
  assert.throws(() => new SecretBox('111'), /CHANNEL_ENCRYPTION_KEY/);
  assert.throws(() => new SecretBox('b'.repeat(64)).decrypt(encrypted));
});

test('each wizard step validates its own data and rejects invalid ingest servers', () => {
  assert.equal(validateChannelStep(1, { displayName: 'ClueRipple Live', handle: '@ClueRipple' }).handle, 'ClueRipple');
  assert.throws(() => validateChannelStep(1, { displayName: '' }), ChannelError);
  assert.throws(() => validateChannelStep(1, { displayName: 'A', channelUrl: 'https://evil.example/' }), /youtube.com/);
  assert.throws(() => validateChannelStep(3, { streamKey: 'valid1234', ingestUrl: 'rtmps://attacker.example/live2' }), /official YouTube/);
  assert.equal(validateChannelStep(3, { streamKey: 'valid1234' }).ingestUrl, 'rtmps://a.rtmps.youtube.com/live2');
  assert.equal(validateChannelStep(3, {}, true).streamKey, '');
  assert.throws(() => validateChannelStep(4, { loop: 'yes' }), /loop/);
  assert.equal(validateChannelStep(4, { loop: true }).privacy, 'private');
});

test('channel listing quotes the MariaDB reserved LOOP alias', async () => {
  let query = '';
  const pool = { async execute(sql) { query = sql; return [[{ id: 'test', loop: 1, createdAt: new Date(), updatedAt: new Date() }]]; } };
  const result = await new ChannelStore(pool, new SecretBox(KEY)).list();
  assert.match(query, /loop_video AS `loop`/);
  assert.equal(result[0].loop, true);
});

test('database write uses whitelisted columns and binds secret values', async () => {
  const calls = [];
  const row = {
    id: 'c4b7751a-8072-4b5a-95ae-17348e1f177b', displayName: 'ClueRipple',
    streamKeySecret: null, oauthRefreshSecret: null, wizardStep: 0,
    createdAt: new Date(), updatedAt: new Date(), completedAt: null, loop: 1,
  };
  const pool = { async execute(sql, params) {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT')) return [[row]];
    return [{ affectedRows: 1 }];
  } };
  const store = new ChannelStore(pool, new SecretBox(KEY));
  await store.saveStep(row.id, 3, { streamKey: 'valid-private-key', ingestUrl: 'rtmps://a.rtmps.youtube.com/live2' });
  const updated = calls.find((call) => call.sql.startsWith('UPDATE'));
  assert.match(updated.sql, /stream_key_secret = \?/);
  assert.equal(updated.sql.includes('valid-private-key'), false);
  assert.equal(updated.params.some((param) => String(param).includes('valid-private-key')), false);
  assert.equal(updated.params.at(-1), row.id);
});
