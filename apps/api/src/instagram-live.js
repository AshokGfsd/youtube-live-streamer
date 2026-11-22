import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChannelError } from './channel-store.js';
import { InstagramReelsController, findInstagramTab } from './instagram-cdp.js';
import { InstagramPlaylistStore, normalizeReelUrl } from './instagram-playlist.js';
import { InstagramMediaProber } from './instagram-media-probe.js';
import { InstagramMediaCollector } from './instagram-media-collector.js';
import { buildDirectMediaFfmpegArgs, directMediaManifest, validateDirectMediaPlaylist } from './instagram-direct-media.js';

const IPHONE_FRAME = fileURLToPath(new URL('./assets/iphone-frame.svg', import.meta.url));

const DEFAULTS = Object.freeze({
  title: '', description: '', privacy: 'private', scroll: 'wheel',
  mobileLayout: true, frame: 'iphone', sourceMode: 'browser', playlistMode: 'feed', playlistLoop: true,
  captureWidth: 540, captureHeight: 960, captureX: 0, captureY: 0,
  fps: 15, bitrateKbps: 1200, audio: 'silent', createBroadcast: false,
});

function intInRange(value, field, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new ChannelError(`${field} must be between ${min} and ${max}`);
  return value;
}

export function validateInstagramSettings(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ChannelError('Invalid Instagram live settings');
  const input = { ...DEFAULTS, ...payload };
  for (const field of ['title', 'description']) {
    if (typeof input[field] !== 'string' || input[field].length > (field === 'title' ? 100 : 5000)) {
      throw new ChannelError(`${field} has an invalid length`);
    }
  }
  if (!['private', 'unlisted', 'public'].includes(input.privacy)) throw new ChannelError('Invalid YouTube privacy');
  if (!['wheel', 'arrow'].includes(input.scroll)) throw new ChannelError('Scroll mode must be wheel or arrow');
  if (typeof input.mobileLayout !== 'boolean') throw new ChannelError('Invalid mobile Reels layout setting');
  if (!['iphone', 'none'].includes(input.frame)) throw new ChannelError('Invalid live video frame setting');
  if (!['feed', 'selected'].includes(input.playlistMode)) throw new ChannelError('Choose Feed or Selected Reels mode');
  if (!['browser', 'direct'].includes(input.sourceMode)) throw new ChannelError('Choose Browser or Direct MP4 live source');
  if (typeof input.playlistLoop !== 'boolean') throw new ChannelError('Playlist loop must be enabled or disabled');
  if (!['silent', 'pulse'].includes(input.audio)) throw new ChannelError('Audio must be silent or PulseAudio monitor');
  if (typeof input.createBroadcast !== 'boolean') throw new ChannelError('Invalid automatic broadcast setting');
  for (const field of ['captureWidth', 'captureHeight']) intInRange(input[field], field, 240, 1920);
  // H.264 / yuv420p requires even capture dimensions.
  if (input.captureWidth % 2 || input.captureHeight % 2) throw new ChannelError('Capture dimensions must be even numbers');
  if (input.mobileLayout && input.captureWidth >= input.captureHeight) {
    throw new ChannelError('Mobile Reels requires portrait capture: width must be smaller than height');
  }
  for (const field of ['captureX', 'captureY']) intInRange(input[field], field, 0, 4000);
  intInRange(input.fps, 'fps', 5, 30);
  intInRange(input.bitrateKbps, 'bitrateKbps', 300, 5000);
  return Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, input[key]]));
}

// The browser displays a 360x640 CSS page in the top-left of a 540x960 X11
// desktop. Crop the *playing video element*, not the surrounding white page.
// The Instagram watcher measures the same video on each auto-scroll cycle.
export function reelCaptureCrop(rect, { captureWidth, captureHeight }, viewport = null) {
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
    throw new ChannelError('Playing Reel bounds unavailable; play a Reel before starting the iPhone layout');
  }
  // CDP getBoundingClientRect returns CSS pixels. X11grab captures *physical*
  // pixels; when Chrome emulates a 360px phone on a 540px X11 display, its
  // coordinates must be scaled by 1.5 before cropping. Without this the crop
  // zooms into one side of the Reel and can cut into Instagram's overlay UI.
  const scaleX = viewport?.viewportWidth > 0 ? captureWidth / viewport.viewportWidth : 1;
  const scaleY = viewport?.viewportHeight > 0 ? captureHeight / viewport.viewportHeight : 1;
  const left = Math.max(0, Math.floor(rect.x * scaleX / 2) * 2);
  const top = Math.max(0, Math.floor(rect.y * scaleY / 2) * 2);
  const right = Math.min(captureWidth, Math.floor((rect.x + rect.width) * scaleX / 2) * 2);
  const bottom = Math.min(captureHeight, Math.floor((rect.y + rect.height) * scaleY / 2) * 2);
  const width = right - left;
  const height = bottom - top;
  if (width < 100 || height < 150 || left + width > captureWidth || top + height > captureHeight) {
    throw new ChannelError('The playing Reel is outside the X11 capture area. Check kiosk positioning and resolution.');
  }
  return { x: left, y: top, width, height };
}

export function buildInstagramFfmpegArgs(settings, ingestUrl, streamKey, display = ':1', videoRect = null, viewport = null) {
  const config = validateInstagramSettings(settings);
  const phoneFrame = config.mobileLayout && config.frame === 'iphone';
  const crop = phoneFrame ? reelCaptureCrop(videoRect, config, viewport) : null;
  // Ingest URL and stream key have already been validated by ChannelStore.
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'warning',
    '-thread_queue_size', '512', '-f', 'x11grab', '-draw_mouse', '0',
    '-framerate', String(config.fps), '-video_size', `${config.captureWidth}x${config.captureHeight}`,
    '-i', `${display}.0+${config.captureX},${config.captureY}`,
    '-thread_queue_size', '512'];
  if (config.audio === 'pulse') args.push('-f', 's16le', '-ar', '44100', '-ac', '2', '-i', 'pipe:0');
  else args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  if (phoneFrame) {
    // A transparent SVG phone frame is copied alongside the API source. The
    // original X11 feed stays untouched; only the encoded stream is composed.
    const videoWidth = Math.floor(config.captureWidth * 448 / 540 / 2) * 2;
    const videoHeight = Math.floor(config.captureHeight * 796 / 960 / 2) * 2;
    const videoX = Math.floor((config.captureWidth - videoWidth) / 2);
    const videoY = Math.floor((config.captureHeight - videoHeight) / 2);
    args.push('-loop', '1', '-framerate', String(config.fps), '-i', IPHONE_FRAME);
    args.push('-filter_complex',
      `[0:v]crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},` +
      `scale=${videoWidth}:${videoHeight}:force_original_aspect_ratio=increase:flags=lanczos,` +
      `crop=${videoWidth}:${videoHeight},setsar=1,` +
      `pad=${config.captureWidth}:${config.captureHeight}:${videoX}:${videoY}:color=black,format=rgba[reel];` +
      `[2:v]scale=${config.captureWidth}:${config.captureHeight}:flags=bicubic,format=rgba[frame];` +
      '[reel][frame]overlay=0:0:format=auto,format=yuv420p[composed]');
  }
  args.push('-map', phoneFrame ? '[composed]' : '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-r', String(config.fps),
    '-g', String(config.fps * 2), '-b:v', `${config.bitrateKbps}k`,
    '-maxrate', `${config.bitrateKbps}k`, '-bufsize', `${config.bitrateKbps * 2}k`,
    '-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-f', 'flv',
    `${ingestUrl.replace(/\/+$/, '')}/${streamKey}`);
  return args;
}

function safeFfmpegMessage(value, key) {
  return String(value).split(key).join('[hidden]').replace(/rtmps:\/\/[^\s]+/g, '[RTMPS destination]')
    .replace(/https?:\/\/[^\s]+/g, '[URL]').trim().slice(0, 240);
}

export class InstagramLiveManager {
  constructor({ store, studio, env = process.env, spawnProcess = spawn, makeController = (options) => new InstagramReelsController(options) }) {
    this.store = store;
    this.playlist = new InstagramPlaylistStore(store);
    this.mediaProber = new InstagramMediaProber();
    this.mediaCollector = new InstagramMediaCollector({ port: Number(env.INSTAGRAM_CDP_PORT || 9222) });
    this.studio = studio;
    this.env = env;
    this.spawnProcess = spawnProcess;
    this.makeController = makeController;
    this.process = null;
    this.audioProcess = null;
    this.controller = null;
    this.activeChannelId = null;
    this.starting = false;
    this.startedAt = null;
    this.feedState = null;
    this.error = null;
    this.logs = [];
    this.broadcast = null;
    this.playlistState = null;
    this.sourceMode = null;
    this.mediaTempDir = null;
    this.directMediaUrls = [];
    this.directStartIndex = 0;
  }

  async initialize() {
    await this.store.pool.query(`CREATE TABLE IF NOT EXISTS streamforge_instagram_live (
      channel_id CHAR(36) PRIMARY KEY,
      settings_json JSON NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_instagram_channel FOREIGN KEY (channel_id) REFERENCES streamforge_channels(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await this.playlist.initialize();
  }

  async getSettings(id) {
    const channel = await this.store.getPublic(id);
    const [rows] = await this.store.pool.execute('SELECT settings_json FROM streamforge_instagram_live WHERE channel_id = ?', [id]);
    const saved = rows[0]?.settings_json;
    const object = typeof saved === 'string' ? JSON.parse(saved) : saved;
    return validateInstagramSettings({ ...DEFAULTS,
      title: channel.defaultTitle || '', description: channel.defaultDescription || '', privacy: channel.privacy || 'private',
      ...(object || {}),
    });
  }

  async saveSettings(id, data) {
    await this.store.getPublic(id);
    const existing = await this.getSettings(id);
    const settings = validateInstagramSettings({ ...existing, ...data });
    await this.store.pool.execute(`INSERT INTO streamforge_instagram_live (channel_id, settings_json)
      VALUES (?, ?) ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json)`, [id, JSON.stringify(settings)]);
    return settings;
  }

  appendLog(message) {
    if (message) this.logs = [...this.logs.slice(-19), message];
  }

  getStatus() {
    return { running: Boolean(this.process), starting: this.starting, sourceMode: this.sourceMode,
      activeChannelId: this.activeChannelId, startedAt: this.startedAt,
      feed: this.feedState ? { phase: this.feedState.phase, activeId: this.feedState.activeId,
        currentTime: this.feedState.currentTime, duration: this.feedState.duration } : null,
      playlist: this.playlistState, error: this.error, logs: this.logs, broadcast: this.broadcast,
      directControl: this.sourceMode === 'direct' ? {
        count: this.directMediaUrls.length, lastSelectedIndex: this.directStartIndex,
      } : null };
  }

  async browserStatus() {
    await findInstagramTab(Number(this.env.INSTAGRAM_CDP_PORT || 9222));
    return { ready: true, message: 'Instagram Reels tab found in private Chrome' };
  }

  async currentReel() {
    const tab = await findInstagramTab(Number(this.env.INSTAGRAM_CDP_PORT || 9222));
    const reel = normalizeReelUrl(tab.url);
    return { ...reel, label: `Reel ${reel.shortcode}` };
  }

  async start(id, rightsConfirmed, mediaUrls = undefined) {
    if (rightsConfirmed !== true) throw new ChannelError('Confirm you have rights to broadcast the Instagram Reels and audio', 400);
    if (this.mediaCollector.phase === 'running') throw new ChannelError('Wait for Instagram search collection to finish or stop it before starting YouTube Live', 409);
    if (this.starting || this.process || this.activeChannelId) throw new ChannelError('Instagram feed is already streaming or starting', 409);
    if (this.studio.runningCount() >= this.studio.maxStreams) throw new ChannelError('Stop another channel stream first (device concurrency limit)', 409);
    const channel = await this.store.get(id);
    if (!channel.completedAt || !channel.streamKeySecret) throw new ChannelError('Finish YouTube channel setup and save a stream key first');
    const settings = await this.getSettings(id);
    const directUrls = settings.sourceMode === 'direct' ? validateDirectMediaPlaylist(mediaUrls) : [];
    const chosenReels = settings.sourceMode === 'browser' && settings.playlistMode === 'selected' ? await this.playlist.list(id) : [];
    if (settings.sourceMode === 'browser' && settings.playlistMode === 'selected' && chosenReels.length === 0) {
      throw new ChannelError('Your selected Reels playlist is empty. Add at least one Reel before going live.');
    }
    if (settings.createBroadcast && !settings.title.trim()) throw new ChannelError('Enter a live title before creating a YouTube broadcast');
    const key = await this.store.getStreamKey(id);
    this.starting = true;
    this.activeChannelId = id;
    this.error = null;
    this.logs = [];
    this.broadcast = null;
    this.feedState = null;
    this.sourceMode = settings.sourceMode;
    this.directMediaUrls = directUrls;
    this.directStartIndex = 0;
    this.playlistState = directUrls.length ? { current: null, total: directUrls.length,
      loop: settings.playlistLoop, reelUrl: null } : chosenReels.length ? { current: 1, total: chosenReels.length,
      loop: settings.playlistLoop, reelUrl: chosenReels[0].reelUrl } : null;
    try {
      let browserState = null;
      if (!directUrls.length) {
        this.controller = this.makeController({ port: Number(this.env.INSTAGRAM_CDP_PORT || 9222), scroll: settings.scroll,
          mobileLayout: settings.mobileLayout, captureWidth: settings.captureWidth, captureHeight: settings.captureHeight,
          playlistUrls: chosenReels.map((item) => item.reelUrl), playlistLoop: settings.playlistLoop,
          onPlaylistPosition: (index) => {
            this.playlistState = { current: index + 1, total: chosenReels.length,
              loop: settings.playlistLoop, reelUrl: chosenReels[index].reelUrl };
          },
          onPlaylistEnd: () => {
            this.appendLog('Selected Reels playlist finished. Ending the encoder.');
            this.stop().catch(() => {});
          },
          onState: (state) => { this.feedState = state; },
          onError: (error) => { this.fail(error instanceof Error ? error.message : 'Instagram controller stopped'); },
        });
        browserState = await this.controller.connect();
      }
      if (settings.createBroadcast) {
        const youtube = await this.studio.youtubeFor(id);
        if (!youtube.status().connected) throw new ChannelError('Connect this channel to YouTube in Channels first, or disable automatic broadcast creation');
        this.broadcast = await youtube.createBroadcast({ title: settings.title, description: settings.description, privacy: settings.privacy });
      }
      let args;
      if (directUrls.length) {
        this.mediaTempDir = await mkdtemp(join(tmpdir(), 'streamforge-direct-'));
        const manifest = join(this.mediaTempDir, 'playlist.ffconcat');
        await writeFile(manifest, directMediaManifest(directUrls), { mode: 0o600, flag: 'wx' });
        args = buildDirectMediaFfmpegArgs(settings, channel.ingestUrl, key, manifest, IPHONE_FRAME);
      } else {
        args = buildInstagramFfmpegArgs(settings, channel.ingestUrl, key,
          this.env.INSTAGRAM_DISPLAY || ':1', browserState?.videoRect, browserState);
      }
      if (!directUrls.length && settings.audio === 'pulse') {
        this.audioProcess = this.spawnProcess('parec', ['--device=@DEFAULT_MONITOR@', '--format=s16le', '--rate=44100', '--channels=2'],
          { stdio: ['ignore', 'pipe', 'pipe'] });
        this.audioProcess.once('error', (error) => this.fail('PulseAudio monitor not available: ' + error.message));
      }
      const child = this.spawnProcess('ffmpeg', args, { stdio: [this.audioProcess ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
      this.process = child;
      if (this.audioProcess) {
        this.audioProcess.stdout?.pipe(child.stdin);
        this.audioProcess.stderr?.on('data', () => {});
        this.audioProcess.once('exit', () => { if (this.process === child) this.fail('PulseAudio monitor stopped unexpectedly'); });
      }
      child.stderr?.on('data', (chunk) => {
        for (const line of String(chunk).split('\n').filter(Boolean)) this.appendLog(safeFfmpegMessage(line, key));
      });
      child.once('exit', (code) => {
        if (this.process !== child) return;
        this.process = null;
        this.audioProcess?.kill('SIGTERM');
        this.audioProcess = null;
        this.controller?.stop().catch(() => {});
        this.controller = null;
        this.cleanupMediaManifest().catch(() => {});
        this.activeChannelId = null;
        if (code === 0 && directUrls.length && !settings.playlistLoop) this.appendLog('Direct MP4 playlist completed.');
        else this.error ||= `FFmpeg exited${code === null ? '' : ` (code ${code})`}. Check media URLs and RTMPS connection.`;
        this.sourceMode = null;
        this.startedAt = null;
        this.playlistState = null;
        this.directMediaUrls = [];
        this.directStartIndex = 0;
      });
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      this.startedAt = new Date().toISOString();
      this.appendLog(directUrls.length
        ? `Direct MP4 playlist started: ${directUrls.length} clip(s), ${settings.playlistLoop ? 'looping' : 'play once'}. VNC/Chrome is NOT the video source; MP4 audio is used when present.`
        : settings.mobileLayout
        ? `${settings.frame === 'iphone' ? 'iPhone frame around the playing Reel' : 'Mobile screen capture'}; CSS viewport: ${browserState?.viewportWidth ?? '?'}x${browserState?.viewportHeight ?? '?'}; X11 capture: ${settings.captureWidth}x${settings.captureHeight}. Check YouTube Studio.`
        : 'Desktop screen capture started. Reels will scroll after playback ends.');
      if (chosenReels.length) this.appendLog(`Selected Reels playlist: ${chosenReels.length} video(s), ${settings.playlistLoop ? 'looping' : 'play once'}.`);
      this.controller?.run().catch((error) => this.fail(error.message));
      return this.getStatus();
    } catch (error) {
      await this.stop();
      throw error;
    } finally { this.starting = false; }
  }

  // FFmpeg's concat demuxer reads a fixed manifest. To change its input while
  // live, replace the encoder, keeping the existing YouTube event and stream
  // key. This causes a brief ingest gap; it is NOT a seamless frame-level cut.
  async switchDirect(id, rightsConfirmed, mediaUrls, startIndex = 0) {
    if (rightsConfirmed !== true) throw new ChannelError('Confirm you have rights to broadcast the replacement videos', 400);
    if (this.sourceMode !== 'direct' || this.activeChannelId !== id || !this.process) {
      throw new ChannelError('Start a Direct MP4 livestream on this channel before switching videos', 409);
    }
    if (this.starting) throw new ChannelError('Wait for the current encoder change to finish', 409);
    if (this.mediaCollector.phase === 'running') throw new ChannelError('Wait for the new topic search to finish before switching', 409);
    const urls = mediaUrls === undefined ? this.directMediaUrls : validateDirectMediaPlaylist(mediaUrls);
    if (!urls.length) throw new ChannelError('No active direct MP4 playlist is available; collect a new one', 409);
    if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= urls.length) {
      throw new ChannelError('Choose a video number within the playlist', 400);
    }
    this.starting = true;
    let replacedEncoder = false;
    try {
      const channel = await this.store.get(id);
      const key = await this.store.getStreamKey(id);
      const settings = { ...(await this.getSettings(id)), sourceMode: 'direct' };
      if (this.sourceMode !== 'direct' || this.activeChannelId !== id || !this.process) {
        throw new ChannelError('The original livestream ended before the switch could start', 409);
      }
      const previous = this.process;
      this.process = null; // The old exit handler must not clear the active session.
      replacedEncoder = true;
      await new Promise((resolve) => {
        let settled = false;
        let timer;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        };
        previous.once('exit', finish);
        previous.once('close', finish);
        timer = setTimeout(() => { previous.kill('SIGKILL'); finish(); }, 4000);
        previous.kill('SIGTERM');
        if (previous.exitCode !== null && previous.exitCode !== undefined) finish();
      });
      await this.cleanupMediaManifest();
      const ordered = settings.playlistLoop
        ? [...urls.slice(startIndex), ...urls.slice(0, startIndex)] : urls.slice(startIndex);
      this.mediaTempDir = await mkdtemp(join(tmpdir(), 'streamforge-direct-'));
      const manifestPath = join(this.mediaTempDir, 'playlist.ffconcat');
      await writeFile(manifestPath, directMediaManifest(ordered), { mode: 0o600, flag: 'wx' });
      const args = buildDirectMediaFfmpegArgs(settings, channel.ingestUrl, key, manifestPath, IPHONE_FRAME);
      const child = this.spawnProcess('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      this.process = child;
      child.stderr?.on('data', (chunk) => {
        for (const line of String(chunk).split('\n').filter(Boolean)) this.appendLog(safeFfmpegMessage(line, key));
      });
      child.once('exit', (code) => {
        if (this.process !== child) return;
        this.process = null;
        this.cleanupMediaManifest().catch(() => {});
        this.activeChannelId = null;
        this.sourceMode = null;
        this.startedAt = null;
        this.playlistState = null;
        this.directMediaUrls = [];
        this.directStartIndex = 0;
        this.error ||= `FFmpeg exited${code === null ? '' : ` (code ${code})`}. Check media URLs and RTMPS connection.`;
      });
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      this.directMediaUrls = urls;
      this.directStartIndex = startIndex;
      this.playlistState = { current: null, total: urls.length, loop: settings.playlistLoop, reelUrl: null };
      this.error = null;
      this.appendLog(`${mediaUrls === undefined ? 'Video selection' : 'New topic playlist'}: encoder reconnected, starting at video ${startIndex + 1}/${urls.length}. YouTube may briefly buffer.`);
      return this.getStatus();
    } catch (error) {
      // If validation/DB lookups failed, the previous encoder is still live.
      // After stopping it, however, a failed replacement must clean up.
      if (replacedEncoder) await this.stop();
      throw error;
    } finally {
      this.starting = false;
    }
  }

  fail(message) {
    this.error = message;
    this.appendLog(message);
    this.stop().catch(() => {});
  }

  async cleanupMediaManifest() {
    const dir = this.mediaTempDir;
    this.mediaTempDir = null;
    if (dir) await rm(dir, { recursive: true, force: true });
  }

  async stop() {
    const child = this.process;
    this.process = null;
    this.audioProcess?.kill('SIGTERM');
    this.audioProcess = null;
    child?.kill('SIGTERM');
    const watcher = this.controller;
    this.controller = null;
    this.activeChannelId = null;
    this.startedAt = null;
    this.feedState = null;
    this.playlistState = null;
    this.sourceMode = null;
    this.directMediaUrls = [];
    this.directStartIndex = 0;
    await watcher?.stop();
    await this.cleanupMediaManifest();
    return this.getStatus();
  }

  shutdown() {
    this.process?.kill('SIGTERM');
    this.audioProcess?.kill('SIGTERM');
    this.controller?.stop().catch(() => {});
    this.cleanupMediaManifest().catch(() => {});
    this.mediaCollector.stop();
  }
}

export function registerInstagramLiveRoutes(app, { manager, localOnly }) {
  const ensureReady = (_req, _res, next) => {
    if (!localOnly) return next(new ChannelError('Instagram screen capture is available only in private loopback mode', 403));
    if (!manager) return next(new ChannelError('Configure MySQL multi-channel support first', 503));
    next();
  };
  app.use('/api/instagram-live', ensureReady);
  app.get('/api/instagram-live/status', (_req, res) => res.json(manager.getStatus()));
  app.get('/api/instagram-live/browser', async (_req, res) => res.json(await manager.browserStatus()));
  app.get('/api/instagram-live/browser/current', async (_req, res) => res.json(await manager.currentReel()));
  app.post('/api/instagram-live/media/probe', async (req, res) => res.json(
    await manager.mediaProber.probe(req.body?.url, { decode: req.body?.decode ?? false })
  ));
  app.post('/api/instagram-live/media/collect/start', (req, res) => {
    if ((manager.process || manager.starting) && manager.sourceMode !== 'direct') {
      throw new ChannelError('Stop the browser-capture livestream before collecting Instagram search videos', 409);
    }
    res.status(202).json(manager.mediaCollector.start(req.body));
  });
  app.get('/api/instagram-live/media/collect/status', (_req, res) => res.json(manager.mediaCollector.status()));
  app.get('/api/instagram-live/media/collect/results', (_req, res) => res.json(manager.mediaCollector.results()));
  app.post('/api/instagram-live/media/collect/stop', (_req, res) => res.json(manager.mediaCollector.stop()));
  app.use('/api/instagram-live/:id', async (req, _res, next) => {
    try { await manager.studio.assertChannelAllowed(req.params.id); next(); }
    catch (error) { next(error); }
  });
  app.get('/api/instagram-live/:id/playlist', async (req, res) => res.json({ items: await manager.playlist.list(req.params.id) }));
  app.post('/api/instagram-live/:id/playlist', async (req, res) => res.status(201).json({ items: await manager.playlist.add(req.params.id, req.body) }));
  app.post('/api/instagram-live/:id/playlist/current', async (req, res) => {
    const current = await manager.currentReel();
    res.status(201).json({ items: await manager.playlist.add(req.params.id, { ...current, label: req.body?.label || current.label }) });
  });
  app.put('/api/instagram-live/:id/playlist/order', async (req, res) => res.json({ items: await manager.playlist.reorder(req.params.id, req.body?.ids) }));
  app.delete('/api/instagram-live/:id/playlist/:itemId', async (req, res) => res.json({ items: await manager.playlist.remove(req.params.id, req.params.itemId) }));
  app.get('/api/instagram-live/:id', async (req, res) => res.json(await manager.getSettings(req.params.id)));
  app.put('/api/instagram-live/:id', async (req, res) => res.json(await manager.saveSettings(req.params.id, req.body)));
  app.post('/api/instagram-live/:id/start', async (req, res) => res.status(202).json(await manager.start(req.params.id, req.body?.rightsConfirmed, req.body?.mediaUrls)));
  app.post('/api/instagram-live/:id/direct/switch', async (req, res) => res.status(202).json(
    await manager.switchDirect(req.params.id, req.body?.rightsConfirmed, req.body?.mediaUrls, req.body?.startIndex ?? 0)
  ));
  app.post('/api/instagram-live/:id/stop', async (req, res) => {
    if (manager.activeChannelId && manager.activeChannelId !== req.params.id) throw new ChannelError('Another Instagram channel owns the current live feed', 409);
    res.json(await manager.stop());
  });
}
