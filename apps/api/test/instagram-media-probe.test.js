import test from 'node:test';
import assert from 'node:assert/strict';
import { InstagramMediaProber, validateInstagramMediaUrl } from '../src/instagram-media-probe.js';

const URL = 'https://instagram.fmaa2-1.fna.fbcdn.net/o1/v/example.mp4?token=PRIVATE-SIGNED-TOKEN';
const PROBE_OUTPUT = JSON.stringify({
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 720, height: 1280 },
    { codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '44100' },
  ],
  format: { duration: '12.34' },
});

test('only direct HTTPS Instagram CDN MP4 links can reach FFmpeg', () => {
  assert.equal(validateInstagramMediaUrl(URL), URL);
  assert.equal(validateInstagramMediaUrl('https://scontent.cdninstagram.com/videos/a.mp4'),
    'https://scontent.cdninstagram.com/videos/a.mp4');
  for (const input of [
    'http://instagram.fmaa2-1.fna.fbcdn.net/video.mp4',
    'https://evilfbcdn.net/video.mp4',
    'https://fbcdn.net.attacker.com/video.mp4',
    'https://127.0.0.1/private.mp4',
    'https://instagram.com/reel/SHORTCODE/',
    'https://a.fbcdn.net/video.mov',
    'https://user:password@a.fbcdn.net/video.mp4',
    'https://a.fbcdn.net:8443/video.mp4',
    'https://a.fbcdn.net/video.mp4#section',
    'file:///etc/passwd',
  ]) assert.throws(() => validateInstagramMediaUrl(input), /HTTPS|valid/);
});

test('private media probe tests decoding and encoding without exposing signed URLs', async () => {
  const calls = [];
  const prober = new InstagramMediaProber({ run: async (command, args, options) => {
    calls.push({ command, args, options });
    return command === 'ffprobe' ? { stdout: PROBE_OUTPUT } : { stdout: '' };
  } });
  const result = await prober.probe(URL, { decode: true });
  assert.deepEqual(result, {
    reachable: true, encoded: true,
    video: { codec: 'h264', width: 720, height: 1280 },
    audio: { codec: 'aac', channels: 2, sampleRate: 44100 },
    durationSeconds: 12.34,
  });
  assert.equal(calls[0].command, 'ffprobe');
  assert.ok(calls[0].args.includes(URL));
  assert.deepEqual(calls[0].args.slice(2, 4), ['-max_redirects', '0']);
  assert.equal(calls[1].command, 'ffmpeg');
  assert.ok(calls[1].args.includes('libx264'));
  assert.ok(!JSON.stringify(result).includes('PRIVATE-SIGNED-TOKEN'));
});

test('reports inaccessible URLs without logging CDN tokens and serializes probes', async () => {
  const invalid = new InstagramMediaProber({ run: async () => {
    const error = new Error(`https://a.fbcdn.net/video.mp4?secret=TOKEN`);
    error.stderr = 'HTTP error 403 Forbidden';
    throw error;
  } });
  await assert.rejects(() => invalid.probe(URL), (error) => {
    assert.match(error.message, /403/);
    assert.ok(!error.message.includes('TOKEN'));
    return true;
  });

  let release;
  const prober = new InstagramMediaProber({ run: () => new Promise((resolve) => { release = resolve; }) });
  const first = prober.probe(URL);
  await assert.rejects(() => prober.probe(URL), /already running/);
  release({ stdout: PROBE_OUTPUT });
  await first;
  assert.equal(prober.busy, false);
});
