import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ChannelError, publicChannel, resolveChannelEncryptionKey, SecretBox, validateChannelStep } from './channel-store.js';
import { normalizeReelUrl } from './instagram-playlist.js';

// Private, single-VM alternative to MariaDB. The same ChannelStudio and
// Instagram Live endpoints work without changing the API or frontend.
export class FileChannelStore {
  constructor(filename, secretBox) {
    this.filename = filename;
    this.secrets = secretBox;
    this.rows = new Map();
    this.instagramSettings = {};
    this.instagramPlaylists = {};
    this.writes = Promise.resolve();
  }

  async initialize() {
    await fs.mkdir(path.dirname(this.filename), { recursive: true, mode: 0o700 });
    let saved;
    try { saved = JSON.parse(await fs.readFile(this.filename, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return;
      throw new Error(`Could not load encrypted channel file: ${error.message}`);
    }
    if (saved?.version !== 1 || !Array.isArray(saved.channels) ||
        saved.channels.some((row) => !row || typeof row !== 'object' ||
          !/^[0-9a-f-]{36}$/i.test(row.id || '') ||
          (typeof row.streamKeySecret !== 'string' && row.streamKeySecret !== null))) {
      throw new Error('Invalid channel file format; restore a backup before restarting');
    }
    this.rows = new Map(saved.channels.map((row) => [row.id, row]));
    if (this.rows.size !== saved.channels.length) throw new Error('Duplicate channel IDs in channel file');
    if (saved.instagramSettings && (typeof saved.instagramSettings !== 'object' || Array.isArray(saved.instagramSettings))) {
      throw new Error('Invalid Instagram settings in channel file');
    }
    if (saved.instagramPlaylists && (typeof saved.instagramPlaylists !== 'object' || Array.isArray(saved.instagramPlaylists))) {
      throw new Error('Invalid Instagram playlists in channel file');
    }
    this.instagramSettings = saved.instagramSettings || {};
    this.instagramPlaylists = saved.instagramPlaylists || {};
  }

  async #persist() {
    const tmp = `${this.filename}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify({ version: 1, channels: [...this.rows.values()],
        instagramSettings: this.instagramSettings, instagramPlaylists: this.instagramPlaylists }, null, 2) + '\n',
        { flag: 'wx', mode: 0o600 });
      await fs.rename(tmp, this.filename);
    } catch (error) {
      await fs.unlink(tmp).catch(() => {});
      throw error;
    }
  }

  #mutate(action) {
    const operation = this.writes.then(async () => {
      const before = new Map(this.rows);
      const beforeSettings = this.instagramSettings;
      const beforePlaylists = this.instagramPlaylists;
      try {
        const result = action();
        await this.#persist();
        return result;
      } catch (error) {
        this.rows = before;
        this.instagramSettings = beforeSettings;
        this.instagramPlaylists = beforePlaylists;
        throw error;
      }
    });
    this.writes = operation.catch(() => {});
    return operation;
  }

  #row(id) {
    if (!/^[0-9a-f-]{36}$/i.test(id || '')) throw new ChannelError('Invalid channel ID');
    const row = this.rows.get(id);
    if (!row) throw new ChannelError('Channel not found', 404);
    return row;
  }

  async list() { return [...this.rows.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(publicChannel); }
  async get(id) { return { ...this.#row(id) }; }
  async getPublic(id) { return publicChannel(this.#row(id)); }

  async create() {
    return this.#mutate(() => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const row = { id, displayName: '', handle: '', youtubeChannelId: '', channelUrl: '', youtubeTitle: '',
        description: '', keywords: '', category: 'Entertainment', streamKeySecret: null, oauthRefreshSecret: null,
        ingestUrl: 'rtmps://a.rtmps.youtube.com/live2', defaultTitle: '', defaultDescription: '', privacy: 'private',
        loop: true, wizardStep: 0, completedAt: null, createdAt: now, updatedAt: now };
      this.rows.set(id, row);
      return publicChannel(row);
    });
  }

  async saveStep(id, step, payload) {
    return this.#mutate(() => {
      const current = this.#row(id);
      const number = Number(step);
      const data = validateChannelStep(number, payload, Boolean(current.streamKeySecret));
      const row = { ...current, updatedAt: new Date().toISOString(), wizardStep: Math.max(current.wizardStep, number) };
      if (number === 3) {
        row.ingestUrl = data.ingestUrl;
        if (data.streamKey) row.streamKeySecret = this.secrets.encrypt(data.streamKey);
      } else Object.assign(row, data);
      this.rows.set(id, row);
      return publicChannel(row);
    });
  }

  async complete(id) {
    return this.#mutate(() => {
      const row = this.#row(id);
      if (Number(row.wizardStep) < 4 || !row.displayName || !row.streamKeySecret) {
        throw new ChannelError('Complete all four setup steps and add a stream key first');
      }
      const next = { ...row, completedAt: row.completedAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
      this.rows.set(id, next);
      return publicChannel(next);
    });
  }

  async getStreamKey(id) { return this.secrets.decrypt(this.#row(id).streamKeySecret); }
  async getOAuthAccount(id) {
    const row = this.#row(id);
    return row.oauthRefreshSecret ? { refreshToken: this.secrets.decrypt(row.oauthRefreshSecret),
      channelId: row.youtubeChannelId, channelTitle: row.youtubeTitle, description: row.description } : null;
  }
  async setOAuthAccount(id, account) {
    return this.#mutate(() => {
      const row = this.#row(id);
      this.rows.set(id, { ...row, oauthRefreshSecret: this.secrets.encrypt(account.refreshToken),
        youtubeChannelId: account.channelId, youtubeTitle: account.channelTitle,
        description: account.description || '', updatedAt: new Date().toISOString() });
    });
  }
  async clearOAuthAccount(id) {
    return this.#mutate(() => {
      const row = this.#row(id);
      this.rows.set(id, { ...row, oauthRefreshSecret: null, updatedAt: new Date().toISOString() });
    });
  }

  async getInstagramSettings(id) {
    this.#row(id);
    return this.instagramSettings[id] || null;
  }

  async saveInstagramSettings(id, settings) {
    return this.#mutate(() => {
      this.#row(id);
      this.instagramSettings = { ...this.instagramSettings, [id]: settings };
      return settings;
    });
  }

  async listReels(id) {
    this.#row(id);
    return [...(this.instagramPlaylists[id] || [])].map(({ createdAt, ...row }) => row);
  }

  async addReel(id, input) {
    return this.#mutate(() => {
      this.#row(id);
      const { url, shortcode } = normalizeReelUrl(input?.url);
      if (input?.label !== undefined && typeof input.label !== 'string') throw new ChannelError('Reel label must be text');
      const items = this.instagramPlaylists[id] || [];
      if (items.length >= 60) throw new ChannelError('A playlist can contain up to 60 Reels');
      if (items.some((row) => row.shortcode === shortcode)) throw new ChannelError('This Reel is already in your playlist', 409);
      const label = (input?.label || '').trim().slice(0, 120) || `Reel ${shortcode}`;
      const next = [...items, { id: crypto.randomUUID(), reelUrl: url, shortcode, label,
        position: Math.max(0, ...items.map((row) => Number(row.position) || 0)) + 1,
        createdAt: new Date().toISOString() }];
      this.instagramPlaylists = { ...this.instagramPlaylists, [id]: next };
      return next.map(({ createdAt, ...row }) => row);
    });
  }

  async removeReel(id, itemId) {
    return this.#mutate(() => {
      this.#row(id);
      if (!/^[0-9a-f-]{36}$/i.test(itemId || '')) throw new ChannelError('Invalid playlist item');
      const items = this.instagramPlaylists[id] || [];
      if (!items.some((item) => item.id === itemId)) throw new ChannelError('Playlist item not found', 404);
      const remaining = items.filter((item) => item.id !== itemId);
      this.instagramPlaylists = { ...this.instagramPlaylists, [id]: remaining };
      return remaining.map(({ createdAt, ...row }) => row);
    });
  }

  async reorderReels(id, ids) {
    return this.#mutate(() => {
      this.#row(id);
      const items = this.instagramPlaylists[id] || [];
      if (!Array.isArray(ids) || ids.length !== items.length || new Set(ids).size !== items.length ||
          ids.some((itemId) => typeof itemId !== 'string' || !items.some((item) => item.id === itemId))) {
        throw new ChannelError('Playlist order must include every current Reel exactly once');
      }
      const ordered = ids.map((itemId, index) => ({ ...items.find((item) => item.id === itemId), position: index + 1 }));
      this.instagramPlaylists = { ...this.instagramPlaylists, [id]: ordered };
      return ordered.map(({ createdAt, ...row }) => row);
    });
  }
}

export async function createFileChannelStore(env = process.env) {
  const directory = path.resolve(env.DATA_DIR || './data');
  const filename = path.join(directory, 'channels.json');
  const store = new FileChannelStore(filename, new SecretBox(await resolveChannelEncryptionKey(env)));
  await store.initialize();
  return store;
}
