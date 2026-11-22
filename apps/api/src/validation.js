import path from 'node:path';
import crypto from 'node:crypto';

export const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v']);

export function validVideoName(name) {
  return VIDEO_EXTENSIONS.has(path.extname(name || '').toLowerCase());
}

export function safeEquals(first, second) {
  if (typeof first !== 'string' || typeof second !== 'string') return false;
  const actual = crypto.createHash('sha256').update(first).digest();
  const expected = crypto.createHash('sha256').update(second).digest();
  return crypto.timingSafeEqual(actual, expected) && first.length === second.length;
}

export function safeLogLine(line, streamKey) {
  const raw = String(line).replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 1000);
  return streamKey ? raw.replaceAll(streamKey, '[REDACTED]') : raw;
}

export function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return '0 B';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function assertValidConfiguration(env) {
  const localOnly = env.LOCAL_ONLY_MODE === 'true';
  const channelStorage = String(env.CHANNEL_STORAGE || 'mysql').trim().toLowerCase();
  if (!['file', 'mysql'].includes(channelStorage)) throw new Error('CHANNEL_STORAGE must be file or mysql');
  if (channelStorage === 'file' && String(env.MULTI_CHANNEL_ENABLED || 'false').toLowerCase() !== 'false') {
    throw new Error('CHANNEL_STORAGE=file supports single-channel mode only; set MULTI_CHANNEL_ENABLED=false');
  }
  if (localOnly && (env.LISTEN_HOST !== '127.0.0.1' || !env.WEB_STATIC_DIR)) {
    throw new Error('LOCAL_ONLY_MODE requires LISTEN_HOST=127.0.0.1 and WEB_STATIC_DIR');
  }
  if (!localOnly && (!env.DASHBOARD_TOKEN || env.DASHBOARD_TOKEN.length < 24 || env.DASHBOARD_TOKEN === 'replace-with-long-random-token')) {
    throw new Error('Set DASHBOARD_TOKEN to at least 24 random characters');
  }
  if (env.YOUTUBE_STREAM_KEY && !/^[a-zA-Z0-9_-]+$/.test(env.YOUTUBE_STREAM_KEY)) {
    throw new Error('YOUTUBE_STREAM_KEY must contain only letters, numbers, underscores or hyphens');
  }
  const base = env.YOUTUBE_RTMPS_URL || 'rtmps://a.rtmps.youtube.com/live2';
  if (!base.startsWith('rtmps://')) throw new Error('YOUTUBE_RTMPS_URL must be an rtmps:// address');
  const maxGb = Number(env.MAX_UPLOAD_GB || 4);
  if (!Number.isFinite(maxGb) || maxGb <= 0 || maxGb > 20) throw new Error('MAX_UPLOAD_GB must be between 0 and 20');
  return { base, maxBytes: Math.floor(maxGb * 1024 ** 3) };
}
