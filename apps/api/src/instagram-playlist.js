import crypto from 'node:crypto';
import { ChannelError } from './channel-store.js';

const MAX_REELS = 60;

// A playlist contains links chosen by the account owner, not downloaded media.
// Reject arbitrary URLs, query parameters and non-Reel Instagram pages.
export function normalizeReelUrl(input) {
  if (typeof input !== 'string' || input.length > 1000) throw new ChannelError('Enter a valid Instagram Reel link');
  let url;
  try { url = new URL(input.trim()); } catch { throw new ChannelError('Enter a valid Instagram Reel link'); }
  const parts = url.pathname.match(/^\/(?:reel|reels)\/([A-Za-z0-9_-]{5,64})\/?$/);
  if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname) ||
      url.username || url.password || !parts) {
    throw new ChannelError('Only public-format https://www.instagram.com/reel/.../ links are accepted');
  }
  return { shortcode: parts[1], url: `https://www.instagram.com/reel/${parts[1]}/` };
}

export class InstagramPlaylistStore {
  constructor(channelStore) {
    this.channelStore = channelStore;
    this.pool = channelStore.pool;
  }

  async initialize() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS streamforge_instagram_playlist (
      id CHAR(36) PRIMARY KEY,
      channel_id CHAR(36) NOT NULL,
      reel_shortcode VARCHAR(64) NOT NULL,
      reel_url VARCHAR(255) NOT NULL,
      label VARCHAR(120) NOT NULL,
      sort_order INT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_channel_reel (channel_id, reel_shortcode),
      INDEX playlist_order (channel_id, sort_order),
      CONSTRAINT fk_playlist_channel FOREIGN KEY (channel_id)
        REFERENCES streamforge_channels(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }

  async list(channelId) {
    await this.channelStore.getPublic(channelId);
    const [rows] = await this.pool.execute(`SELECT id, reel_url AS reelUrl,
      reel_shortcode AS shortcode, label, sort_order AS position
      FROM streamforge_instagram_playlist WHERE channel_id = ? ORDER BY sort_order ASC, created_at ASC`, [channelId]);
    return rows;
  }

  async add(channelId, input) {
    const { url, shortcode } = normalizeReelUrl(input?.url);
    if (input?.label !== undefined && typeof input.label !== 'string') throw new ChannelError('Reel label must be text');
    const label = (input?.label || '').trim().slice(0, 120) || `Reel ${shortcode}`;
    const existing = await this.list(channelId);
    if (existing.length >= MAX_REELS) throw new ChannelError(`A playlist can contain up to ${MAX_REELS} Reels`);
    if (existing.some((row) => row.shortcode === shortcode)) throw new ChannelError('This Reel is already in your playlist', 409);
    const position = Math.max(0, ...existing.map((row) => Number(row.position) || 0)) + 1;
    try {
      await this.pool.execute(`INSERT INTO streamforge_instagram_playlist
        (id, channel_id, reel_shortcode, reel_url, label, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)`, [crypto.randomUUID(), channelId, shortcode, url, label, position]);
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') throw new ChannelError('This Reel is already in your playlist', 409);
      throw error;
    }
    return this.list(channelId);
  }

  async remove(channelId, itemId) {
    if (!/^[0-9a-f-]{36}$/i.test(itemId)) throw new ChannelError('Invalid playlist item');
    await this.channelStore.getPublic(channelId);
    const [result] = await this.pool.execute('DELETE FROM streamforge_instagram_playlist WHERE channel_id = ? AND id = ?', [channelId, itemId]);
    if (!result.affectedRows) throw new ChannelError('Playlist item not found', 404);
    return this.list(channelId);
  }

  async reorder(channelId, ids) {
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
      throw new ChannelError('Provide the complete playlist item order');
    }
    const current = await this.list(channelId);
    if (ids.length !== current.length || new Set(ids).size !== current.length ||
        ids.some((id) => !current.some((row) => row.id === id))) {
      throw new ChannelError('Playlist order must include every current Reel exactly once');
    }
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      for (let index = 0; index < ids.length; index++) {
        await connection.execute('UPDATE streamforge_instagram_playlist SET sort_order = ? WHERE channel_id = ? AND id = ?',
          [index + 1, channelId, ids[index]]);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
    return this.list(channelId);
  }
}

// Use the same validated Reel URL format with atomic file-backed persistence.
export class FileInstagramPlaylistStore {
  constructor(channelStore) { this.channelStore = channelStore; }
  async initialize() {}
  async list(channelId) { return this.channelStore.listReels(channelId); }
  async add(channelId, input) { return this.channelStore.addReel(channelId, input); }
  async remove(channelId, itemId) { return this.channelStore.removeReel(channelId, itemId); }
  async reorder(channelId, ids) { return this.channelStore.reorderReels(channelId, ids); }
}
