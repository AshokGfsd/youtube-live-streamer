import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ChannelError } from './channel-store.js';

const execFileAsync = promisify(execFile);

// Media probes are a private diagnostic, never a general-purpose URL fetcher.
// Accept only directly extracted HTTPS MP4 links on Meta's media CDN domains.
export function validateInstagramMediaUrl(input) {
  if (typeof input !== 'string' || input.length > 8192) {
    throw new ChannelError('Paste an Instagram CDN video URL (maximum 8192 characters)');
  }
  let url;
  try { url = new URL(input.trim()); }
  catch { throw new ChannelError('Enter a valid HTTPS video URL'); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      !(hostname.endsWith('.fbcdn.net') || hostname.endsWith('.cdninstagram.com')) ||
      !/\.mp4$/i.test(url.pathname)) {
    throw new ChannelError('Only direct HTTPS .mp4 URLs on Instagram/Meta CDN hosts are supported');
  }
  return url.toString();
}

function mediaFailure(error, action) {
  // Never expose signed CDN query strings in API errors or console logs.
  const message = String(error?.stderr || '');
  if (/HTTP error 403\b|403 Forbidden|Server returned 403/i.test(message)) return new ChannelError(`${action} denied (403). The video link may be expired or restricted.`, 422);
  if (/HTTP error 404\b|404 Not Found|Server returned 404/i.test(message)) return new ChannelError(`${action} returned 404 for this exact signed URL. The JSON link may have expired or its query differs from your working terminal URL. Paste the fresh working URL and retry.`, 422);
  if (error?.killed || error?.signal === 'SIGTERM') return new ChannelError(`${action} timed out. Check the Codespaces network.`, 422);
  return new ChannelError(`${action} failed. Verify this video is accessible from the Codespaces server.`, 422);
}

function frameRate(value) {
  if (typeof value !== 'string') return null;
  const [numerator, denominator = '1'] = value.split('/').map(Number);
  const fps = numerator / denominator;
  return Number.isFinite(fps) && fps > 0 ? Math.round(fps * 100) / 100 : null;
}

export class InstagramMediaProber {
  constructor({ run = execFileAsync } = {}) {
    this.run = run;
    this.busy = false;
  }

  async probe(inputUrl, { decode = false } = {}) {
    const url = validateInstagramMediaUrl(inputUrl);
    if (typeof decode !== 'boolean') throw new ChannelError('Invalid decode test option');
    if (this.busy) throw new ChannelError('Another media probe is already running', 409);
    this.busy = true;
    try {
      let output;
      try {
        const result = await this.run('ffprobe', [
          '-v', 'error',
          '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,width,height,channels,sample_rate,avg_frame_rate',
          '-of', 'json', url,
        ], { timeout: 16000, maxBuffer: 256 * 1024 });
        output = JSON.parse(result.stdout);
      } catch (error) { throw mediaFailure(error, 'FFprobe'); }

      const streams = Array.isArray(output.streams) ? output.streams : [];
      const video = streams.find((item) => item.codec_type === 'video');
      const audio = streams.find((item) => item.codec_type === 'audio');
      if (!video) throw new ChannelError('No readable video track found at this URL', 422);

      if (decode) {
        try {
          await this.run('ffmpeg', [
            '-hide_banner', '-nostdin', '-v', 'error', '-i', url,
            '-t', '4', '-map', '0:v:0', '-map', '0:a?',
            '-vf', 'scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2,format=yuv420p',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '15', '-c:a', 'aac', '-b:a', '96k',
            '-f', 'null', '-',
          ], { timeout: 30000, maxBuffer: 256 * 1024 });
        } catch (error) { throw mediaFailure(error, 'Four-second FFmpeg encode test'); }
      }

      const duration = Number(output.format?.duration);
      return {
        reachable: true,
        encoded: decode,
        video: { codec: String(video.codec_name || 'unknown'), width: Number(video.width) || null,
          height: Number(video.height) || null, fps: frameRate(video.avg_frame_rate) },
        audio: audio ? { codec: String(audio.codec_name || 'unknown'), channels: Number(audio.channels) || null,
          sampleRate: Number(audio.sample_rate) || null } : null,
        durationSeconds: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 100) / 100 : null,
      };
    } finally { this.busy = false; }
  }
}
