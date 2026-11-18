import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { YouTubeAutomation, validateBroadcast, validateImage } from '../src/youtube-automation.js';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
const image = { buffer: png, mimetype: 'image/png' };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test('validates live metadata and image signatures before API calls', () => {
  assert.deepEqual(validateBroadcast({ title: '  My live  ', privacy: 'private' }), { title: 'My live', description: '', privacy: 'private' });
  assert.throws(() => validateBroadcast({ title: '', privacy: 'public' }), /title/);
  assert.throws(() => validateBroadcast({ title: 'Hello', privacy: 'friends' }), /privacy/);
  assert.throws(() => validateBroadcast({ title: 'Hi', description: 'x'.repeat(5001) }), /Description/);
  assert.doesNotThrow(() => validateImage(image));
  assert.throws(() => validateImage({ buffer: Buffer.from('not a png'), mimetype: 'image/png' }), /real JPG or PNG/);
});

test('Google OAuth connects the channel and creates a YouTube live with a thumbnail', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'streamforge-youtube-'));
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    calls.push({ href, options });
    if (href.includes('oauth2.googleapis.com/token')) {
      const grant = String(options.body.get('grant_type'));
      if (grant === 'authorization_code') return json({ access_token: 'access-1', refresh_token: 'refresh-secret', expires_in: 3600 });
      return json({ access_token: 'access-2', expires_in: 3600 });
    }
    if (href.includes('/channels?part=snippet,brandingSettings')) {
      return json({ items: [{ id: 'channel-123', snippet: { title: 'My Test Channel' }, brandingSettings: { channel: { title: 'My Test Channel', description: 'Before', keywords: 'music relaxation' }, image: { bannerExternalUrl: 'old-banner' } } }] });
    }
    if (href.includes('/liveStreams?')) return json({ items: [{ id: 'stream-999', cdn: { ingestionInfo: { streamName: 'reusable-123' } } }] });
    if (href.includes('/liveBroadcasts?')) return json({ id: 'new-video-99' });
    if (href.includes('/liveBroadcasts/bind?')) return json({ id: 'new-video-99' });
    if (href.includes('/thumbnails/set?')) return json({ items: [] });
    if (href.includes('/channelBanners/insert?')) return json({ url: 'uploaded-banner-url' });
    if (href.includes('/channels?part=brandingSettings')) return json({ id: 'channel-123' });
    throw new Error(`Unexpected YouTube request: ${href}`);
  };

  try {
    const service = new YouTubeAutomation({
      dataDir: dir, clientId: 'test-client', clientSecret: 'test-secret',
      streamKey: 'reusable-123', fetchImpl,
    });
    await service.initialize();
    assert.equal(service.status().configured, true);
    assert.equal(service.status().connected, false);
    const authorize = new URL(service.authorize());
    const state = authorize.searchParams.get('state');
    assert.equal(authorize.searchParams.get('redirect_uri'), 'http://127.0.0.1:4000/api/youtube/oauth/callback');
    assert.equal(authorize.searchParams.get('scope'), 'https://www.googleapis.com/auth/youtube');
    await assert.rejects(service.exchangeCode('auth-code', 'bad-state'), /Invalid or expired/);

    const goodState = new URL(service.authorize()).searchParams.get('state');
    const connected = await service.exchangeCode('auth-code', goodState);
    assert.equal(connected.connected, true);
    assert.equal(connected.channel, 'My Test Channel');
    const stored = JSON.parse(await fs.readFile(path.join(dir, 'youtube-oauth.json'), 'utf8'));
    assert.equal(stored.refreshToken, 'refresh-secret');
    const fileStat = await fs.stat(path.join(dir, 'youtube-oauth.json'));
    assert.equal(fileStat.mode & 0o777, 0o600);

    const broadcast = await service.createBroadcast({ title: ' My first live ', description: 'Hello!', privacy: 'unlisted' }, image);
    assert.deepEqual(broadcast, {
      id: 'new-video-99', title: 'My first live', url: 'https://www.youtube.com/watch?v=new-video-99', thumbnailSet: true,
    });
    const createCall = calls.find((c) => c.href.includes('/liveBroadcasts?'));
    const metadata = JSON.parse(createCall.options.body);
    assert.equal(metadata.status.privacyStatus, 'unlisted');
    assert.equal(metadata.contentDetails.enableAutoStart, true);
    assert.equal(metadata.snippet.title, 'My first live');
    assert.match(calls.find((c) => c.href.includes('/liveBroadcasts/bind?')).href, /streamId=stream-999/);
    const thumbCall = calls.find((c) => c.href.includes('/thumbnails/set?'));
    assert.deepEqual(thumbCall.options.body, png);
    assert.equal(thumbCall.options.headers.Authorization, 'Bearer access-1');

    const updated = await service.updateChannel({ description: 'New channel description', banner: image });
    assert.equal(updated.description, 'New channel description');
    const channelUpdate = JSON.parse(calls.find((c) => c.href.includes('/channels?part=brandingSettings')).options.body);
    assert.equal(channelUpdate.brandingSettings.channel.description, 'New channel description');
    assert.equal(channelUpdate.brandingSettings.channel.keywords, 'music relaxation');
    assert.equal(channelUpdate.brandingSettings.channel.title, undefined, 'API forbids changing channel title');
    assert.equal(channelUpdate.brandingSettings.image.bannerExternalUrl, 'uploaded-banner-url');

    const restored = new YouTubeAutomation({ dataDir: dir, clientId: 'test-client', clientSecret: 'test-secret', streamKey: 'reusable-123', fetchImpl });
    await restored.initialize();
    assert.equal(restored.status().channel, 'My Test Channel');
    assert.equal(restored.status().connected, true);
    await restored.disconnect();
    assert.equal(restored.status().connected, false);
    await assert.rejects(fs.access(path.join(dir, 'youtube-oauth.json')), /ENOENT/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('YouTube live creation stops before creating a broadcast when stream key is not reusable', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'streamforge-youtube-missing-'));
  const paths = [];
  try {
    const service = new YouTubeAutomation({
      dataDir: dir, clientId: 'id', clientSecret: 'secret', streamKey: 'wrong-key',
      fetchImpl: async (url) => {
        paths.push(String(url));
        if (String(url).includes('/token')) return json({ access_token: 'active', expires_in: 3600 });
        return json({ items: [] });
      },
    });
    service.account = { refreshToken: 'refresh' };
    await assert.rejects(service.createBroadcast({ title: 'Live now', privacy: 'private' }), /stream key was not found/);
    assert.equal(paths.some((value) => value.includes('/liveBroadcasts')), false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
