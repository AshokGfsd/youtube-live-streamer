import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('API health works but control endpoints require the owner token', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'streamforge-api-test-'));
  const staticDir = path.join(dir, 'public');
  await fs.mkdir(staticDir);
  await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>StreamForge Android</title>');
  const token = 'integration-test-access-token-very-long';
  const port = 42000 + Math.floor(Math.random() * 12000);
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT: String(port), DASHBOARD_TOKEN: token, YOUTUBE_STREAM_KEY: '', DATA_DIR: dir, WEB_STATIC_DIR: staticDir, LISTEN_HOST: '127.0.0.1', FRONTEND_ORIGIN: 'http://localhost:3000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const address = 'http://127.0.0.1:' + port;
  try {
    let started = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (child.exitCode !== null) throw new Error('API exited during startup');
      try {
        const health = await fetch(address + '/health', { signal: AbortSignal.timeout(300) });
        if (health.ok) { started = true; break; }
      } catch { /* wait for the server to bind */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(started, true, 'server should become healthy');
    const dashboard = await fetch(address + '/');
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /StreamForge Android/);
    const anonymous = await fetch(address + '/api/status');
    assert.equal(anonymous.status, 401);
    const authenticated = await fetch(address + '/api/status', { headers: { Authorization: 'Bearer ' + token } });
    assert.equal(authenticated.status, 200);
    const sameOrigin = await fetch(address + '/api/status', { headers: { Authorization: 'Bearer ' + token, Origin: address } });
    assert.equal(sameOrigin.status, 200);
    assert.equal(sameOrigin.headers.get('access-control-allow-origin'), address);
    const status = await authenticated.json();
    assert.equal(status.hasStreamKey, false);
    assert.equal(status.video, null);
    const impossibleStart = await fetch(address + '/api/start', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ loop: true }) });
    assert.equal(impossibleStart.status, 400);

    // Exercise the real multipart upload and ffprobe path where FFmpeg is installed.
    let encoderAvailable = true;
    try { await execFileAsync('ffmpeg', ['-version'], { timeout: 3000 }); }
    catch { encoderAvailable = false; }
    if (encoderAvailable) {
      const samplePath = path.join(dir, 'sample.mp4');
      await execFileAsync('ffmpeg', [
        '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25',
        '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', samplePath,
      ], { timeout: 15000 });
      const data = await fs.readFile(samplePath);
      const body = new FormData();
      body.append('video', new Blob([data], { type: 'video/mp4' }), 'sample.mp4');
      const upload = await fetch(address + '/api/upload', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token }, body,
      });
      assert.equal(upload.status, 201, await upload.text().then((result) => result.slice(0, 200)));
      const uploaded = await fetch(address + '/api/status', { headers: { Authorization: 'Bearer ' + token } });
      const uploadStatus = await uploaded.json();
      assert.equal(uploadStatus.video?.name, 'sample.mp4');
      assert.equal(uploadStatus.video?.hasAudio, false);
    }
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else { child.once('close', resolve); setTimeout(resolve, 3500).unref(); }
    });
    await fs.rm(dir, { recursive: true, force: true });
  }
});
