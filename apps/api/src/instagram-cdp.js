import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { installReelsWatcher } from './instagram-reels-watcher.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function getChromeExecutable() {
  if (process.env.STREAMFORGE_CHROME_BIN && existsSync(process.env.STREAMFORGE_CHROME_BIN)) {
    return process.env.STREAMFORGE_CHROME_BIN;
  }
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    ];
    for (const candidate of candidates) {
      if (candidate && existsSync(candidate)) return candidate;
    }
  } else {
    const candidates = [...(process.env.INSTAGRAM_DISPLAY === ':99' ? ['/usr/bin/microsoft-edge-stable', '/usr/bin/microsoft-edge'] : []), '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export async function isDebuggerListening(port = 9222) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function launchPrivateChrome(port = 9222, url = 'https://www.instagram.com/reels/') {
  if (await isDebuggerListening(port)) return true;
  const chromeBin = getChromeExecutable();
  if (!chromeBin) return false;

  const cloudDisplay = process.env.INSTAGRAM_DISPLAY === ':99';
  const profileDir = path.join(os.homedir(), cloudDisplay && /microsoft-edge/.test(chromeBin) ? '.streamforge-cloud-edge' : cloudDisplay ? '.streamforge-cloud-chromium' : 'streamforge-browser-profile');
  const args = [
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    '--window-position=0,0',
    '--window-size=1366,768',
    '--start-maximized',
    '--no-first-run',
    '--no-default-browser-check',
    url,
  ];

  try {
    const child = spawn(chromeBin, args, { detached: true, stdio: 'ignore', env: { ...process.env, ...(cloudDisplay ? { DISPLAY: ':99' } : {}) } });
    child.unref();
  } catch {
    return false;
  }

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await isDebuggerListening(port)) return true;
  }
  return false;
}

export class InstagramBrowserError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.name = 'InstagramBrowserError';
    this.status = status;
  }
}

function isReelsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['www.instagram.com', 'instagram.com'].includes(url.hostname) &&
      (url.pathname === '/reels' || url.pathname.startsWith('/reels/') || url.pathname.startsWith('/reel/'));
  } catch { return false; }
}

async function tabList(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Chromium debugger returned HTTP ${response.status}`);
  return response.json();
}

export async function findInstagramTab(port = 9222) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new InstagramBrowserError('Invalid local Chromium debugging port', 400);
  }
  let tabs;
  try { tabs = await tabList(port); }
  catch {
    const launched = await launchPrivateChrome(port).catch(() => false);
    if (launched) {
      try { tabs = await tabList(port); } catch { /* ignore */ }
    }
    if (!tabs) {
      throw new InstagramBrowserError('Start your private Instagram Chrome with --remote-debugging-port=9222 before starting the live feed');
    }
  }
  const tab = tabs.find((candidate) => candidate.type === 'page' &&
    isReelsUrl(candidate.url) && candidate.webSocketDebuggerUrl);
  if (!tab) throw new InstagramBrowserError('Open Instagram Reels in your private Chrome window and sign in manually first');
  const socketUrl = new URL(tab.webSocketDebuggerUrl);
  if (socketUrl.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(socketUrl.hostname)) {
    throw new InstagramBrowserError('Refusing a non-local Chrome debugger', 400);
  }
  return { socketUrl: `ws://127.0.0.1:${port}${socketUrl.pathname}${socketUrl.search}`,
    title: 'Instagram Reels', url: tab.url };
}

export function nextPlaylistIndex(current, total, loop) {
  if (!Number.isInteger(current) || !Number.isInteger(total) || total < 1 || current < 0 || current >= total) {
    throw new InstagramBrowserError('Invalid playlist position', 400);
  }
  if (current + 1 < total) return current + 1;
  return loop ? 0 : null;
}

// Keep the X11/FFmpeg capture at its full physical resolution, but give the
// page a *phone-sized CSS viewport*. An unscaled 540px viewport makes
// Instagram render its wider Reels layout, with actions outside the Reel and
// neighbouring posts visible. At 540x960 physical pixels, a 360x640 CSS
// viewport with DPR 1.5 fits the same capture rectangle exactly.
// This only changes the existing tab's emulation settings, not login data.
export function mobileReelsEmulation(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 240 || height < 240 || width >= height) {
    throw new InstagramBrowserError('Mobile Reels needs a portrait capture size (width smaller than height)', 400);
  }
  const cssWidth = Math.min(width, 360);
  const deviceScaleFactor = width / cssWidth;
  const cssHeight = Math.round(height / deviceScaleFactor);
  return [
    { method: 'Emulation.setDeviceMetricsOverride', params: {
      width: cssWidth, height: cssHeight, deviceScaleFactor, mobile: true,
      screenWidth: cssWidth, screenHeight: cssHeight,
    } },
    { method: 'Emulation.setTouchEmulationEnabled', params: { enabled: true, maxTouchPoints: 1 } },
  ];
}

export class DevtoolsSession {
  constructor(socket) {
    this.socket = socket;
    this.counter = 0;
    this.pending = new Map();
    socket.addEventListener('message', ({ data }) => {
      let message;
      try { message = JSON.parse(data); } catch { return; }
      const task = this.pending.get(message.id);
      if (!task) return;
      clearTimeout(task.timer);
      this.pending.delete(message.id);
      if (message.error) task.reject(new InstagramBrowserError('Chromium command failed: ' + message.error.message));
      else task.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const task of this.pending.values()) {
        clearTimeout(task.timer);
        task.reject(new InstagramBrowserError('Chromium tab closed'));
      }
      this.pending.clear();
    });
  }

  static async connect(address) {
    const socket = new WebSocket(address);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new InstagramBrowserError('Timed out connecting to Chromium')), 7000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new InstagramBrowserError('Chromium WebSocket unavailable')); }, { once: true });
    }).catch((error) => { socket.close(); throw error; });
    return new DevtoolsSession(socket);
  }

  call(method, params = {}) {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new InstagramBrowserError('Chrome debugging connection was closed'));
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new InstagramBrowserError(`Chromium command timed out: ${method}`));
      }, 8000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new InstagramBrowserError('Instagram tab script could not run');
    return result.result?.value;
  }

  close() { this.socket.close(); }
}

export class InstagramReelsController {
  constructor({ port = 9222, scroll = 'wheel', mobileLayout = true, captureWidth = 540, captureHeight = 960,
    playlistUrls = [], playlistLoop = true, onPlaylistPosition = () => {}, onPlaylistEnd = () => {},
    onState = () => {}, onError = () => {} } = {}) {
    this.port = port;
    this.scroll = scroll;
    this.mobileLayout = mobileLayout;
    this.captureWidth = captureWidth;
    this.captureHeight = captureHeight;
    this.onState = onState;
    this.onError = onError;
    this.playlistUrls = playlistUrls;
    this.playlistLoop = playlistLoop;
    this.playlistIndex = 0;
    this.onPlaylistPosition = onPlaylistPosition;
    this.onPlaylistEnd = onPlaylistEnd;
    this.stopped = false;
    this.session = null;
    this.handled = 0;
    this.lastState = null;
  }

  async connect() {
    const { socketUrl } = await findInstagramTab(this.port);
    this.session = await DevtoolsSession.connect(socketUrl);
    try {
      if (this.mobileLayout) {
        for (const command of mobileReelsEmulation(this.captureWidth, this.captureHeight)) {
          await this.session.call(command.method, command.params);
        }
      }
      await this.session.call('Runtime.enable');
      if (this.playlistUrls.length) {
        await this.session.call('Page.enable');
        await this.loadPlaylistReel(0);
      } else {
        await this.session.evaluate(`(${installReelsWatcher.toString()})(${JSON.stringify({ tickMs: 130 })})`);
        // Let Instagram react to the newly narrow viewport before checking playback.
        await delay(this.mobileLayout ? 600 : 250);
        this.lastState = await this.readState();
      }
      if (!this.lastState?.activeId || !['playing', 'scroll-requested'].includes(this.lastState.phase)) {
        throw new InstagramBrowserError('Play one Reel in your Chromium Instagram tab before starting the live stream', 409);
      }
      this.onState(this.lastState);
      return this.lastState;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async readState() {
    const raw = await this.session.evaluate('JSON.stringify(globalThis.__streamforgeReels?.state || null)');
    if (raw === undefined || raw === null) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  async loadPlaylistReel(index) {
    // Page.navigate opens only URLs explicitly selected and saved by the user.
    // Login cookies remain inside the same local Chromium profile.
    this.playlistIndex = index;
    this.handled = 0;
    await this.session.call('Page.navigate', { url: this.playlistUrls[index] });
    this.onPlaylistPosition(index);
    for (let attempt = 0; attempt < 45 && !this.stopped; attempt++) {
      await delay(350);
      try {
        await this.session.evaluate(`(${installReelsWatcher.toString()})({tickMs:130})`);
        const state = await this.readState();
        if (!state?.activeId) continue;
        if (state.phase === 'paused') {
          // Try normal HTML video playback. Chrome may still require a click
          // in the VNC window if the website blocks autoplay with audio.
          await this.session.evaluate(`(() => { const video = [...document.querySelectorAll('video')]
            .find((item) => !item.ended && item.getBoundingClientRect().width > 100);
            video?.play().catch(() => {}); return Boolean(video); })()`);
          continue;
        }
        if (state.phase === 'playing' || state.phase === 'scroll-requested') {
          this.lastState = state;
          this.onState(state);
          return;
        }
      } catch {
        // Navigation can destroy the JS execution context for a short time.
      }
    }
    throw new InstagramBrowserError('Selected Reel did not play. Open the private Chrome window and check login, URL and autoplay.');
  }

  async scrollOnce(state) {
    if (this.scroll === 'arrow') {
      await this.session.call('Input.dispatchKeyEvent', {
        type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40,
      });
      await this.session.call('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40,
      });
      return;
    }
    await this.session.call('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: Math.round((state.viewportWidth || 400) / 2),
      y: Math.round((state.viewportHeight || 800) / 2),
      deltaX: 0, deltaY: Math.round((state.viewportHeight || 800) * 0.98),
    });
  }

  async run() {
    while (!this.stopped) {
      try {
        const state = await this.readState();
        if (!state) throw new InstagramBrowserError('Instagram page navigated; restart the feed after opening Reels');
        this.lastState = state;
        this.onState(state);
        if (state.phase === 'stalled') throw new InstagramBrowserError('Reels auto-scroll stalled. Try Arrow scroll or refresh the Instagram tab.');
        if (state.scrollRequest > this.handled) {
          this.handled = state.scrollRequest;
          if (this.playlistUrls.length) {
            const index = nextPlaylistIndex(this.playlistIndex, this.playlistUrls.length, this.playlistLoop);
            if (index === null) {
              this.onPlaylistEnd();
              return;
            }
            await this.loadPlaylistReel(index);
          } else {
            await this.scrollOnce(state);
          }
        }
        await delay(300);
      } catch (error) {
        if (!this.stopped) this.onError(error);
        return;
      }
    }
  }

  async stop() {
    this.stopped = true;
    try { await this.session?.evaluate('globalThis.__streamforgeReels?.stop?.()'); } catch { /* browser may be closed */ }
    this.session?.close();
    this.session = null;
  }
}
