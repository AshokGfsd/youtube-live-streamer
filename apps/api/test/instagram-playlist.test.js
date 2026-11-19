import test from 'node:test';
import assert from 'node:assert/strict';
import { InstagramPlaylistStore, normalizeReelUrl } from '../src/instagram-playlist.js';
import { nextPlaylistIndex } from '../src/instagram-cdp.js';

test('only canonical Instagram Reel links can enter a playlist', () => {
  assert.deepEqual(normalizeReelUrl('https://instagram.com/reel/Df41-9sOmN7/?utm_source=ig'), {
    shortcode: 'Df41-9sOmN7', url: 'https://www.instagram.com/reel/Df41-9sOmN7/',
  });
  assert.equal(normalizeReelUrl('https://www.instagram.com/reels/Df41-9sOmN7/').shortcode, 'Df41-9sOmN7');
  for (const url of ['https://fakeinstagram.com/reel/abcdefgh/', 'http://instagram.com/reel/abcdefgh/',
    'https://instagram.com/explore/', 'https://instagram.com/reel/../',
    'javascript:alert(1)', 'https://instagram.com@bad.example/reel/abcdefgh/']) {
    assert.throws(() => normalizeReelUrl(url), /reel/i);
  }
});

test('playlist next index advances in order, loops optionally and stops at end', () => {
  assert.equal(nextPlaylistIndex(0, 3, true), 1);
  assert.equal(nextPlaylistIndex(1, 3, true), 2);
  assert.equal(nextPlaylistIndex(2, 3, true), 0);
  assert.equal(nextPlaylistIndex(2, 3, false), null);
  assert.throws(() => nextPlaylistIndex(3, 3, true), /Invalid playlist/);
});

function fixture() {
  const rows = [];
  const updates = [];
  let initialized = false;
  let committed = false;
  const pool = {
    query: async (sql) => { assert.match(sql, /CREATE TABLE IF NOT EXISTS streamforge_instagram_playlist/); initialized = true; },
    execute: async (sql, params) => {
      if (sql.includes('SELECT id, reel_url')) {
        return [rows.filter((item) => item.channelId === params[0]).sort((a, b) => a.position - b.position)
          .map(({ id, reelUrl, shortcode, label, position }) => ({ id, reelUrl, shortcode, label, position }))];
      }
      if (sql.startsWith('INSERT')) {
        const [id, channelId, shortcode, reelUrl, label, position] = params;
        rows.push({ id, channelId, shortcode, reelUrl, label, position });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('DELETE')) {
        const index = rows.findIndex((item) => item.channelId === params[0] && item.id === params[1]);
        if (index < 0) return [{ affectedRows: 0 }];
        rows.splice(index, 1);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    getConnection: async () => ({
      beginTransaction: async () => {},
      execute: async (sql, [position, channelId, id]) => {
        assert.match(sql, /UPDATE streamforge_instagram_playlist/);
        const row = rows.find((item) => item.channelId === channelId && item.id === id);
        row.position = position;
        updates.push(position);
      },
      commit: async () => { committed = true; }, rollback: async () => {}, release: () => {},
    }),
  };
  const playlist = new InstagramPlaylistStore({ pool,
    getPublic: async (id) => { if (id !== 'test-channel') throw new Error('wrong channel'); return {}; } });
  return { playlist, get initialized() { return initialized; }, get committed() { return committed; }, updates };
}

test('reels are saved per channel, deduplicated and reordered transactionally', async () => {
  const state = fixture();
  const { playlist, updates } = state;
  await playlist.initialize();
  assert.equal(state.initialized, true);
  let items = await playlist.add('test-channel', { url: 'https://www.instagram.com/reel/First000/' });
  assert.equal(items.length, 1);
  items = await playlist.add('test-channel', { url: 'https://www.instagram.com/reel/Second000/', label: 'Second video' });
  assert.equal(items[1].label, 'Second video');
  assert.equal(items[1].position, 2);
  await assert.rejects(() => playlist.add('test-channel', { url: 'https://www.instagram.com/reel/First000/' }), /already/);
  await assert.rejects(() => playlist.reorder('test-channel', [items[0].id, items[0].id]), /every current Reel/);
  items = await playlist.reorder('test-channel', [items[1].id, items[0].id]);
  assert.equal(items[0].shortcode, 'Second000');
  assert.deepEqual(updates, [1, 2]);
  assert.equal(state.committed, true);
  items = await playlist.remove('test-channel', items[1].id);
  assert.equal(items.length, 1);
  await assert.rejects(() => playlist.remove('test-channel', '00000000-0000-4000-8000-000000000000'), /not found/);
});
