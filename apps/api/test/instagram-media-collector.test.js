import test from 'node:test';
import assert from 'node:assert/strict';
import { InstagramMediaCollector, READ_VISIBLE_MEDIA, validateMediaSearch, matchesMediaFilters } from '../src/instagram-media-collector.js';

const CLIP1 = 'https://instagram.a.fbcdn.net/o1/v/clip-one.mp4?token=FIRST_SECRET';
const CLIP2 = 'https://instagram.a.fbcdn.net/o1/v/clip-two.mp4?token=SECOND_SECRET';

test('automatic search only accepts bounded keywords and a valid count', () => {
  assert.deepEqual(validateMediaSearch({ query: ' Naruto ', count: 10 }), { query: 'Naruto', count: 10, minFps: 0, minResolution: 'any' });
  assert.deepEqual(validateMediaSearch({ query: ' Naruto ', count: 200 }), { query: 'Naruto', count: 200, minFps: 0, minResolution: 'any' });
  assert.deepEqual(validateMediaSearch({ query: ' Naruto ', count: 0 }), { query: 'Naruto', count: 0, minFps: 0, minResolution: 'any' });
  assert.deepEqual(validateMediaSearch({ query: 'Naruto', count: 5, minFps: 40, minResolution: '1080p' }),
    { query: 'Naruto', count: 5, minFps: 40, minResolution: '1080p' });
  for (const input of [
    { query: 'naruto', count: 2, minFps: 59 },
    { query: 'naruto', count: 2, minResolution: '4K' },
    { query: 'x', count: 2 }, { query: 'naruto', count: -1 },
    { query: 'naruto', count: 50001 }, { query: 'naruto', count: 1.2 },
    { query: 'naruto\nignore', count: 3 },
  ]) assert.throws(() => validateMediaSearch(input), /keyword|count|FPS|resolution/);
});

test('collector navigates a separate Chrome tab, captures signed MP4 links, and closes it', async () => {
  const calls = [];
  const closed = [];
  let scans = 0;
  const session = {
    call: async (method) => { calls.push(method); },
    evaluate: async (expression) => {
      if (expression !== READ_VISIBLE_MEDIA) return true;
      scans++;
      return JSON.stringify({ path: '/explore/search/keyword/', videos: [
        { urls: ['blob:fake', CLIP1] },
        { urls: [CLIP1] },
        ...(scans > 1 ? [{ urls: [CLIP2] }] : []),
      ], tiles: [] });
    },
    close: () => { closed.push('session'); },
  };
  const collector = new InstagramMediaCollector({
    createTab: async (_port, url) => {
      assert.match(url, /\/explore\/search\/keyword\/\?q=naruto/);
      return { id: 'created-by-streamforge', socketUrl: 'ws://127.0.0.1:9222/devtools/page/new' };
    },
    closeTab: async (_port, id) => closed.push(id),
    connect: async () => session,
    pause: async () => {},
  });
  assert.equal(collector.start({ query: 'naruto', count: 2 }).phase, 'running');
  assert.throws(() => collector.start({ query: 'naruto', count: 2 }), /already running/);
  for (let i = 0; i < 50 && collector.phase === 'running'; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(collector.phase, 'completed');
  assert.equal(collector.status().found, 2);
  assert.ok(!JSON.stringify(collector.status()).includes('FIRST_SECRET'));
  assert.deepEqual(collector.results().directVideoUrls, [CLIP1, CLIP2]);
  assert.ok(calls.includes('Runtime.enable'));
  assert.deepEqual(closed, ['session', 'created-by-streamforge']);
});

test('collector stops for manual login and exposes a safe error', async () => {
  const collector = new InstagramMediaCollector({
    createTab: async () => ({ id: 'our-tab', socketUrl: 'ws://127.0.0.1:9222/devtools/page/test' }),
    closeTab: async () => {},
    connect: async () => ({
      call: async () => {}, close: () => {},
      evaluate: async () => JSON.stringify({ path: '/accounts/login/', videos: [] }),
    }),
    pause: async () => {},
  });
  collector.start({ query: 'puzzles', count: 5 });
  for (let i = 0; i < 50 && collector.phase === 'running'; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(collector.phase, 'failed');
  assert.match(collector.status().error, /login required/);
  assert.deepEqual(collector.results().directVideoUrls, []);
});


test('minimum source filters are orientation-aware and tolerate fractional 29.97 FPS', () => {
  assert.equal(matchesMediaFilters({ video: { width: 720, height: 1280, fps: 29.97 } },
    { minFps: 30, minResolution: '720p' }), true);
  assert.equal(matchesMediaFilters({ video: { width: 1920, height: 1080, fps: 59.94 } },
    { minFps: 60, minResolution: '1080p' }), true);
  assert.equal(matchesMediaFilters({ video: { width: 720, height: 1280, fps: 30 } },
    { minFps: 40, minResolution: '720p' }), false);
  assert.equal(matchesMediaFilters({ video: { width: 720, height: 1280, fps: 60 } },
    { minFps: 60, minResolution: '1080p' }), false);
  assert.equal(matchesMediaFilters({ video: { width: null, height: null, fps: null } },
    { minFps: 0, minResolution: '720p' }), false);
});

test('collector probes candidates before adding accepted FPS and resolution matches', async () => {
  const closed = [];
  const collector = new InstagramMediaCollector({
    createTab: async () => ({ id: 'filter-test', socketUrl: 'ws://127.0.0.1:9222/devtools/page/test' }),
    closeTab: async (_port, id) => closed.push(id),
    connect: async () => ({
      call: async () => {},
      close: () => {},
      evaluate: async (expression) => expression === READ_VISIBLE_MEDIA
        ? JSON.stringify({ path: '/explore/search/keyword/', videos: [
          { urls: [CLIP1] }, { urls: [CLIP2] },
        ], tiles: [] })
        : true,
    }),
    pause: async () => {},
    probeMedia: async (url) => url === CLIP1
      ? { video: { width: 720, height: 1280, fps: 29.97 } }
      : { video: { width: 1080, height: 1920, fps: 59.94 } },
  });
  collector.start({ query: 'puzzles', count: 1, minFps: 40, minResolution: '1080p' });
  for (let i = 0; i < 100 && collector.phase === 'running'; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(collector.phase, 'completed');
  assert.deepEqual(collector.results().directVideoUrls, [CLIP2]);
  assert.deepEqual(collector.results().videoDetails, [{ width: 1080, height: 1920, fps: 59.94 }]);
  assert.equal(collector.status().checked, 2);
  assert.equal(collector.status().rejected, 1);
  assert.ok(!JSON.stringify(collector.status()).includes('SECRET'));
  assert.deepEqual(closed, ['filter-test']);
});
