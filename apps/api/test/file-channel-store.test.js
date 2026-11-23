import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { FileChannelStore, createFileChannelStore } from '../src/file-channel-store.js';
import { SecretBox } from '../src/channel-store.js';
import { ChannelStudio } from '../src/channel-studio.js';
import { InstagramLiveManager } from '../src/instagram-live.js';
import { assertValidConfiguration } from '../src/validation.js';

const STREAM_KEY = 'test-personal-stream-key-ABC123';
const TEST_KEY = 'a'.repeat(64);

test('file-backed channels work without MySQL and persist only encrypted secrets', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'streamforge-file-store-'));
  try {
    const env = { CHANNEL_STORAGE: 'file', LOCAL_ONLY_MODE: 'true', DATA_DIR: dataDir,
      MYSQL_DATABASE: '', CHANNEL_ENCRYPTION_KEY: '' };
    const store = await createFileChannelStore(env);
    const draft = await store.create();
    await store.saveStep(draft.id, 1, { displayName: 'ClueRipple Live', handle: '@ClueRipple' });
    await store.saveStep(draft.id, 2, { description: 'Licensed videos only', keywords: 'puzzles' });
    await store.saveStep(draft.id, 3, { streamKey: STREAM_KEY });
    await store.saveStep(draft.id, 4, { defaultTitle: 'Puzzle LIVE', privacy: 'private', loop: true });
    const ready = await store.complete(draft.id);
    assert.equal(ready.ready, true);
    assert.equal(ready.hasStreamKey, true);
    assert.equal(ready.streamKeySecret, undefined);
    const savedFile = path.join(dataDir, 'channels.json');
    const contents = await fs.readFile(savedFile, 'utf8');
    assert.equal(contents.includes(STREAM_KEY), false);
    const expectedMode = process.platform === 'win32' ? 0o666 : 0o600;
    assert.equal((await fs.stat(savedFile)).mode & 0o777, expectedMode);
    const second = await createFileChannelStore(env);
    assert.equal((await second.list()).length, 1);
    assert.equal((await second.getStreamKey(draft.id)), STREAM_KEY);
    await second.setOAuthAccount(draft.id, { refreshToken: 'private-refresh-token',
      channelId: 'UC' + 'b'.repeat(22), channelTitle: 'ClueRipple', description: 'Hello' });
    assert.equal((await fs.readFile(savedFile, 'utf8')).includes('private-refresh-token'), false);
    assert.equal((await (await createFileChannelStore(env)).getOAuthAccount(draft.id)).refreshToken, 'private-refresh-token');
    assert.equal((await second.getOAuthAccount(draft.id)).refreshToken, 'private-refresh-token');
    await second.clearOAuthAccount(draft.id);
    assert.equal(await (await createFileChannelStore(env)).getOAuthAccount(draft.id), null);
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('file mode provisions one ready channel from .env and keeps it after restart', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'streamforge-file-mode-'));
  try {
    const env = { CHANNEL_STORAGE: 'file', MULTI_CHANNEL_ENABLED: 'false', LOCAL_ONLY_MODE: 'true',
      DATA_DIR: dataDir, SINGLE_CHANNEL_NAME: 'My Game Stream', SINGLE_CHANNEL_STREAM_KEY: STREAM_KEY,
      SINGLE_CHANNEL_PRIVACY: 'unlisted', SINGLE_CHANNEL_DEFAULT_TITLE: 'Games LIVE' };
    assert.doesNotThrow(() => assertValidConfiguration({ ...env, LISTEN_HOST: '127.0.0.1', WEB_STATIC_DIR: './public' }));
    const store = await createFileChannelStore(env);
    const setup = new ChannelStudio({ store, env, dataDir, legacyManager: { getStatus: () => ({}) } });
    await setup.configureMode();
    assert.equal((await setup.visibleChannels()).length, 1);
    assert.equal((await setup.visibleChannels())[0].ready, true);
    assert.equal((await setup.visibleChannels())[0].privacy, 'unlisted');
    const reopened = await createFileChannelStore(env);
    const other = new ChannelStudio({ store: reopened, env, dataDir, legacyManager: { getStatus: () => ({}) } });
    await other.configureMode();
    assert.equal((await reopened.list()).length, 1);
    assert.equal(await reopened.getStreamKey(other.singleChannelId), STREAM_KEY);
    assert.equal((await reopened.list())[0].displayName, 'My Game Stream');
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('channel file rejects corruption, invalid changes, and wrong encryption keys without overwriting', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'streamforge-file-invalid-'));
  try {
    const filename = path.join(dir, 'channels.json');
    const store = new FileChannelStore(filename, new SecretBox(TEST_KEY));
    await store.initialize();
    const channel = await store.create();
    await assert.rejects(() => store.saveStep(channel.id, 3, { streamKey: 'bad' }), /valid YouTube stream key/);
    assert.equal((await store.get(channel.id)).wizardStep, 0);
    await assert.rejects(() => store.complete(channel.id), /Complete all four/);
    const before = await fs.readFile(filename, 'utf8');
    await fs.writeFile(filename, '{not-json');
    await assert.rejects(() => new FileChannelStore(filename, new SecretBox(TEST_KEY)).initialize(), /Could not load encrypted channel file/);
    assert.equal(await fs.readFile(filename, 'utf8'), '{not-json');
    await fs.writeFile(filename, before);
    const reloaded = new FileChannelStore(filename, new SecretBox(TEST_KEY));
    await reloaded.initialize();
    assert.equal((await reloaded.list()).length, 1);
    await reloaded.saveStep(channel.id, 3, { streamKey: STREAM_KEY });
    const wrongKey = new FileChannelStore(filename, new SecretBox('b'.repeat(64)));
    await wrongKey.initialize();
    await assert.rejects(() => wrongKey.getStreamKey(channel.id));
    assert.throws(() => assertValidConfiguration({ CHANNEL_STORAGE: 'file', MULTI_CHANNEL_ENABLED: 'true', LOCAL_ONLY_MODE: 'true', LISTEN_HOST: '127.0.0.1', WEB_STATIC_DIR: './public' }), /single-channel/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('file-backed Instagram settings and selected Reels playlist survive a restart', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'streamforge-file-reels-'));
  try {
    const env = { LOCAL_ONLY_MODE: 'true', CHANNEL_STORAGE: 'file', DATA_DIR: dataDir };
    const store = await createFileChannelStore(env);
    const channel = await store.create();
    const live = new InstagramLiveManager({ store, studio: {}, env });
    await live.initialize();
    const original = await live.getSettings(channel.id);
    assert.equal(original.sourceMode, 'browser');
    await live.saveSettings(channel.id, { ...original, title: 'My Reels', sourceMode: 'direct', streamResolution: '720x1280' });
    const first = await live.playlist.add(channel.id, { url: 'https://www.instagram.com/reel/ABCDE12345/', label: 'First' });
    assert.equal(first.length, 1);
    const second = await live.playlist.add(channel.id, { url: 'https://www.instagram.com/reel/ZYXWV54321/' });
    await assert.rejects(() => live.playlist.add(channel.id, { url: 'https://www.instagram.com/reel/ABCDE12345/' }), { status: 409 });
    await live.playlist.reorder(channel.id, [second[1].id, second[0].id]);
    const restoredStore = await createFileChannelStore(env);
    const restored = new InstagramLiveManager({ store: restoredStore, studio: {}, env });
    await restored.initialize();
    assert.equal((await restored.getSettings(channel.id)).title, 'My Reels');
    assert.equal((await restored.getSettings(channel.id)).streamResolution, '720x1280');
    const items = await restored.playlist.list(channel.id);
    assert.deepEqual(items.map((item) => item.shortcode), ['ZYXWV54321', 'ABCDE12345']);
    await restored.playlist.remove(channel.id, items[1].id);
    assert.equal((await (await createFileChannelStore(env)).listReels(channel.id)).length, 1);
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('full local server starts without MariaDB and exposes Instagram live controls', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'streamforge-file-api-'));
  const port = 43000 + Math.floor(Math.random() * 11000);
  const staticDir = path.join(dataDir, 'public');
  await fs.mkdir(staticDir);
  await fs.writeFile(path.join(staticDir, 'index.html'), 'StreamForge');
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, WEB_STATIC_DIR: staticDir,
      LISTEN_HOST: '127.0.0.1', LOCAL_ONLY_MODE: 'true', CHANNEL_STORAGE: 'file',
      MULTI_CHANNEL_ENABLED: 'false', MYSQL_DATABASE: '', YOUTUBE_STREAM_KEY: '',
      SINGLE_CHANNEL_NAME: 'ClueRipple Live', SINGLE_CHANNEL_STREAM_KEY: STREAM_KEY },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = `http://127.0.0.1:${port}`;
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(base + '/health', { signal: AbortSignal.timeout(350) });
        if (response.ok) { ready = true; break; }
      } catch { /* waiting for the process */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, `file-only API failed to start: ${stderr}`);
    const health = await (await fetch(base + '/health')).json();
    assert.equal(health.mysqlConfigured, false);
    assert.equal(health.channelStorage, 'file');
    const channels = await (await fetch(base + '/api/channels')).json();
    assert.equal(channels.configured, true);
    assert.equal(channels.channels.length, 1);
    assert.equal(channels.channels[0].ready, true);
    const id = channels.channels[0].id;
    const settings = await fetch(`${base}/api/instagram-live/${id}`);
    assert.equal(settings.status, 200);
    const playlist = await fetch(`${base}/api/instagram-live/${id}/playlist`);
    assert.equal(playlist.status, 200);
    assert.deepEqual((await playlist.json()).items, []);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else { child.once('close', resolve); setTimeout(resolve, 3500).unref(); }
    });
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
