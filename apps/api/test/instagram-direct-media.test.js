import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { buildDirectMediaFfmpegArgs, directMediaManifest, validateDirectMediaPlaylist } from '../src/instagram-direct-media.js';
import { InstagramLiveManager, validateInstagramSettings } from '../src/instagram-live.js';

const FIRST = 'https://instagram.a.fbcdn.net/o1/v/clip1.mp4?token=FIRST_PRIVATE_TOKEN';
const SECOND = 'https://instagram.a.fbcdn.net/o1/v/clip2.mp4?token=SECOND_PRIVATE_TOKEN';

test('direct playlist accepts signed Meta MP4 URLs and rejects injection/duplicates', () => {
  assert.deepEqual(validateDirectMediaPlaylist([FIRST, SECOND]), [FIRST, SECOND]);
  assert.match(directMediaManifest([FIRST, SECOND]), /^ffconcat version 1\.0\nfile 'https:\/\//);
  assert.throws(() => validateDirectMediaPlaylist([]), /Import/);
  assert.throws(() => validateDirectMediaPlaylist([FIRST, FIRST]), /duplicate/);
  assert.throws(() => validateDirectMediaPlaylist([FIRST, 'https://evil.com/video.mp4']), /HTTPS/);
  assert.throws(() => validateDirectMediaPlaylist([FIRST, 'https://instagram.a.fbcdn.net/movie.mp4?name=bad\'quote']), /unsupported characters/);
  assert.throws(() => validateDirectMediaPlaylist(Array.from({ length: 101 }, (_, i) =>
    `https://instagram.a.fbcdn.net/v${i}.mp4`)), /1–100/);
});

test('FFmpeg direct playlist is real-time, normalizes portrait video and copies source audio', () => {
  const settings = validateInstagramSettings({ sourceMode: 'direct', playlistLoop: true, mobileLayout: true });
  const args = buildDirectMediaFfmpegArgs(settings, 'rtmps://a.rtmps.youtube.com/live2', 'SECRET',
    '/tmp/private/playlist.ffconcat', '/tmp/frame.svg');
  assert.ok(args.includes('-re'));
  assert.deepEqual(args.slice(args.indexOf('-stream_loop'), args.indexOf('-stream_loop') + 2), ['-stream_loop', '-1']);
  assert.deepEqual(args.slice(args.indexOf('-f'), args.indexOf('-f') + 4), ['-f', 'concat', '-i', '/tmp/private/playlist.ffconcat']);
  assert.ok(args.includes('0:a:0?'));
  assert.ok(args.includes('[composed]'));
  assert.match(args[args.indexOf('-filter_complex') + 1], /shortest=1:repeatlast=0/);
  assert.ok(!args.includes('x11grab'));
  assert.equal(args.at(-1), 'rtmps://a.rtmps.youtube.com/live2/SECRET');
  const once = buildDirectMediaFfmpegArgs({ ...settings, playlistLoop: false, frame: 'none' },
    'rtmps://a.rtmps.youtube.com/live2', 'SECRET', '/tmp/playlist.ffconcat', '/tmp/frame.svg');
  assert.ok(!once.includes('-stream_loop'));
  assert.ok(once.includes('-vf'));
});

test('direct MP4 output sizes are selectable independently of the virtual browser dimensions', () => {
  const settings = validateInstagramSettings({ sourceMode: 'direct', streamResolution: '480x854', frame: 'none' });
  const args = buildDirectMediaFfmpegArgs(settings, 'rtmps://a.rtmps.youtube.com/live2', 'SECRET',
    '/tmp/private/playlist.ffconcat', '/tmp/frame.svg');
  assert.match(args[args.indexOf('-vf') + 1], /scale=480:854:force_original_aspect_ratio=decrease/);
  assert.match(args[args.indexOf('-vf') + 1], /pad=480:854/);
  assert.equal(settings.captureWidth, 540);
  assert.equal(settings.captureHeight, 960);

  const framed = buildDirectMediaFfmpegArgs({ ...settings, frame: 'iphone', streamResolution: '720x1280' },
    'rtmps://a.rtmps.youtube.com/live2', 'SECRET', '/tmp/private/playlist.ffconcat', '/tmp/frame.svg');
  assert.match(framed[framed.indexOf('-filter_complex') + 1], /pad=720:1280/);
  assert.ok(framed.includes('[composed]'));
});

test('direct media mode uses no browser, keeps URL secrets private and removes manifest on stop', async () => {
  let args;
  let child;
  const settings = validateInstagramSettings({ sourceMode: 'direct', playlistLoop: false });
  const manager = new InstagramLiveManager({
    store: {
      pool: { execute: async () => [[{ settings_json: settings }]] },
      get: async () => ({ completedAt: new Date(), streamKeySecret: 'encrypted', ingestUrl: 'rtmps://a.rtmps.youtube.com/live2' }),
      getPublic: async () => ({ defaultTitle: '', defaultDescription: '', privacy: 'private' }),
      getStreamKey: async () => 'stream-key',
    },
    studio: { runningCount: () => 0, maxStreams: 1 },
    makeController: () => { throw new Error('Direct mode must never open the browser'); },
    spawnProcess: (_command, ffmpegArgs) => {
      args = ffmpegArgs;
      child = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => child.emit('exit', 0);
      process.nextTick(() => child.emit('spawn'));
      return child;
    },
  });
  await assert.rejects(() => manager.start('id', true, []), /Import/);
  const live = await manager.start('id', true, [FIRST, SECOND]);
  assert.equal(live.running, true);
  assert.equal(live.sourceMode, 'direct');
  assert.deepEqual(live.playlist, { current: null, total: 2, loop: false, reelUrl: null });
  assert.ok(!JSON.stringify(live).includes('PRIVATE_TOKEN'));
  assert.ok(!args.includes('x11grab'));
  const manifestPath = args[args.indexOf('-f') + 3];
  const manifest = await readFile(manifestPath, 'utf8');
  assert.match(manifest, /FIRST_PRIVATE_TOKEN/);
  assert.equal((await stat(manifestPath)).mode & 0o777, 0o600);
  await manager.stop();
  await assert.rejects(() => stat(manifestPath), { code: 'ENOENT' });
});

test('switching a direct livestream restarts at the chosen clip and keeps the YouTube event', async () => {
  const manifests = [];
  const children = [];
  const settings = validateInstagramSettings({ sourceMode: 'direct', playlistLoop: true });
  const manager = new InstagramLiveManager({
    store: {
      pool: { execute: async () => [[{ settings_json: settings }]] },
      get: async () => ({ completedAt: new Date(), streamKeySecret: 'encrypted', ingestUrl: 'rtmps://a.rtmps.youtube.com/live2' }),
      getPublic: async () => ({ defaultTitle: '', defaultDescription: '', privacy: 'private' }),
      getStreamKey: async () => 'PRIVATE_YOUTUBE_KEY',
    },
    studio: { runningCount: () => 0, maxStreams: 1 },
    makeController: () => { throw new Error('A direct switch must not use the Chrome screen'); },
    spawnProcess: (_name, args) => {
      manifests.push(args[args.indexOf('-f') + 3]);
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => { child.exitCode = 0; child.emit('exit', 0); };
      children.push(child);
      process.nextTick(() => child.emit('spawn'));
      return child;
    },
  });
  await assert.rejects(() => manager.switchDirect('id', true, undefined, 0), /Start a Direct MP4/);
  await manager.start('id', true, [FIRST, SECOND]);
  const startedAt = manager.startedAt;
  manager.broadcast = { title: 'Existing live', url: 'https://www.youtube.com/watch?v=abcdefghijk' };
  await assert.rejects(() => manager.switchDirect('id', false, undefined, 1), /rights/);
  await assert.rejects(() => manager.switchDirect('id', true, undefined, 2), /within/);

  const switched = await manager.switchDirect('id', true, undefined, 1);
  assert.equal(switched.running, true);
  assert.equal(switched.activeChannelId, 'id');
  assert.equal(switched.startedAt, startedAt);
  assert.equal(switched.broadcast.title, 'Existing live');
  assert.deepEqual(switched.directControl, { count: 2, lastSelectedIndex: 1 });
  assert.equal(children.length, 2);
  assert.equal(children[0].exitCode, 0);
  assert.match(await readFile(manifests[1], 'utf8'), /clip2\.mp4[^\n]*\nfile '[^']*clip1\.mp4/);
  await assert.rejects(() => stat(manifests[0]), { code: 'ENOENT' });

  const replaced = await manager.switchDirect('id', true, [SECOND], 0);
  assert.deepEqual(replaced.directControl, { count: 1, lastSelectedIndex: 0 });
  assert.equal(replaced.playlist.total, 1);
  assert.equal(children.length, 3);
  assert.ok(!JSON.stringify(replaced).includes('PRIVATE_TOKEN'));
  assert.ok(!JSON.stringify(replaced).includes('PRIVATE_YOUTUBE_KEY'));
  await manager.stop();
  await assert.rejects(() => stat(manifests[2]), { code: 'ENOENT' });
});

test('FFmpeg concat playlist decodes two compatible local MP4s in sequence', async (t) => {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) return t.skip('FFmpeg not installed');
  const dir = await mkdtemp(join(tmpdir(), 'streamforge-concat-test-'));
  try {
    const clips = [join(dir, 'one.mp4'), join(dir, 'two.mp4')];
    for (const [index, file] of clips.entries()) {
      const result = spawnSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
        '-i', `color=c=${index ? 'blue' : 'red'}:s=180x320:r=15`,
        '-f', 'lavfi', '-i', 'sine=frequency=400:sample_rate=44100',
        '-t', '0.5', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', '-y', file,
      ], { encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, 0, result.stderr);
    }
    const manifest = join(dir, 'playlist.ffconcat');
    await writeFile(manifest, directMediaManifest(clips));
    const result = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-re',
      '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
      '-safe', '0', '-f', 'concat', '-i', manifest,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', 'scale=180:320,format=yuv420p',
      '-t', '0.8', '-f', 'null', '-',
    ], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
