import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { safeLogLine } from './validation.js';

const MAX_LOGS = 60;
const RECONNECT_DELAY_MS = 8000;

function initialState() {
  return { video: null, desiredRunning: false, loop: true, startedAt: null };
}

export class StreamManager {
  constructor({ dataDir, streamKey, rtmpsUrl, videoSettings = {}, ffmpegBin = 'ffmpeg', spawnProcess = spawn }) {
    this.dataDir = dataDir;
    this.stateFile = path.join(dataDir, 'state.json');
    this.streamKey = streamKey || '';
    this.rtmpsUrl = rtmpsUrl.replace(/\/+$/, '');
    this.ffmpegBin = ffmpegBin;
    this.spawnProcess = spawnProcess;
    this.videoSettings = {
      width: videoSettings.width ?? 1280,
      height: videoSettings.height ?? 720,
      fps: videoSettings.fps ?? 30,
      bitrateKbps: videoSettings.bitrateKbps ?? 2500,
      preset: videoSettings.preset ?? 'ultrafast',
    };
    const settings = this.videoSettings;
    if (!Number.isInteger(settings.width) || settings.width < 320 || settings.width > 1920 || settings.width % 2 !== 0 ||
      !Number.isInteger(settings.height) || settings.height < 180 || settings.height > 1080 || settings.height % 2 !== 0 ||
      !Number.isInteger(settings.fps) || settings.fps < 15 || settings.fps > 60 ||
      !Number.isInteger(settings.bitrateKbps) || settings.bitrateKbps < 300 || settings.bitrateKbps > 8000 ||
      !['ultrafast', 'superfast', 'veryfast', 'faster', 'fast'].includes(settings.preset)) {
      throw new Error('Invalid video encoding settings');
    }
    this.state = initialState();
    this.process = null;
    this.timer = null;
    this.phase = 'idle';
    this.lastError = null;
    this.logs = [];
    this.closing = false;
  }

  async initialize() {
    await fs.mkdir(path.join(this.dataDir, 'uploads'), { recursive: true });
    try {
      const persisted = JSON.parse(await fs.readFile(this.stateFile, 'utf8'));
      if (persisted.video && /^[a-f0-9-]+\.(mp4|mov|mkv|webm|m4v)$/.test(persisted.video.fileName)) {
        this.state = {
          video: persisted.video,
          desiredRunning: Boolean(persisted.desiredRunning),
          loop: persisted.loop !== false,
          startedAt: persisted.startedAt || null,
        };
        await fs.access(this.videoPath());
      } else {
        this.state = initialState();
      }
    } catch (error) {
      if (error.code !== 'ENOENT') this.addLog('Previous stream state could not be restored');
      this.state = initialState();
    }

    if (this.state.desiredRunning && this.streamKey) {
      this.addLog('Resuming the stream after a server restart');
      this.launch();
    } else if (this.state.desiredRunning) {
      this.state.desiredRunning = false;
      await this.save();
    }
  }

  videoPath() {
    return this.state.video ? path.join(this.dataDir, 'uploads', this.state.video.fileName) : null;
  }

  async save() {
    const temp = this.stateFile + '.tmp';
    await fs.writeFile(temp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    await fs.rename(temp, this.stateFile);
  }

  async setVideo(video) {
    if (this.state.desiredRunning || this.process) throw new Error('Stop the current stream before replacing its video');
    const previous = this.videoPath();
    this.state.video = video;
    this.state.startedAt = null;
    this.lastError = null;
    await this.save();
    if (previous && previous !== this.videoPath()) await fs.rm(previous, { force: true }).catch(() => {});
    this.addLog('Video uploaded and verified: ' + video.originalName);
  }

  async start(loop = true) {
    if (!this.state.video) throw new Error('Upload a video before starting');
    if (!this.streamKey) throw new Error('Set YOUTUBE_STREAM_KEY on the VM first');
    if (this.state.desiredRunning || this.process) throw new Error('Stream already running');
    await fs.access(this.videoPath());
    this.state.desiredRunning = true;
    this.state.loop = Boolean(loop);
    this.state.startedAt = new Date().toISOString();
    this.lastError = null;
    await this.save();
    this.launch();
    return this.getStatus();
  }

  buildArguments() {
    const video = this.state.video;
    const { width, height, fps, bitrateKbps, preset } = this.videoSettings;
    const args = ['-hide_banner', '-nostdin', '-loglevel', 'warning', '-stats'];
    if (this.state.loop) args.push('-stream_loop', '-1');
    args.push('-re', '-i', this.videoPath());
    if (!video.hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
    args.push('-map', '0:v:0', '-map', video.hasAudio ? '0:a:0' : '1:a:0');
    args.push(
      '-vf', 'scale=' + width + ':' + height + ':force_original_aspect_ratio=decrease:force_divisible_by=2,pad=' + width + ':' + height + ':(ow-iw)/2:(oh-ih)/2:color=black,fps=' + fps + ',format=yuv420p',
      '-c:v', 'libx264', '-preset', preset, '-tune', 'zerolatency',
      '-b:v', bitrateKbps + 'k', '-maxrate', bitrateKbps + 'k', '-bufsize', (bitrateKbps * 2) + 'k', '-g', String(fps * 2),
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
      '-f', 'flv'
    );
    if (!this.state.loop) args.push('-shortest');
    args.push(this.rtmpsUrl + '/' + this.streamKey);
    return args;
  }

  launch() {
    if (!this.state.desiredRunning || this.closing) return;
    this.phase = 'connecting';
    let child;
    try {
      child = this.spawnProcess(this.ffmpegBin, this.buildArguments(), { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      this.scheduleReconnect('FFmpeg failed to start: ' + error.message);
      return;
    }
    this.process = child;
    let fragment = '';
    child.stderr?.on('data', (chunk) => {
      fragment += chunk.toString('utf8');
      const parts = fragment.split(/[\r\n]+/);
      fragment = parts.pop()?.slice(-1500) || '';
      for (const line of parts) if (line.trim()) this.addLog(line);
    });
    child.once('spawn', () => {
      if (this.process === child) {
        this.phase = 'sending';
        this.addLog('FFmpeg started sending video to YouTube');
      }
    });
    child.once('error', (error) => {
      this.lastError = 'FFmpeg process error: ' + error.message;
      this.addLog(this.lastError);
    });
    child.once('close', (code, signal) => {
      if (this.process !== child) return;
      this.process = null;
      if (fragment.trim()) this.addLog(fragment);
      if (this.closing) return;
      if (!this.state.desiredRunning) {
        this.phase = 'idle';
        this.addLog('Streaming stopped');
        return;
      }
      if (code === 0 && !this.state.loop) {
        this.state.desiredRunning = false;
        this.phase = 'idle';
        this.addLog('Video completed; stream stopped');
        this.save().catch((error) => this.addLog('State save error: ' + error.message));
        return;
      }
      this.scheduleReconnect('Stream interrupted (exit ' + String(code ?? signal) + ')');
    });
  }

  scheduleReconnect(message) {
    if (!this.state.desiredRunning || this.closing) return;
    this.lastError = safeLogLine(message, this.streamKey);
    this.phase = 'reconnecting';
    this.addLog(this.lastError + '; retrying in 8 seconds');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.launch();
    }, RECONNECT_DELAY_MS);
    this.timer.unref?.();
  }

  async stop() {
    this.state.desiredRunning = false;
    clearTimeout(this.timer);
    this.timer = null;
    await this.save();
    if (this.process) {
      this.phase = 'stopping';
      this.process.kill('SIGTERM');
    } else {
      this.phase = 'idle';
    }
    return this.getStatus();
  }

  shutdown() {
    this.closing = true;
    clearTimeout(this.timer);
    this.process?.kill('SIGTERM');
  }

  addLog(line) {
    const clean = safeLogLine(line, this.streamKey);
    if (!clean.trim()) return;
    this.logs.push({ at: new Date().toISOString(), message: clean });
    if (this.logs.length > MAX_LOGS) this.logs.shift();
  }

  getStatus() {
    return {
      phase: this.phase,
      desiredRunning: this.state.desiredRunning,
      startedAt: this.state.startedAt,
      loop: this.state.loop,
      hasStreamKey: Boolean(this.streamKey),
      video: this.state.video && {
        name: this.state.video.originalName,
        sizeBytes: this.state.video.sizeBytes,
        durationSeconds: this.state.video.durationSeconds,
        hasAudio: this.state.video.hasAudio,
      },
      lastError: this.lastError,
      logs: this.logs.slice(-15),
    };
  }
}
