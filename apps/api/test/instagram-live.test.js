import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { InstagramLiveManager, buildInstagramFfmpegArgs, reelCaptureCrop, validateInstagramSettings } from '../src/instagram-live.js';

test('validates capture dimensions, scroll method, and rights settings', () => {
  assert.equal(validateInstagramSettings({}).audio, 'silent');
  assert.equal(validateInstagramSettings({}).mobileLayout, true);
  assert.equal(validateInstagramSettings({}).frame, 'iphone');
  assert.equal(validateInstagramSettings({}).playlistMode, 'feed');
  assert.equal(validateInstagramSettings({}).playlistLoop, true);
  assert.equal(validateInstagramSettings({}).streamResolution, 'source');
  assert.equal(validateInstagramSettings({ streamResolution: '720x1280' }).streamResolution, '720x1280');
  assert.throws(() => validateInstagramSettings({ streamResolution: '9999x9999' }), /output resolution/);
  assert.equal(validateInstagramSettings({ scroll: 'arrow', captureWidth: 320 }).scroll, 'arrow');
  assert.throws(() => validateInstagramSettings({ captureWidth: 321 }), /even numbers/);
  assert.throws(() => validateInstagramSettings({ privacy: 'unknown' }), /privacy/);
  assert.throws(() => validateInstagramSettings({ captureX: -1 }), /captureX/);
  assert.throws(() => validateInstagramSettings({ audio: 'microphone' }), /Audio/);
  assert.throws(() => validateInstagramSettings({ createBroadcast: 'false' }), /automatic broadcast/);
  assert.throws(() => validateInstagramSettings({ mobileLayout: 'yes' }), /mobile Reels layout/);
  assert.throws(() => validateInstagramSettings({ frame: 'tablet' }), /video frame/);
  assert.throws(() => validateInstagramSettings({ playlistMode: 'random' }), /Selected Reels mode/);
  assert.throws(() => validateInstagramSettings({ playlistLoop: 'yes' }), /Playlist loop/);
  assert.throws(() => validateInstagramSettings({ captureWidth: 960, captureHeight: 540 }), /portrait capture/);
  assert.equal(validateInstagramSettings({ mobileLayout: false, captureWidth: 960, captureHeight: 540 }).mobileLayout, false);
});

test('Termux defaults to direct media and rejects unsupported browser capture', async () => {
  const manager = new InstagramLiveManager({
    env: { STREAMFORGE_PLATFORM: 'termux', INSTAGRAM_CDP_PORT: '9222' },
    store: {
      getPublic: async () => ({ defaultTitle: 'Phone live', defaultDescription: '', privacy: 'private' }),
      getInstagramSettings: async () => null,
      get: async () => ({ completedAt: new Date(), streamKeySecret: 'encrypted' }),
    },
    studio: { runningCount: () => 0, maxStreams: 1 },
    makeController: () => { throw new Error('Chrome must not start on Termux'); },
  });
  const settings = await manager.getSettings('phone-channel');
  assert.equal(settings.sourceMode, 'direct');
  assert.equal(settings.frame, 'none');
  assert.equal(settings.streamResolution, '360x640');
  assert.equal(manager.getStatus().capabilities.browserCollector, false);
  assert.equal(manager.getStatus().platform, 'termux');
  await assert.rejects(() => manager.browserStatus(), /not supported in Termux/);
  await assert.rejects(() => manager.currentReel(), /desktop Chrome/);
  await assert.rejects(() => manager.start('phone-channel', true), /direct MP4|Direct MP4/);
  manager.store.getInstagramSettings = async () => ({ sourceMode: 'browser' });
  await assert.rejects(() => manager.start('phone-channel', true), /Termux supports Direct MP4/);
});

test('FFmpeg raw mode preserves existing X11 capture and YouTube RTMPS behavior', () => {
  const args = buildInstagramFfmpegArgs({ captureWidth: 540, captureHeight: 960, fps: 15, audio: 'silent', frame: 'none' },
    'rtmps://a.rtmps.youtube.com/live2', 'test-stream-key');
  assert.deepEqual(args.slice(args.indexOf('-video_size'), args.indexOf('-video_size') + 4),
    ['-video_size', '540x960', '-i', ':1.0+0,0']);
  assert.equal(args.at(-1), 'rtmps://a.rtmps.youtube.com/live2/test-stream-key');
  assert.ok(args.includes('anullsrc=channel_layout=stereo:sample_rate=44100'));
  assert.ok(args.includes('libx264'));
  assert.equal(args[args.indexOf('-r') + 1], '15');
});

test('browser stream output resolution scales without changing X11 capture geometry', () => {
  const raw = buildInstagramFfmpegArgs({ frame: 'none', streamResolution: '720x1280' },
    'rtmps://a.rtmps.youtube.com/live2', 'key');
  assert.equal(raw[raw.indexOf('-video_size') + 1], '540x960');
  assert.match(raw[raw.indexOf('-vf') + 1], /scale=720:1280:force_original_aspect_ratio=decrease/);
  assert.match(raw[raw.indexOf('-vf') + 1], /pad=720:1280/);

  const phone = buildInstagramFfmpegArgs({ streamResolution: '1080x1920' },
    'rtmps://a.rtmps.youtube.com/live2', 'key', ':99', { x: 32, y: 16, width: 222, height: 398 });
  assert.equal(phone[phone.indexOf('-video_size') + 1], '540x960');
  assert.match(phone[phone.indexOf('-filter_complex') + 1], /pad=540:960:46:82/);
  assert.match(phone[phone.indexOf('-filter_complex') + 1], /scale=1080:1920:force_original_aspect_ratio=decrease/);
  assert.ok(!phone.includes('-vf'));
});

test('PulseAudio input is passed as raw PCM through a local pipe', () => {
  const args = buildInstagramFfmpegArgs({ audio: 'pulse', scroll: 'arrow', frame: 'none' },
    'rtmps://a.rtmps.youtube.com/live2', 'key', ':2');
  assert.ok(args.includes('pipe:0'));
  assert.equal(args[args.indexOf('-i') + 1], ':2.0+0,0');
});

test('phone compositing crops only the playing Reel and preserves audio input', () => {
  const crop = reelCaptureCrop({ x: 32, y: 17, width: 223, height: 397 },
    { captureWidth: 540, captureHeight: 960 });
  assert.deepEqual(crop, { x: 32, y: 16, width: 222, height: 398 });
  const args = buildInstagramFfmpegArgs({ audio: 'pulse' },
    'rtmps://a.rtmps.youtube.com/live2', 'key', ':99', crop);
  assert.ok(args.includes('pipe:0'));
  assert.ok(args.includes('-filter_complex'));
  assert.ok(args.includes('-loop'));
  assert.ok(args.some((arg) => arg.endsWith('/assets/iphone-frame.svg')));
  assert.match(args[args.indexOf('-filter_complex') + 1], /crop=222:398:32:16/);
  assert.match(args[args.indexOf('-filter_complex') + 1], /pad=540:960:46:82/);
  assert.equal(args[args.indexOf('-map') + 1], '[composed]');
  assert.equal(args[args.indexOf('-map') + 3], '1:a:0');
  assert.throws(() => buildInstagramFfmpegArgs({}, 'rtmps://host/live', 'key'), /bounds unavailable/);
  assert.throws(() => reelCaptureCrop({ x: 538, y: 500, width: 100, height: 400 },
    { captureWidth: 540, captureHeight: 960 }), /outside/);
});

test('iPhone crop maps emulated CSS coordinates back onto X11 physical pixels', () => {
  const viewport = { viewportWidth: 360, viewportHeight: 640 };
  const rect = { x: 32, y: 17, width: 223, height: 397 };
  assert.deepEqual(reelCaptureCrop(rect, { captureWidth: 540, captureHeight: 960 }, viewport),
    { x: 48, y: 24, width: 334, height: 596 });
  const args = buildInstagramFfmpegArgs({ audio: 'silent' }, 'rtmps://a.rtmps.youtube.com/live2',
    'test-key', ':99', rect, viewport);
  assert.match(args[args.indexOf('-filter_complex') + 1], /crop=334:596:48:24/);
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
    makeController: () => ({ connect: async () => ({ activeId: 1, phase: 'playing', viewportWidth: 360, viewportHeight: 640,
      videoRect: { x: 32, y: 17, width: 223, height: 397 } }), run: async () => {},
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
  assert.ok(live.logs.some((line) => line.includes('iPhone frame around the playing Reel')));
  child.stderr.emit('data', 'Failed connection: rtmps://a.rtmps.youtube.com/live2/private-stream-key\n');
  assert.ok(!JSON.stringify(manager.getStatus()).includes('private-stream-key'));
  await manager.stop();
  assert.equal(manager.getStatus().running, false);
  assert.equal(controllerStopped, true);
});

test('selected Reels mode sends saved URLs in order and reports playlist position', async () => {
  const videos = [
    { reelUrl: 'https://www.instagram.com/reel/First000/' },
    { reelUrl: 'https://www.instagram.com/reel/Second000/' },
  ];
  let controllerOptions;
  const settings = { ...validateInstagramSettings({ playlistMode: 'selected', playlistLoop: false }) };
  const manager = new InstagramLiveManager({
    store: {
      pool: { execute: async () => [[{ settings_json: settings }]] },
      get: async () => ({ completedAt: new Date(), streamKeySecret: 'encrypted', ingestUrl: 'rtmps://a.rtmps.youtube.com/live2' }),
      getPublic: async () => ({ defaultTitle: '', defaultDescription: '', privacy: 'private' }),
      getStreamKey: async () => 'secret-key',
    },
    studio: { runningCount: () => 0, maxStreams: 1 },
    makeController: (options) => {
      controllerOptions = options;
      return {
        connect: async () => {
          options.onPlaylistPosition(0);
          return { activeId: 1, phase: 'playing', viewportWidth: 360, viewportHeight: 640,
            videoRect: { x: 32, y: 17, width: 223, height: 397 } };
        },
        run: async () => {}, stop: async () => {},
      };
    },
    spawnProcess: () => {
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => child.emit('exit', 0);
      process.nextTick(() => child.emit('spawn'));
      return child;
    },
  });
  manager.playlist.list = async () => videos;
  let result = await manager.start('channel', true);
  assert.deepEqual(controllerOptions.playlistUrls, videos.map(({ reelUrl }) => reelUrl));
  assert.equal(controllerOptions.playlistLoop, false);
  assert.deepEqual(result.playlist, { current: 1, total: 2, loop: false, reelUrl: videos[0].reelUrl });
  controllerOptions.onPlaylistPosition(1);
  result = manager.getStatus();
  assert.deepEqual(result.playlist, { current: 2, total: 2, loop: false, reelUrl: videos[1].reelUrl });
  await manager.stop();
  assert.equal(manager.getStatus().playlist, null);
  manager.playlist.list = async () => [];
  await assert.rejects(() => manager.start('channel', true), /empty/);
});
