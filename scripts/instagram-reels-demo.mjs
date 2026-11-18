import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const COLORS = ['0x2d617c', '0x6b3e79', '0x7c5d31'];

function generateClip(filename, color, ffmpeg) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
      '-i', `color=c=${color}:s=270x480:r=12:d=2.5`,
      '-an', '-c:v', 'libvpx-vp9', '-deadline', 'realtime',
      '-cpu-used', '8', '-b:v', '120k', filename,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-1200); });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error('FFmpeg demo clip failed: ' + stderr)));
  });
}

const DEMO_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>StreamForge Reel Auto-Scroll Test</title><style>
*{box-sizing:border-box}body{margin:0;background:#080c16;color:white;font:16px system-ui,sans-serif}
#feed{height:100vh;overflow-y:auto;scroll-snap-type:y mandatory;overscroll-behavior:contain}
section{height:100vh;display:grid;place-items:center;scroll-snap-align:start;position:relative}
video{height:86vh;max-width:90vw;aspect-ratio:9/16;object-fit:cover;border-radius:20px}
.label{position:absolute;bottom:12%;left:50%;transform:translateX(-50%);padding:12px 18px;background:#12192ecc;border-radius:16px;text-align:center;white-space:nowrap}
.banner{position:fixed;z-index:5;top:14px;left:50%;transform:translateX(-50%);padding:10px 16px;background:#17243dec;border-radius:12px;white-space:nowrap;font-size:13px}
</style></head><body><div class="banner">StreamForge synthetic test feed — no Instagram connection</div>
<main id="feed">
<section><video src="/clip-1.webm" playsinline muted preload="auto"></video><div class="label">Demo Reel 1 · 2.5 seconds</div></section>
<section><video src="/clip-2.webm" playsinline muted preload="auto"></video><div class="label">Demo Reel 2 · 2.5 seconds</div></section>
<section><video src="/clip-3.webm" playsinline muted preload="auto"></video><div class="label">Demo Reel 3 · 2.5 seconds</div></section>
</main><script>
const videos=[...document.querySelectorAll('video')];
const observer=new IntersectionObserver(entries=>{for(const entry of entries){
  const video=entry.target;
  if(entry.intersectionRatio>.65){video.currentTime=0;video.play().catch(()=>{});}
  else video.pause();
}},{root:document.getElementById('feed'),threshold:[0,.65,1]});
videos.forEach(video=>observer.observe(video));
</script></body></html>`;

/** A private, temporary feed for validating auto-scroll without using Instagram. */
export async function startReelsDemo({ ffmpeg = 'ffmpeg' } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'streamforge-reels-test-'));
  let server;
  try {
    // Generate sequentially to avoid three simultaneous encoders on a phone.
    for (const [index, color] of COLORS.entries()) {
      await generateClip(path.join(directory, `clip-${index + 1}.webm`), color, ffmpeg);
    }
    server = createServer(async (req, res) => {
      try {
        const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
        if (pathname === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(DEMO_HTML);
          return;
        }
        if (!/^\/clip-[123]\.webm$/.test(pathname)) {
          res.writeHead(404); res.end('Not found'); return;
        }
        const data = await readFile(path.join(directory, pathname.slice(1)));
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
        const start = range ? Number(range[1]) : 0;
        const end = range && range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
        if (start > end || start >= data.length) {
          res.writeHead(416, { 'Content-Range': `bytes */${data.length}` }); res.end(); return;
        }
        const partial = Boolean(range);
        res.writeHead(partial ? 206 : 200, {
          'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}),
        });
        res.end(data.subarray(start, end + 1));
      } catch {
        res.writeHead(500); res.end('Demo feed unavailable');
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    return {
      url: `http://127.0.0.1:${address.port}/`,
      close: async () => {
        await new Promise((resolve) => server.close(resolve));
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
