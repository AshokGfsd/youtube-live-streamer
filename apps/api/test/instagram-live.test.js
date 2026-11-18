import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { InstagramLiveManager, buildInstagramFfmpegArgs, validateInstagramSettings } from '../src/instagram-live.js';

test('validates capture dimensions, scroll method, and rights settings', () => {
  assert.equal(validateInstagramSettings({}).audio, 'silent');
  assert.equal(validateInstagramSettings({ scroll: 'arrow', captureWidth: 320 }).scroll, 'arrow');
  assert.throws(() => validateInstagramSettings({ captureWidth: 321 }), /even numbers/);
  assert.throws(() => validateInstagramSettings({ privacy: 'unknown' }), /privacy/);
  assert.throws(() => validateInstagramSettings({ captureX: -1 }), /captureX/);
  assert.throws(() => validateInstagramSettings({ audio: 'microphone' }), /Audio/);
  assert.throws(() => validateInstagramSettings({ createBroadcast: 'false' }), /automatic broadcast/);
});

test('FFmpeg captures X11 and outputs safe YouTube RTMPS with silent audio', () => {
  const args = buildInstagramFfmpegArgs({ captureWidth: 540, captureHeight: 960, fps: 15, audio: 'silent' },
    'rtmps://a.rtmps.youtube.com/live2', 'test-stream-key');
  assert.deepEqual(args.slice(args.indexOf('-video_size'), args.indexOf('-video_size') + 4),
    ['-video_size', '540x960', '-i', ':1.0+0,0']);
  assert.equal(args.at(-1), 'rtmps://a.rtmps.youtube.com/live2/test-stream-key');
  assert.ok(args.includes('anullsrc=channel_layout=stereo:sample_rate=44100'));
  assert.ok(args.includes('libx264'));
  assert.equal(args[args.indexOf('-r') + 1], '15');
});

test('PulseAudio input is passed as raw PCM through a local pipe', () => {
  const args = buildInstagramFfmpegArgs({ audio: 'pulse', scroll: 'arrow' },
    'rtmps://a.rtmps.youtube.com/live2', 'key', ':2');
  assert.ok(args.includes('pipe:0'));
  assert.equal(args[args.indexOf('-i') + 1], ':2.0+0,0');
});

test('start requires explicit rights and releases browser and FFmpeg on stop', async () => {
  let child;
  let controllerStopped = false;
  const manager = new InstagramLiveManager({
    store: {
      pool: { execute: async () => [[{ settings_json: null }]] },
      get: async () => ({ completedAt: new Date(), streamKeySecret: 'encrypted', ingestUrl: 'rtmps://a.rtmps.youtube.com/live2' }),
      getPublic: async () => ({ defaultTitle: '', defaultDescription: '', privacy: 'private' }),
      getStreamKey: async () => 'private-stream-key',
    },
    studio: { runningCount: () => 0, maxStreams: 1 },
    makeController: () => ({ connect: async () => ({ activeId: 1, phase: 'playing' }), run: async () => {},
      stop: async () => { controllerStopped = true; } }),
    spawnProcess: (name, args) => {
      assert.equal(name, 'ffmpeg');
      assert.equal(args.at(-1), 'rtmps://a.rtmps.youtube.com/live2/private-stream-key');
      child = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => { child.emit('exit', 0); };
      process.nextTick(() => child.emit('spawn'));
      return child;
    },
  });
  await assert.rejects(() => manager.start('id', false), /rights/);
  const live = await manager.start('id', true);
  assert.equal(live.running, true);
  assert.equal(live.activeChannelId, 'id');
  assert.equal(live.broadcast, null);
  child.stderr.emit('data', 'Failed connection: rtmps://a.rtmps.youtube.com/live2/private-stream-key\n');
  assert.ok(!JSON.stringify(manager.getStatus()).includes('private-stream-key'));
  await manager.stop();
  assert.equal(manager.getStatus().running, false);
  assert.equal(controllerStopped, true);
});
