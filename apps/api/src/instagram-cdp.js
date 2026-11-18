import { installReelsWatcher } from './instagram-reels-watcher.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      (url.pathname === '/reels' || url.pathname.startsWith('/reels/'));
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
  catch { throw new InstagramBrowserError('Start Termux Chromium with --remote-debugging-port=9222 before starting the live feed'); }
  const tab = tabs.find((candidate) => candidate.type === 'page' &&
    isReelsUrl(candidate.url) && candidate.webSocketDebuggerUrl);
  if (!tab) throw new InstagramBrowserError('Open https://www.instagram.com/reels/ and sign in manually in Termux Chromium first');
  const socketUrl = new URL(tab.webSocketDebuggerUrl);
  if (socketUrl.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(socketUrl.hostname)) {
    throw new InstagramBrowserError('Refusing a non-local Chrome debugger', 400);
  }
  return { socketUrl: `ws://127.0.0.1:${port}${socketUrl.pathname}${socketUrl.search}`, title: 'Instagram Reels' };
}

class DevtoolsSession {
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
  constructor({ port = 9222, scroll = 'wheel', onState = () => {}, onError = () => {} } = {}) {
    this.port = port;
    this.scroll = scroll;
    this.onState = onState;
    this.onError = onError;
    this.stopped = false;
    this.session = null;
    this.handled = 0;
    this.lastState = null;
  }

  async connect() {
    const { socketUrl } = await findInstagramTab(this.port);
    this.session = await DevtoolsSession.connect(socketUrl);
    await this.session.call('Runtime.enable');
    await this.session.evaluate(`(${installReelsWatcher.toString()})(${JSON.stringify({ tickMs: 130 })})`);
    await delay(250);
    this.lastState = await this.readState();
    if (!this.lastState?.activeId || !['playing', 'scroll-requested'].includes(this.lastState.phase)) {
      await this.stop();
      throw new InstagramBrowserError('Play one Reel in your Chromium Instagram tab before starting the live stream', 409);
    }
    this.onState(this.lastState);
    return this.lastState;
  }

  async readState() {
    const raw = await this.session.evaluate('JSON.stringify(globalThis.__streamforgeReels?.state || null)');
    if (raw === undefined || raw === null) return null;
    try { return JSON.parse(raw); } catch { return null; }
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
          await this.scrollOnce(state);
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
