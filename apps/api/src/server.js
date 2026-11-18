import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import { StreamManager } from './stream-manager.js';
import { assertValidConfiguration, safeEquals, validVideoName } from './validation.js';

const execFileAsync = promisify(execFile);
const env = process.env;
const { base: rtmpsUrl, maxBytes } = assertValidConfiguration(env);
const dataDir = path.resolve(env.DATA_DIR || './data');
const manager = new StreamManager({ dataDir, streamKey: env.YOUTUBE_STREAM_KEY, rtmpsUrl });
await manager.initialize();

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    const allowed = (env.FRONTEND_ORIGIN || 'http://localhost:3000').split(',').map((value) => value.trim());
    if (!origin || allowed.includes(origin)) return callback(null, true);
    callback(new Error('Origin not allowed'));
  },
  allowedHeaders: ['Authorization', 'Content-Type'],
  methods: ['GET', 'POST', 'OPTIONS'],
}));
app.use(express.json({ limit: '32kb' }));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'streamforge-api' }));

app.use('/api', (req, res, next) => {
  const expected = 'Bearer ' + env.DASHBOARD_TOKEN;
  if (!safeEquals(req.get('authorization') || '', expected)) {
    return res.status(401).json({ error: 'Invalid dashboard access token' });
  }
  next();
});

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

app.use((error, _req, res, _next) => {
  const uploadError = error instanceof multer.MulterError;
  const expected = uploadError || /video|upload|stream|ffmpeg|file|origin|format/i.test(error.message || '');
  if (!expected) console.error('API error:', error);
  const message = uploadError && error.code === 'LIMIT_FILE_SIZE'
    ? 'Video exceeds the configured upload limit'
    : expected ? error.message : 'Unexpected server error';
  const status = error.message === 'Origin not allowed' ? 403
    : uploadError || expected ? 400 : 500;
  res.status(status).json({ error: message });
});

const port = Number(env.PORT || 4000);
const server = app.listen(port, '0.0.0.0', () => console.log('StreamForge API listening on port ' + port));
function shutdown() {
  manager.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000).unref();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
