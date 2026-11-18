import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

export class ChannelError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ChannelError';
    this.status = status;
  }
}

const MAX_STRING = { displayName: 100, handle: 100, youtubeChannelId: 80, channelUrl: 255,
  description: 1000, keywords: 500, category: 60, defaultTitle: 100, defaultDescription: 5000 };
const ALLOWED_RTMPS = new Set(['a.rtmps.youtube.com', 'b.rtmps.youtube.com']);

function text(value, name, required = false) {
  if (value === undefined || value === null) return required ? (() => { throw new ChannelError(`${name} is required`); })() : '';
  if (typeof value !== 'string') throw new ChannelError(`${name} must be text`);
  const trimmed = value.trim();
  if (trimmed.length > MAX_STRING[name]) throw new ChannelError(`${name} is too long`);
  if (required && !trimmed) throw new ChannelError(`${name} is required`);
  return trimmed;
}

export function validateChannelStep(step, payload, hasKey = false) {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw new ChannelError('Invalid channel details');
  switch (Number(step)) {
    case 1: {
      const displayName = text(payload.displayName, 'displayName', true);
      const handle = text(payload.handle, 'handle').replace(/^@/, '');
      if (handle && !/^[\w.-]{3,100}$/.test(handle)) throw new ChannelError('Use a valid YouTube handle');
      const youtubeChannelId = text(payload.youtubeChannelId, 'youtubeChannelId');
      if (youtubeChannelId && !/^UC[\w-]{22}$/.test(youtubeChannelId)) throw new ChannelError('YouTube channel ID must start with UC and contain 24 characters');
      const channelUrl = text(payload.channelUrl, 'channelUrl');
      if (channelUrl) {
        let url;
        try { url = new URL(channelUrl); } catch { throw new ChannelError('Enter a valid YouTube channel URL'); }
        if (url.protocol !== 'https:' || !['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
          throw new ChannelError('Channel URL must be a secure youtube.com address');
        }
      }
      return { displayName, handle, youtubeChannelId, channelUrl };
    }
    case 2:
      return { description: text(payload.description, 'description'), keywords: text(payload.keywords, 'keywords'),
        category: text(payload.category, 'category') || 'Entertainment' };
    case 3: {
      const rawKey = payload.streamKey;
      if (rawKey !== undefined && typeof rawKey !== 'string') throw new ChannelError('Invalid stream key');
      const streamKey = String(rawKey || '').trim();
      if (!streamKey && !hasKey) throw new ChannelError('Enter the stream key for this YouTube channel');
      if (streamKey && (!/^[a-zA-Z0-9_-]{8,180}$/.test(streamKey) || streamKey.startsWith('your-secret'))) {
        throw new ChannelError('Enter a valid YouTube stream key');
      }
      const ingestUrl = String(payload.ingestUrl || 'rtmps://a.rtmps.youtube.com/live2').replace(/\/+$/, '');
      let url;
      try { url = new URL(ingestUrl); } catch { throw new ChannelError('Invalid RTMPS URL'); }
      if (url.protocol !== 'rtmps:' || !ALLOWED_RTMPS.has(url.hostname) || url.pathname !== '/live2' || url.username || url.password || url.search || url.hash) {
        throw new ChannelError('Only the official YouTube RTMPS ingestion endpoints are supported');
      }
      return { streamKey, ingestUrl };
    }
    case 4: {
      const defaultTitle = text(payload.defaultTitle, 'defaultTitle');
      const defaultDescription = text(payload.defaultDescription, 'defaultDescription');
      const privacy = String(payload.privacy || 'private');
      if (!['private', 'unlisted', 'public'].includes(privacy)) throw new ChannelError('Invalid visibility');
      if (typeof payload.loop !== 'boolean') throw new ChannelError('Choose whether to loop your video');
      return { defaultTitle, defaultDescription, privacy, loop: payload.loop };
    }
    default: throw new ChannelError('Invalid setup step');
  }
}

export class SecretBox {
  constructor(key) {
    if (!/^[a-fA-F0-9]{64}$/.test(key || '')) throw new Error('CHANNEL_ENCRYPTION_KEY must be 64 random hexadecimal characters (openssl rand -hex 32)');
    this.key = Buffer.from(key, 'hex');
  }

  encrypt(value) {
    if (!value) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
  }

  decrypt(value) {
    if (!value) return '';
    const [iv, tag, data] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
    if (!iv || iv.length !== 12 || !tag || tag.length !== 16 || !data) throw new Error('Invalid encrypted secret');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }
}

const COLUMNS = `id, display_name AS displayName, handle, youtube_channel_id AS youtubeChannelId,
 channel_url AS channelUrl, youtube_title AS youtubeTitle, description, keywords, category,
 ingest_url AS ingestUrl, default_title AS defaultTitle, default_description AS defaultDescription,
 privacy, loop_video AS \`loop\`, wizard_step AS wizardStep, completed_at AS completedAt,
 stream_key_secret AS streamKeySecret, oauth_refresh_secret AS oauthRefreshSecret,
 created_at AS createdAt, updated_at AS updatedAt`;

function publicChannel(row) {
  if (!row) return null;
  const { streamKeySecret, oauthRefreshSecret, ...safe } = row;
  return { ...safe, loop: Boolean(row.loop), hasStreamKey: Boolean(streamKeySecret),
    youtubeConnected: Boolean(oauthRefreshSecret), ready: Boolean(row.completedAt),
    createdAt: row.createdAt?.toISOString?.() || row.createdAt,
    updatedAt: row.updatedAt?.toISOString?.() || row.updatedAt,
    completedAt: row.completedAt?.toISOString?.() || row.completedAt };
}

export class ChannelStore {
  constructor(pool, secretBox) { this.pool = pool; this.secrets = secretBox; }

  async initialize() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS streamforge_channels (
      id CHAR(36) PRIMARY KEY,
      display_name VARCHAR(100) NOT NULL DEFAULT '',
      handle VARCHAR(100) NOT NULL DEFAULT '',
      youtube_channel_id VARCHAR(80) NOT NULL DEFAULT '',
      channel_url VARCHAR(255) NOT NULL DEFAULT '',
      youtube_title VARCHAR(100) NOT NULL DEFAULT '',
      description TEXT NOT NULL,
      keywords VARCHAR(500) NOT NULL DEFAULT '',
      category VARCHAR(60) NOT NULL DEFAULT 'Entertainment',
      stream_key_secret TEXT NULL,
      oauth_refresh_secret TEXT NULL,
      ingest_url VARCHAR(255) NOT NULL DEFAULT 'rtmps://a.rtmps.youtube.com/live2',
      default_title VARCHAR(100) NOT NULL DEFAULT '',
      default_description TEXT NOT NULL,
      privacy VARCHAR(12) NOT NULL DEFAULT 'private',
      loop_video BOOLEAN NOT NULL DEFAULT TRUE,
      wizard_step TINYINT NOT NULL DEFAULT 0,
      completed_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }

  async list() {
    const [rows] = await this.pool.execute(`SELECT ${COLUMNS} FROM streamforge_channels ORDER BY updated_at DESC`);
    return rows.map(publicChannel);
  }

  async get(id) {
    if (!/^[0-9a-f-]{36}$/i.test(id || '')) throw new ChannelError('Invalid channel ID');
    const [rows] = await this.pool.execute(`SELECT ${COLUMNS} FROM streamforge_channels WHERE id = ? LIMIT 1`, [id]);
    if (!rows[0]) throw new ChannelError('Channel not found', 404);
    return rows[0];
  }

  async getPublic(id) { return publicChannel(await this.get(id)); }

  async create() {
    const id = crypto.randomUUID();
    await this.pool.execute('INSERT INTO streamforge_channels (id, description, default_description) VALUES (?, ?, ?)', [id, '', '']);
    return publicChannel(await this.get(id));
  }

  async saveStep(id, step, payload) {
    const existing = await this.get(id);
    const data = validateChannelStep(step, payload, Boolean(existing.streamKeySecret));
    const mapping = {
      1: { displayName: 'display_name', handle: 'handle', youtubeChannelId: 'youtube_channel_id', channelUrl: 'channel_url' },
      2: { description: 'description', keywords: 'keywords', category: 'category' },
      3: { ingestUrl: 'ingest_url' },
      4: { defaultTitle: 'default_title', defaultDescription: 'default_description', privacy: 'privacy', loop: 'loop_video' },
    };
    const entries = Object.entries(mapping[step]).map(([key, column]) => [column, data[key]]);
    if (step === 3 && data.streamKey) entries.push(['stream_key_secret', this.secrets.encrypt(data.streamKey)]);
    const columns = entries.map(([column]) => `${column} = ?`).join(', ');
    await this.pool.execute(`UPDATE streamforge_channels SET ${columns}, wizard_step = GREATEST(wizard_step, ?) WHERE id = ?`,
      [...entries.map(([, value]) => value), Number(step), id]);
    return publicChannel(await this.get(id));
  }

  async complete(id) {
    const current = await this.get(id);
    if (Number(current.wizardStep) < 4 || !current.displayName || !current.streamKeySecret) {
      throw new ChannelError('Complete all four setup steps and add a stream key first');
    }
    await this.pool.execute('UPDATE streamforge_channels SET completed_at = COALESCE(completed_at, NOW()) WHERE id = ?', [id]);
    return publicChannel(await this.get(id));
  }

  async getStreamKey(id) { return this.secrets.decrypt((await this.get(id)).streamKeySecret); }
  async getOAuthAccount(id) {
    const row = await this.get(id);
    if (!row.oauthRefreshSecret) return null;
    return { refreshToken: this.secrets.decrypt(row.oauthRefreshSecret), channelId: row.youtubeChannelId,
      channelTitle: row.youtubeTitle, description: row.description };
  }
  async setOAuthAccount(id, account) {
    await this.get(id);
    await this.pool.execute(`UPDATE streamforge_channels SET oauth_refresh_secret = ?, youtube_channel_id = ?,
      youtube_title = ?, description = ? WHERE id = ?`,
    [this.secrets.encrypt(account.refreshToken), account.channelId, account.channelTitle, account.description || '', id]);
  }
  async clearOAuthAccount(id) {
    await this.get(id);
    await this.pool.execute('UPDATE streamforge_channels SET oauth_refresh_secret = NULL WHERE id = ?', [id]);
  }
}

// The Android studio runs locally without a login. Keep channel secrets encrypted
// transparently rather than making a single-phone owner manage a separate key.
// The generated key is persistent and remains outside the Git checkout.
export async function resolveChannelEncryptionKey(env = process.env) {
  const provided = String(env.CHANNEL_ENCRYPTION_KEY || '').trim();
  if (provided && provided !== 'YOUR_GENERATED_64_CHARACTER_KEY') return provided;
  if (env.LOCAL_ONLY_MODE !== 'true') return provided;

  const directory = path.resolve(env.DATA_DIR || './data');
  const filename = path.join(directory, 'channel-encryption.key');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    return (await fs.readFile(filename, 'utf8')).trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const created = crypto.randomBytes(32).toString('hex');
  try {
    await fs.writeFile(filename, created + '\n', { flag: 'wx', mode: 0o600 });
    return created;
  } catch (error) {
    // A second local process could have created the key in the meantime.
    if (error.code !== 'EEXIST') throw error;
    return (await fs.readFile(filename, 'utf8')).trim();
  }
}

export async function createChannelStore(env = process.env) {
  if (!env.MYSQL_DATABASE) return null;
  const secrets = new SecretBox(await resolveChannelEncryptionKey(env));
  const pool = mysql.createPool({ host: env.MYSQL_HOST || '127.0.0.1', port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER || 'streamforge', password: env.MYSQL_PASSWORD || '', database: env.MYSQL_DATABASE,
    waitForConnections: true, connectionLimit: 4, enableKeepAlive: true });
  const store = new ChannelStore(pool, secrets);
  try { await store.initialize(); return store; }
  catch (error) { await pool.end(); throw new Error('MySQL setup failed: ' + error.message); }
}
