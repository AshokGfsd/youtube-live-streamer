import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('API health works but control endpoints require the owner token', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'streamforge-api-test-'));
  const staticDir = path.join(dir, 'public');
  await fs.mkdir(staticDir);
  await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>StreamForge Android</title>');
  await fs.writeFile(path.join(staticDir, 'channels.html'), '<!doctype html><title>My Channels</title>');
  await fs.mkdir(path.join(staticDir, 'channels'));
  await fs.writeFile(path.join(staticDir, 'instagram-live.html'), '<!doctype html><title>Instagram Reels Live</title>');
  await fs.mkdir(path.join(staticDir, 'instagram-live'));
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
    const channelPage = await fetch(address + '/channels');
    assert.equal(channelPage.status, 200);
    assert.match(await channelPage.text(), /My Channels/);
    const channelSlashPage = await fetch(address + '/channels/');
    assert.equal(channelSlashPage.status, 200);
    assert.match(await channelSlashPage.text(), /My Channels/);
    const reelsPage = await fetch(address + '/instagram-live/');
    assert.equal(reelsPage.status, 200);
    assert.match(await reelsPage.text(), /Instagram Reels Live/);
    const reelsWithoutSlash = await fetch(address + '/instagram-live');
    assert.equal(reelsWithoutSlash.status, 200);
    assert.match(await reelsWithoutSlash.text(), /Instagram Reels Live/);
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
    const channels = await (await fetch(address + '/api/channels', { headers: { Authorization: 'Bearer ' + token } })).json();
    assert.equal(channels.configured, false);
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

test('Android local-only server opens without a token and blocks nonlocal origins', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'streamforge-local-test-'));
  const staticDir = path.join(dir, 'public');
  await fs.mkdir(staticDir);
  await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>Android Studio</title>');
  const port = 42000 + Math.floor(Math.random() * 12000);
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port), DASHBOARD_TOKEN: '', LOCAL_ONLY_MODE: 'true',
      YOUTUBE_STREAM_KEY: '', DATA_DIR: dir, WEB_STATIC_DIR: staticDir, LISTEN_HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const address = `http://127.0.0.1:${port}`;
  try {
    let healthy = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (child.exitCode !== null) throw new Error('Android API exited during startup');
      try {
        const response = await fetch(address + '/health', { signal: AbortSignal.timeout(300) });
        if (response.ok) { healthy = true; break; }
      } catch { /* wait for binding */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(healthy, true, 'phone server should become healthy');
    const health = await (await fetch(address + '/health')).json();
    assert.equal(health.localOnly, true);
    const dashboard = await fetch(address + '/');
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.headers.get('content-security-policy'), null, 'static Next.js hydration must not be blocked');
    const status = await fetch(address + '/api/status');
    assert.equal(status.status, 200, 'local dashboard must work without a token');
    const youtube = await (await fetch(address + '/api/youtube/status')).json();
    assert.equal(youtube.configured, false);
    assert.equal(youtube.connected, false);
    const oauthNotReady = await fetch(address + '/api/youtube/oauth/start', { redirect: 'manual' });
    assert.equal(oauthNotReady.status, 400, 'YouTube automation needs Google OAuth credentials');
    const createWithoutVideo = new FormData();
    createWithoutVideo.set('title', 'Test live');
    createWithoutVideo.set('privacy', 'private');
    const noVideo = await fetch(address + '/api/youtube/broadcasts/start', { method: 'POST', body: createWithoutVideo });
    assert.equal(noVideo.status, 400);
    assert.match((await noVideo.json()).error, /Upload your video/);
    const allowed = await fetch(address + '/api/status', { headers: { Origin: address } });
    assert.equal(allowed.status, 200);
    const foreign = await fetch(address + '/api/status', { headers: { Origin: 'https://evil.example' } });
    assert.equal(foreign.status, 403);
    const fakeHostStatus = await new Promise((resolve, reject) => {
      http.get(address + '/api/status', { headers: { Host: 'evil.example' } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(fakeHostStatus, 403);
    const foreignPost = await fetch(address + '/api/stop', { method: 'POST', headers: { Origin: 'https://evil.example' } });
    assert.equal(foreignPost.status, 403, 'cross-site requests cannot change streams');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else { child.once('close', resolve); setTimeout(resolve, 3500).unref(); }
    });
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Cloud Shell preview accepts wildcard CORS but requires a token for all remote requests', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'streamforge-cloud-preview-test-'));
  const staticDir = path.join(dir, 'public');
  await fs.mkdir(staticDir);
  await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>StreamForge preview</title>');
  const port = 42000 + Math.floor(Math.random() * 12000);
  const previewOrigin = 'https://4000-cs-user.cloudshell.dev';
  const token = 'preview-access-token-with-enough-entropy-for-testing';
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port), LOCAL_ONLY_MODE: 'true', CHANNEL_STORAGE: 'file',
      LISTEN_HOST: '127.0.0.1', WEB_STATIC_DIR: staticDir, DATA_DIR: dir,
      YOUTUBE_STREAM_KEY: '', CLOUD_SHELL_PREVIEW_ORIGIN: previewOrigin,
      CORS_ALLOW_ALL_ORIGINS: 'true', DASHBOARD_TOKEN: token,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const address = `http://127.0.0.1:${port}`;
  const previewHeaders = { Host: new URL(previewOrigin).host, Origin: 'https://another-frontend.example' };
  const requestWithHeaders = (method, headers) => new Promise((resolve, reject) => {
    const req = http.request(address + '/api/status', { method, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
  try {
    let healthy = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (child.exitCode !== null) throw new Error('Cloud preview API exited during startup');
      try {
        const response = await fetch(address + '/health', { signal: AbortSignal.timeout(300) });
        if (response.ok) { healthy = true; break; }
      } catch { /* wait for the server */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(healthy, true, 'Cloud preview API should become healthy');

    const localStatus = await fetch(address + '/api/status');
    assert.equal(localStatus.status, 200, 'localhost dashboard stays token-free');

    const unauthenticatedPreview = await requestWithHeaders('GET', previewHeaders);
    assert.equal(unauthenticatedPreview.status, 401, 'preview controls require bearer token');
    const authenticatedPreview = await requestWithHeaders('GET', { ...previewHeaders, Authorization: `Bearer ${token}` });
    assert.equal(authenticatedPreview.status, 200);
    assert.equal(authenticatedPreview.headers['access-control-allow-origin'], '*');

    const preflight = await requestWithHeaders('OPTIONS', {
      ...previewHeaders, 'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization',
    });
    assert.equal(preflight.status, 204, 'browser CORS preflight does not need a bearer token');
    assert.equal(preflight.headers['access-control-allow-origin'], '*');

    const crossOriginLocal = await fetch(address + '/api/status', { headers: { Origin: 'https://evil.example' } });
    assert.equal(crossOriginLocal.status, 401, 'wildcard CORS does not allow unauthenticated cross-origin requests');
    const invalidHost = await requestWithHeaders('GET', {
      Host: 'other-preview.example', Authorization: `Bearer ${token}`,
    });
    assert.equal(invalidHost.status, 403, 'unknown Host headers are still blocked');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else { child.once('close', resolve); setTimeout(resolve, 3500).unref(); }
    });
    await fs.rm(dir, { recursive: true, force: true });
  }
});
