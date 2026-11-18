import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import multer from 'multer';
import { StreamManager } from './stream-manager.js';
import { YouTubeAutomation, YouTubeApiError } from './youtube-automation.js';
import { ChannelError } from './channel-store.js';
import { validVideoName } from './validation.js';

const execFileAsync = promisify(execFile);

export class ChannelStudio {
  constructor({ store, dataDir, env, legacyManager }) {
    this.store = store;
    this.dataDir = dataDir;
    this.env = env;
    this.legacyManager = legacyManager;
    this.managers = new Map();
    this.youtubes = new Map();
    this.maxStreams = Math.max(1, Math.min(8, Number(env.MAX_CONCURRENT_STREAMS || 1)));
  }

  get videoSettings() {
    return { width: Number(this.env.STREAM_WIDTH || 1280), height: Number(this.env.STREAM_HEIGHT || 720),
      fps: Number(this.env.STREAM_FPS || 30), bitrateKbps: Number(this.env.STREAM_BITRATE_KBPS || 2500),
      preset: this.env.STREAM_PRESET || 'ultrafast' };
  }

  runningCount() {
    return Number(Boolean(this.legacyManager?.getStatus().desiredRunning)) +
      [...this.managers.values()].filter((manager) => manager.getStatus().desiredRunning).length +
      Number(Boolean(this.instagramManager?.process || this.instagramManager?.starting));
  }

  async managerFor(id) {
    const row = await this.store.get(id);
    let manager = this.managers.get(id);
    if (manager) {
      // Picking up an edited channel stream key does not interrupt an existing stream.
      if (!manager.getStatus().desiredRunning) {
        manager.streamKey = await this.store.getStreamKey(id);
        manager.rtmpsUrl = row.ingestUrl.replace(/\/+$/, '');
      }
      return manager;
    }
    manager = new StreamManager({ dataDir: path.join(this.dataDir, 'channels', id),
      streamKey: await this.store.getStreamKey(id), rtmpsUrl: row.ingestUrl, videoSettings: this.videoSettings });
    await manager.initialize({ resume: this.runningCount() < this.maxStreams });
    this.managers.set(id, manager);
    return manager;
  }

  async restore() {
    const channels = await this.store.list();
    for (const channel of channels) {
      if (!channel.hasStreamKey) continue;
      // Restore streams intentionally after a server reboot; old inactive profiles
      // simply reconstruct their state and remain idle.
      await this.managerFor(channel.id);
    }
  }

  async start(id, loop) {
    const channel = await this.store.get(id);
    if (!channel.completedAt) throw new ChannelError('Finish channel setup before starting a stream');
    const manager = await this.managerFor(id);
    if (this.runningCount() >= this.maxStreams) {
      throw new ChannelError(`This device allows ${this.maxStreams} simultaneous stream(s). Stop an existing stream first.`, 409);
    }
    return manager.start(loop);
  }

  async youtubeFor(id) {
    const manager = await this.managerFor(id);
    let youtube = this.youtubes.get(id);
    if (youtube) { youtube.streamKey = manager.streamKey; return youtube; }
    youtube = new YouTubeAutomation({ dataDir: path.join(this.dataDir, 'channels', id),
      streamKey: manager.streamKey, clientId: this.env.GOOGLE_CLIENT_ID,
      clientSecret: this.env.GOOGLE_CLIENT_SECRET, port: Number(this.env.PORT || 4000),
      accountStore: {
        load: () => this.store.getOAuthAccount(id),
        save: (account) => this.store.setOAuthAccount(id, account),
        delete: () => this.store.clearOAuthAccount(id),
      },
    });
    await youtube.initialize();
    this.youtubes.set(id, youtube);
    return youtube;
  }

  async exchangePendingOAuth(code, state) {
    for (const [id, youtube] of this.youtubes) {
      if (youtube.pendingState?.value === state) {
        await youtube.exchangeCode(code, state);
        return id;
      }
    }
    return null;
  }

  shutdown() { for (const manager of this.managers.values()) manager.shutdown(); }
}

async function inspectVideo(file) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file,
  ], { timeout: 20_000, maxBuffer: 1024 * 1024 });
  const metadata = JSON.parse(stdout);
  if (!metadata.streams?.some((stream) => stream.codec_type === 'video')) throw new ChannelError('File does not contain a video stream');
  const duration = Number(metadata.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new ChannelError('Could not read video duration');
  return { durationSeconds: Math.round(duration), hasAudio: metadata.streams.some((stream) => stream.codec_type === 'audio') };
}

export function registerChannelRoutes(app, { store, studio, maxBytes }) {
  app.get('/api/channels', async (_req, res) => {
    if (!store) return res.json({ configured: false, channels: [], maxConcurrentStreams: 1 });
    const channels = await store.list();
    res.json({ configured: true, maxConcurrentStreams: studio.maxStreams,
      channels: await Promise.all(channels.map(async (channel) => ({ ...channel,
        stream: channel.hasStreamKey ? (await studio.managerFor(channel.id)).getStatus() : null }))) });
  });
  app.use('/api/channels', (req, _res, next) => store ? next() : next(new ChannelError('Configure MYSQL_DATABASE and CHANNEL_ENCRYPTION_KEY to enable channel management', 503)));
  app.post('/api/channels', async (_req, res) => res.status(201).json(await store.create()));
  app.get('/api/channels/:id', async (req, res) => {
    const channel = await store.getPublic(req.params.id);
    res.json({ ...channel, stream: channel.hasStreamKey ? (await studio.managerFor(channel.id)).getStatus() : null });
  });
  app.patch('/api/channels/:id/steps/:step', async (req, res) => {
    const step = Number(req.params.step);
    res.json(await store.saveStep(req.params.id, step, req.body));
  });
  app.post('/api/channels/:id/complete', async (req, res) => res.json(await store.complete(req.params.id)));

  app.use('/api/channels/:id/upload', async (req, _res, next) => {
    try {
      req.channelManager = await studio.managerFor(req.params.id);
      if (req.channelManager.getStatus().desiredRunning || req.channelManager.process) throw new ChannelError('Stop this channel stream before replacing its video', 409);
      next();
    } catch (error) { next(error); }
  });
  const uploader = multer({ storage: multer.diskStorage({
    destination(req, _file, callback) { callback(null, path.join(studio.dataDir, 'channels', req.params.id, 'uploads')); },
    filename(_req, file, callback) { callback(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()); },
  }), limits: { fileSize: maxBytes, files: 1, fields: 0 },
  fileFilter(_req, file, callback) { callback(null, validVideoName(file.originalname)); } });

  app.post('/api/channels/:id/upload', (req, res, next) => {
    uploader.single('video')(req, res, async (error) => {
      if (error) return next(error);
      if (!req.file) return next(new ChannelError('Choose an MP4, MOV, MKV, WebM or M4V video'));
      try {
        await req.channelManager.setVideo({ fileName: req.file.filename,
          originalName: path.basename(req.file.originalname).replace(/[\x00-\x1f]/g, '').slice(0, 160),
          sizeBytes: req.file.size, ...await inspectVideo(req.file.path) });
        res.status(201).json(req.channelManager.getStatus());
      } catch (cause) {
        await fs.rm(req.file.path, { force: true }).catch(() => {});
        next(cause);
      }
    });
  });

  app.post('/api/channels/:id/start', async (req, res) => {
    res.status(202).json(await studio.start(req.params.id, req.body?.loop !== false));
  });
  app.post('/api/channels/:id/stop', async (req, res) => {
    res.json(await (await studio.managerFor(req.params.id)).stop());
  });
  app.get('/api/channels/:id/youtube/status', async (req, res) => res.json((await studio.youtubeFor(req.params.id)).status()));
  app.get('/api/channels/:id/youtube/oauth/start', async (req, res) => {
    if (studio.env.LOCAL_ONLY_MODE !== 'true') throw new ChannelError('Multi-channel Google sign-in currently requires Android loopback mode');
    res.set('Cache-Control', 'no-store');
    res.redirect((await studio.youtubeFor(req.params.id)).authorize());
  });
  app.post('/api/channels/:id/youtube/disconnect', async (req, res) => {
    const youtube = await studio.youtubeFor(req.params.id);
    await youtube.disconnect();
    res.json(youtube.status());
  });
  const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024, files: 1 },
    fileFilter(_req, file, callback) { callback(null, ['image/png', 'image/jpeg'].includes(file.mimetype)); } });
  app.post('/api/channels/:id/youtube/broadcasts/start', imageUpload.single('thumbnail'), async (req, res) => {
    const manager = await studio.managerFor(req.params.id);
    if (manager.getStatus().desiredRunning || manager.process) throw new ChannelError('Stop this channel stream before creating a broadcast', 409);
    if (!manager.getStatus().video) throw new ChannelError('Upload a video for this channel first');
    if (studio.runningCount() >= studio.maxStreams) throw new ChannelError('Concurrent stream limit reached', 409);
    const youtube = await studio.youtubeFor(req.params.id);
    if (!youtube.status().connected) throw new YouTubeApiError('Connect this channel with Google first');
    const broadcast = await youtube.createBroadcast(req.body, req.file);
    const stream = await studio.start(req.params.id, req.body.loop !== 'false');
    res.status(201).json({ broadcast, stream });
  });
}
