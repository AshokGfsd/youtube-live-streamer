import { ChannelError } from './channel-store.js';
import { validateInstagramMediaUrl } from './instagram-media-probe.js';
import { streamOutputDimensions } from './instagram-output-resolution.js';

const MAX_DIRECT_CLIPS = 50000;

// These short-lived signed links are supplied only at stream start. Never put
// the playlist in MySQL, URLs in status/logs, or the concat file in the repo.
export function validateDirectMediaPlaylist(value) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_DIRECT_CLIPS) {
    throw new ChannelError(`Import 1–${MAX_DIRECT_CLIPS} direct MP4 links before starting`);
  }
  // Reject concat metacharacters in the original input before URL() escapes
  // them. The playlist parser has a different escaping format from URI syntax.
  if (value.some((url) => typeof url === 'string' && (url.includes("'") || url.includes('\\') || /[\r\n]/.test(url)))) {
    throw new ChannelError('A direct video URL has unsupported characters');
  }
  const urls = value.map(validateInstagramMediaUrl);
  if (new Set(urls).size !== urls.length) throw new ChannelError('Remove duplicate direct MP4 links before starting');
  return urls;
}

export function directMediaManifest(urls) {
  return `ffconcat version 1.0\n${urls.map((url) => `file '${url}'`).join('\n')}\n`;
}

export function buildDirectMediaFfmpegArgs(settings, ingestUrl, streamKey, manifestPath, framePath, { hasSourceAudio = true } = {}) {
  const { width, height } = streamOutputDimensions(settings);
  const { fps, bitrateKbps, frame, mobileLayout, playlistLoop } = settings;
  const phone = mobileLayout && frame === 'iphone';
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'warning', '-re'];
  // The first clip determines the concat demuxer's audio stream layout.
  if (playlistLoop) args.push('-stream_loop', '-1');
  args.push('-protocol_whitelist', 'file,http,https,tcp,tls,crypto', '-safe', '0',
    '-f', 'concat', '-i', manifestPath);

  if (phone) {
    const videoWidth = Math.floor(width * 448 / 540 / 2) * 2;
    const videoHeight = Math.floor(height * 796 / 960 / 2) * 2;
    const videoX = Math.floor((width - videoWidth) / 2);
    const videoY = Math.floor((height - videoHeight) / 2);
    args.push('-loop', '1', '-framerate', String(fps), '-i', framePath);
    args.push('-filter_complex',
      `[0:v]scale=${videoWidth}:${videoHeight}:force_original_aspect_ratio=increase:flags=lanczos,` +
      `crop=${videoWidth}:${videoHeight},setsar=1,` +
      `pad=${width}:${height}:${videoX}:${videoY}:color=black,format=rgba[reel];` +
      `[1:v]scale=${width}:${height}:flags=bicubic,format=rgba[frame];` +
      // The SVG is looped forever; end the overlay with the finite MP4 input
      // when the user has selected "play once".
      `[reel][frame]overlay=0:0:format=auto:shortest=1:repeatlast=0,fps=${fps},format=yuv420p[composed]`);
    args.push('-map', '[composed]');
  } else {
    args.push('-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p`);
    args.push('-map', '0:v:0');
  }

  // Preserve original audio when present, otherwise add a silent AAC track.
  // FFmpeg cannot optionally map an absent 0:a input AND conditionally map
  // lavfi silence, so the caller probes the first video before building args.
  // The decoration input (if enabled) uses slot 1; silence is appended last.
  let silenceIndex = null;
  if (!hasSourceAudio) {
    silenceIndex = phone ? 2 : 1;
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  }
  args.push('-map', hasSourceAudio ? '0:a:0' : `${silenceIndex}:a:0`,
    '-c:v', 'libx264', '-preset', 'ultrafast',
    '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-g', String(fps * 2), '-b:v', `${bitrateKbps}k`,
    '-minrate', `${bitrateKbps}k`, '-maxrate', `${bitrateKbps}k`, '-bufsize', `${bitrateKbps * 2}k`,
    '-x264-params', 'nal-hrd=cbr:filler=1',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-f', 'flv', `${ingestUrl.replace(/\/+$/, '')}/${streamKey}`);

  return args;
}
