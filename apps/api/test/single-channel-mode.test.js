import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { ChannelStudio, registerChannelRoutes } from '../src/channel-studio.js';

function makeStore(initial = []) {
  const channels = initial.map((item) => ({ ...item }));
  const saved = [];
  return {
    channels, saved,
    list: async () => channels.map((channel) => ({ ...channel })),
    create: async () => {
      const channel = { id: '00000000-0000-4000-8000-000000000001', displayName: '', hasStreamKey: false,
        ready: false, loop: true, privacy: 'private', ingestUrl: 'rtmps://a.rtmps.youtube.com/live2' };
      channels.push(channel);
      return { ...channel };
    },
    saveStep: async (id, step, payload) => {
      saved.push({ id, step, payload });
      const channel = channels.find((item) => item.id === id);
      if (step === 1) Object.assign(channel, payload);
      if (step === 3) channel.hasStreamKey = Boolean(payload.streamKey || channel.hasStreamKey);
      if (step === 4) Object.assign(channel, payload);
      return { ...channel };
    },
    complete: async (id) => {
      const channel = channels.find((item) => item.id === id);
      channel.ready = true;
      return { ...channel };
    },
  };
}

function studio(store, env) {
  return new ChannelStudio({ store, dataDir: '/tmp/streamforge-test', env,
    legacyManager: { getStatus: () => ({ desiredRunning: false }) } });
}

test('single-channel mode selects one ready profile and preserves other profiles', async () => {
  const store = makeStore([
    { id: 'draft', ready: false, hasStreamKey: false },
    { id: 'ready', ready: true, hasStreamKey: true },
    { id: 'other-ready', ready: true, hasStreamKey: true },
  ]);
  const instance = studio(store, { MULTI_CHANNEL_ENABLED: 'false', MAX_CONCURRENT_STREAMS: '8' });
  await instance.configureMode();
  assert.equal(instance.maxStreams, 1);
  assert.equal(instance.singleChannelId, 'ready');
  assert.deepEqual((await instance.visibleChannels()).map((item) => item.id), ['ready']);
  assert.equal(store.channels.length, 3);
  assert.deepEqual(store.saved, []);
  await assert.rejects(() => instance.assertChannelAllowed('other-ready'), { status: 403 });
  await instance.assertChannelAllowed('ready');
});

test('single-channel env initializes a fresh channel and configures its stream settings', async () => {
  const store = makeStore();
  const instance = studio(store, { MULTI_CHANNEL_ENABLED: 'false', SINGLE_CHANNEL_NAME: 'ClueRipple Live',
    SINGLE_CHANNEL_STREAM_KEY: 'PRIVATE_TEST_STREAM_KEY', SINGLE_CHANNEL_DEFAULT_TITLE: 'Puzzle Live',
    SINGLE_CHANNEL_PRIVACY: 'private', SINGLE_CHANNEL_LOOP: 'false' });
  await instance.configureMode();
  assert.equal(store.channels.length, 1);
  assert.equal(store.channels[0].ready, true);
  assert.equal(store.channels[0].displayName, 'ClueRipple Live');
  assert.equal(store.channels[0].loop, false);
  assert.deepEqual(store.saved.map((item) => item.step), [1, 2, 3, 4]);
  assert.equal(store.saved[2].payload.streamKey, 'PRIVATE_TEST_STREAM_KEY');
  assert.equal((await instance.visibleChannels()).length, 1);
});

test('single-channel mode can target a specific existing channel ID', async () => {
  const store = makeStore([{ id: 'first', ready: true }, { id: 'second', ready: true }]);
  const instance = studio(store, { MULTI_CHANNEL_ENABLED: 'false', SINGLE_CHANNEL_ID: 'second' });
  await instance.configureMode();
  assert.equal(instance.singleChannelId, 'second');
  await assert.rejects(() => studio(store, { MULTI_CHANNEL_ENABLED: 'false',
    SINGLE_CHANNEL_ID: 'missing' }).configureMode(), /SINGLE_CHANNEL_ID/);
});

test('multichannel remains available by default and rejects invalid mode values', async () => {
  const store = makeStore([{ id: 'first' }, { id: 'second' }]);
  const instance = studio(store, { MAX_CONCURRENT_STREAMS: '3' });
  await instance.configureMode();
  assert.equal(instance.multiChannelEnabled, true);
  assert.equal(instance.maxStreams, 3);
  assert.equal((await instance.visibleChannels()).length, 2);
  await instance.assertChannelAllowed('second');
  assert.throws(() => studio(store, { MULTI_CHANNEL_ENABLED: 'maybe' }), /MULTI_CHANNEL_ENABLED/);
});

test('single-channel API exposes only the selected channel and rejects new/hidden channels', async (t) => {
  const store = makeStore([{ id: 'primary', ready: true, hasStreamKey: false },
    { id: 'hidden', ready: true, hasStreamKey: false }]);
  const instance = studio(store, { MULTI_CHANNEL_ENABLED: 'false', SINGLE_CHANNEL_ID: 'primary' });
  await instance.configureMode();
  const app = express();
  app.use(express.json());
  registerChannelRoutes(app, { store, studio: instance, maxBytes: 1024 });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const listResponse = await fetch(`${base}/api/channels`);
  const listed = await listResponse.json();
  assert.equal(listed.multiChannelEnabled, false);
  assert.equal(listed.maxConcurrentStreams, 1);
  assert.deepEqual(listed.channels.map((channel) => channel.id), ['primary']);
  assert.equal((await fetch(`${base}/api/channels`, { method: 'POST' })).status, 409);
  assert.equal((await fetch(`${base}/api/channels/hidden`)).status, 403);
});
