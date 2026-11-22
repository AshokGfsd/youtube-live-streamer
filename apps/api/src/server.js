import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import { StreamManager } from './stream-manager.js';
import { assertValidConfiguration, safeEquals, validVideoName } from './validation.js';
import { YouTubeAutomation, YouTubeApiError } from './youtube-automation.js';
import { createChannelStore, ChannelError } from './channel-store.js';
import { createFileChannelStore } from './file-channel-store.js';
import { ChannelStudio, registerChannelRoutes } from './channel-studio.js';
import { InstagramLiveManager, registerInstagramLiveRoutes } from './instagram-live.js';

const execFileAsync = promisify(execFile);
const env = process.env;
const { base: rtmpsUrl, maxBytes, previewOrigin, allowAllOrigins } = assertValidConfiguration(env);
const localOnly = env.LOCAL_ONLY_MODE === 'true';
const previewHost = previewOrigin ? new URL(previewOrigin).host : '';
const listenPort = Number(env.PORT || 4000);
const localHosts = new Set([`127.0.0.1:${listenPort}`, `localhost:${listenPort}`]);
const localOrigins = new Set([`http://127.0.0.1:${listenPort}`, `http://localhost:${listenPort}`]);
const dataDir = path.resolve(env.DATA_DIR || './data');
const manager = new StreamManager({
  dataDir, streamKey: env.YOUTUBE_STREAM_KEY, rtmpsUrl,
  videoSettings: {
    width: Number(env.STREAM_WIDTH || 1280),
    height: Number(env.STREAM_HEIGHT || 720),
    fps: Number(env.STREAM_FPS || 30),
    bitrateKbps: Number(env.STREAM_BITRATE_KBPS || 2500),
    preset: env.STREAM_PRESET || 'ultrafast',
  },
});
await manager.initialize();
// OAuth lives only on the loopback Android server. Cloud mode retains owner auth.
const youtube = localOnly ? new YouTubeAutomation({
  dataDir,
  streamKey: env.YOUTUBE_STREAM_KEY,
  clientId: env.GOOGLE_CLIENT_ID,
  clientSecret: env.GOOGLE_CLIENT_SECRET,
  port: Number(env.PORT || 4000),
}) : null;
if (youtube) await youtube.initialize();
const storageMode = String(env.CHANNEL_STORAGE || 'mysql').trim().toLowerCase();
const channelStore = storageMode === 'file' ? await createFileChannelStore(env) : await createChannelStore(env);
const channelStudio = channelStore ? new ChannelStudio({ store: channelStore, dataDir, env, legacyManager: manager }) : null;
if (channelStudio) {
  await channelStudio.configureMode();
  await channelStudio.restore();
}
const instagramLive = channelStudio && localOnly ? new InstagramLiveManager({ store: channelStore, studio: channelStudio, env }) : null;
if (instagramLive) {
  await instagramLive.initialize();
  channelStudio.instagramManager = instagramLive;
}

const app = express();
app.disable('x-powered-by');
// Next.js static exports use inline hydration scripts. Allow them only on the
// loopback-bound personal Android server; retain the usual CSP in cloud mode.
app.use(helmet({ contentSecurityPolicy: localOnly ? false : undefined }));
if (localOnly) {
  app.use((req, res, next) => {
    const requestedHost = req.get('host') || '';
    if (!localHosts.has(requestedHost) && requestedHost !== previewHost) {
      return res.status(403).json({ error: 'Local phone access only' });
    }
    next();
  });
}
app.use(cors((req, callback) => callback(null, {
  origin(origin, done) {
    // Wildcard CORS is an explicit opt-in. Cross-origin control requests still
    // require DASHBOARD_TOKEN, even in loopback-bound personal mode.
    if (allowAllOrigins) return done(null, '*');
    if (localOnly) {
      if (!origin) return done(null, true);
      if (previewOrigin && origin === previewOrigin) return done(null, true);
      try {
        const parsed = new URL(origin);
        const port = Number(env.PORT || 4000);
        if (parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname) && parsed.port === String(port)) {
          return done(null, true);
        }
      } catch { /* reject */ }
      return done(new Error('Origin not allowed'));
    }
    const allowed = (env.FRONTEND_ORIGIN || 'http://localhost:3000').split(',').map((value) => value.trim());
    let sameOrigin = false;
    if (origin && env.WEB_STATIC_DIR) {
      try { sameOrigin = new URL(origin).host === req.get('host'); } catch { /* reject */ }
    }
    if (!origin || allowed.includes(origin) || sameOrigin) return done(null, true);
    done(new Error('Origin not allowed'));
  },
  allowedHeaders: ['Authorization', 'Content-Type'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
})));
// An in-memory direct MP4 playlist may include up to 100 signed CDN URLs.
// The endpoints still validate each URL and never persist those signed links.
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'streamforge-api', localOnly,
  mysqlConfigured: storageMode === 'mysql' && Boolean(channelStore),
  channelStorage: channelStore ? storageMode : 'none',
  multiChannelEnabled: channelStudio?.multiChannelEnabled ?? false }));

app.use('/api', (req, res, next) => {
  // Local pages keep their token-free experience. Cloud Shell preview traffic
  // and cross-origin requests are authenticated, including with wildcard CORS.
  const requestOrigin = req.get('origin');
  const fromLocalPage = localHosts.has(req.get('host') || '') &&
    (!requestOrigin || localOrigins.has(requestOrigin));
  if (localOnly && fromLocalPage) return next();
  if (!safeEquals(req.get('authorization') || '', 'Bearer ' + env.DASHBOARD_TOKEN)) {
    return res.status(401).json({ error: 'Invalid dashboard access token' });
  }
  next();
});

if (youtube) {
  const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 6 * 1024 * 1024, files: 1, fields: 10, fieldSize: 6000 },
    fileFilter: (_req, file, callback) => {
      if (!['image/png', 'image/jpeg'].includes(file.mimetype)) {
        return callback(new YouTubeApiError('Only JPG and PNG images are supported'));
      }
      callback(null, true);
    },
  });

  app.get('/api/youtube/status', (_req, res) => res.json(youtube.status()));

  app.get('/api/youtube/oauth/start', (_req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.redirect(youtube.authorize());
    } catch (error) { next(error); }
  });

  app.get('/api/youtube/oauth/callback', async (req, res) => {
    if (req.query.error) return res.redirect('/?youtube=cancelled');
    try {
      if (channelStudio) {
        const channelId = await channelStudio.exchangePendingOAuth(req.query.code, req.query.state);
        if (channelId) return res.redirect(`/channels?youtube=connected&channel=${encodeURIComponent(channelId)}`);
      }
      await youtube.exchangeCode(req.query.code, req.query.state);
      res.redirect('/?youtube=connected');
    } catch (error) {
      console.error('Google OAuth connection failed:', error instanceof Error ? error.message : 'Unknown error');
      res.redirect('/?youtube=failed');
    }
  });

  app.post('/api/youtube/disconnect', async (_req, res, next) => {
    try { await youtube.disconnect(); res.json(youtube.status()); }
    catch (error) { next(error); }
  });

  app.post('/api/youtube/broadcasts/start', imageUpload.single('thumbnail'), async (req, res, next) => {
    try {
      const current = manager.getStatus();
      if (current.desiredRunning || manager.process) throw new YouTubeApiError('Stop the current stream before creating another broadcast', 409);
      if (channelStudio && channelStudio.runningCount() >= channelStudio.maxStreams) throw new YouTubeApiError('Device concurrent stream limit reached. Stop another stream first.', 409);
      if (!current.video) throw new YouTubeApiError('Upload your video before creating a live broadcast');
      const broadcast = await youtube.createBroadcast(req.body, req.file);
      const stream = await manager.start(req.body.loop !== 'false');
      res.status(201).json({ broadcast, stream });
    } catch (error) { next(error); }
  });

  app.post('/api/youtube/channel', imageUpload.single('banner'), async (req, res, next) => {
    try {
      res.json(await youtube.updateChannel({ description: req.body.description, banner: req.file }));
    } catch (error) { next(error); }
  });
}

registerChannelRoutes(app, { store: channelStore, studio: channelStudio, maxBytes });
registerInstagramLiveRoutes(app, { manager: instagramLive, localOnly });

const uploader = multer({
  storage: multer.diskStorage({
    destination: path.join(dataDir, 'uploads'),
    filename: (_req, file, callback) => callback(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: maxBytes, files: 1, fields: 0 },
  fileFilter(_req, file, callback) {
    if (!validVideoName(file.originalname)) return callback(new Error('Choose an MP4, MOV, MKV, WebM or M4V video'));
    callback(null, true);
  },
});

async function inspectVideo(filename) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type',
    '-of', 'json', filename,
  ], { timeout: 20000, maxBuffer: 1024 * 1024 });
  const metadata = JSON.parse(stdout);
  const hasVideo = metadata.streams?.some((stream) => stream.codec_type === 'video');
  if (!hasVideo) throw new Error('This file does not contain a readable video stream');
  const seconds = Number(metadata.format?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Video duration could not be detected');
  return {
    durationSeconds: Math.round(seconds),
    hasAudio: Boolean(metadata.streams?.some((stream) => stream.codec_type === 'audio')),
  };
}

app.get('/api/status', (_req, res) => res.json(manager.getStatus()));
app.post('/api/upload', (req, res, next) => {
  if (manager.getStatus().desiredRunning || manager.process) {
    return res.status(409).json({ error: 'Stop streaming before uploading another video' });
  }
  uploader.single('video')(req, res, async (error) => {
    if (error) {
      if (req.file?.path) await fs.rm(req.file.path, { force: true });
      return next(error);
    }
    if (!req.file) return res.status(400).json({ error: 'Select a video file to upload' });
    try {
      const videoMetadata = await inspectVideo(req.file.path);
      await manager.setVideo({
        fileName: req.file.filename,
        originalName: path.basename(req.file.originalname).replace(/[\x00-\x1f]/g, '').slice(0, 160),
        sizeBytes: req.file.size,
        ...videoMetadata,
      });
      return res.status(201).json(manager.getStatus());
    } catch (cause) {
      await fs.rm(req.file.path, { force: true }).catch(() => {});
      return next(cause);
    }
  });
});

app.post('/api/start', async (req, res, next) => {
  try {
    if (channelStudio && !manager.getStatus().desiredRunning && channelStudio.runningCount() >= channelStudio.maxStreams) {
      throw new ChannelError('Device concurrent stream limit reached. Stop another stream first.', 409);
    }
    const status = await manager.start(req.body?.loop !== false);
    res.status(202).json(status);
  } catch (error) {
    next(error);
  }
});

app.post('/api/stop', async (_req, res, next) => {
  try {
    res.json(await manager.stop());
  } catch (error) {
    next(error);
  }
});

// Optional prebuilt frontend for Termux: one local HTTP origin, no Next.js build on Android.
if (env.WEB_STATIC_DIR) {
  const staticDir = path.resolve(env.WEB_STATIC_DIR);
  if (!existsSync(path.join(staticDir, 'index.html'))) {
    throw new Error('WEB_STATIC_DIR must contain a prebuilt index.html');
  }
  // Next.js static export writes "instagram-live.html" plus an
  // "instagram-live/" folder for React Server Component payloads. Express's
  // directory redirect would otherwise send /instagram-live to
  // /instagram-live/, where no index.html exists (Cannot GET).
  for (const page of ['channels', 'instagram-live']) {
    app.get([`/${page}`, `/${page}/`], (_req, res) => {
      res.sendFile(path.join(staticDir, `${page}.html`));
    });
  }
  app.use(express.static(staticDir, { extensions: ['html'] }));
}

app.use((error, req, res, _next) => {
  const uploadError = error instanceof multer.MulterError;
  const youtubeError = error instanceof YouTubeApiError;
  const channelError = error instanceof ChannelError;
  const expected = uploadError || youtubeError || channelError || /video|upload|stream|ffmpeg|file|origin|format/i.test(error.message || '');
  if (!expected) console.error('API error:', error);
  const message = uploadError && error.code === 'LIMIT_FILE_SIZE'
    ? req.path.startsWith('/api/youtube') ? 'Image exceeds the 6 MB upload limit' : 'Video exceeds the configured upload limit'
    : expected ? error.message : 'Unexpected server error';
  const status = youtubeError || channelError ? error.status : error.message === 'Origin not allowed' ? 403
    : uploadError || expected ? 400 : 500;
  res.status(status).json({ error: message });
});

const port = Number(env.PORT || 4000);
// Host-header checks are not sufficient protection against LAN clients.
// Never bind an unauthenticated personal Android dashboard to a public NIC.
const host = localOnly ? '127.0.0.1' : (env.LISTEN_HOST || '0.0.0.0');
const server = app.listen(port, host, () => console.log('StreamForge API listening on ' + host + ':' + port));
function shutdown() {
  manager.shutdown();
  instagramLive?.shutdown();
  channelStudio?.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000).unref();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
