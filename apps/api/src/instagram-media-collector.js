import { ChannelError } from './channel-store.js';
import { DevtoolsSession, InstagramBrowserError } from './instagram-cdp.js';
import { validateInstagramMediaUrl } from './instagram-media-probe.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function validateMediaSearch(input) {
  const query = input?.query;
  const count = input?.count;
  if (typeof query !== 'string' || query.trim().length < 2 || query.trim().length > 80 || /[\x00-\x1f\x7f]/.test(query)) {
    throw new ChannelError('Enter a search keyword between 2 and 80 characters');
  }
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new ChannelError('Choose a video count between 1 and 100');
  }
  return { query: query.trim(), count };
}

// Only inspect media on the Instagram search page in the user's existing
// private Chromium profile. No private Instagram APIs, auth bypass or download.
export const READ_VISIBLE_MEDIA = `(() => {
  const tiles = [...document.querySelectorAll('a[href*="/reel/"],a[href*="/p/"]')]
    .map(a => { const r=a.getBoundingClientRect(); return { href:a.href, x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2), w:r.width, h:r.height }; })
    .filter(r => r.w>50 && r.h>50 && r.x>=0 && r.y>=0 && r.x<innerWidth && r.y<innerHeight)
    .slice(0,12);
  const videos=[...document.querySelectorAll('video')].slice(0,80).map(video => ({
    urls: [video.currentSrc,video.src,...[...video.querySelectorAll('source')].map(s=>s.src)].filter(Boolean),
    reelUrl: video.closest('a[href*="/reel/"],a[href*="/p/"]')?.href || null,
  }));
  return JSON.stringify({ path:location.pathname, videos, tiles });
})()`;

const SCROLL_RESULTS = `(() => {
  const root = document.scrollingElement || document.documentElement;
  let target = root;
  if (root.scrollHeight <= root.clientHeight+100) {
    const options=[...document.querySelectorAll('main,[role="main"],div')].filter(el =>
      el.clientHeight>250 && el.scrollHeight>el.clientHeight+150 && getComputedStyle(el).overflowY!=='hidden');
    target=options.sort((a,b)=>(b.clientHeight-a.clientHeight))[0] || root;
  }
  const before=target.scrollTop;
  target.scrollTop += Math.max(500,Math.floor(innerHeight*0.86));
  window.dispatchEvent(new Event('scroll'));
  return target.scrollTop>before;
})()`;

function localDebugger(tab, port) {
  if (!tab?.id || !tab.webSocketDebuggerUrl || tab.type !== 'page') {
    throw new InstagramBrowserError('Chromium could not create an Instagram search tab');
  }
  const ws = new URL(tab.webSocketDebuggerUrl);
  if (ws.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(ws.hostname)) {
    throw new InstagramBrowserError('Refusing a non-local Chromium debugger', 400);
  }
  return { id: tab.id, socketUrl: `ws://127.0.0.1:${port}${ws.pathname}${ws.search}` };
}

async function createSearchTab(port, searchUrl) {
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(searchUrl)}`, {
      method: 'PUT', signal: AbortSignal.timeout(6000),
    });
  } catch { throw new InstagramBrowserError('Start the private Chrome service before using automatic Instagram search'); }
  if (!response.ok) throw new InstagramBrowserError(`Local Chrome tab creation failed (HTTP ${response.status})`);
  return localDebugger(await response.json(), port);
}

async function closeSearchTab(port, id) {
  if (!id) return;
  try { await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(id)}`, {
    signal: AbortSignal.timeout(3000),
  }); } catch { /* Local Chrome may have closed already. */ }
}

export class InstagramMediaCollector {
  constructor({ port = 9222, createTab = createSearchTab, closeTab = closeSearchTab,
    connect = DevtoolsSession.connect, pause = wait } = {}) {
    this.port = port;
    this.createTab = createTab;
    this.closeTab = closeTab;
    this.connect = connect;
    this.pause = pause;
    this.phase = 'idle';
    this.query = '';
    this.requested = 0;
    this.visited = 0;
    this.error = null;
    this.note = '';
    this.urls = new Map();
    this.aborted = false;
    this.session = null;
    this.tabId = null;
  }

  status() {
    return { phase: this.phase, query: this.query, requested: this.requested,
      found: this.urls.size, visited: this.visited, error: this.error, note: this.note };
  }

  results() {
    return { ...this.status(), directVideoUrls: [...this.urls.values()].slice(0, this.requested) };
  }

  start(input) {
    if (this.phase === 'running') throw new ChannelError('An Instagram link collection is already running', 409);
    const { query, count } = validateMediaSearch(input);
    this.query = query;
    this.requested = count;
    this.visited = 0;
    this.error = null;
    this.note = '';
    this.urls.clear();
    this.aborted = false;
    this.phase = 'running';
    void this.run().catch((error) => {
      this.phase = this.aborted ? 'stopped' : 'failed';
      this.error = this.aborted ? null : (error instanceof ChannelError || error instanceof InstagramBrowserError
        ? error.message : 'Instagram search stopped unexpectedly. Check the private Chrome login.');
    });
    return this.status();
  }

  capture(items) {
    for (const item of items || []) {
      if (this.urls.size >= this.requested) break;
      for (const candidate of Array.isArray(item.urls) ? item.urls : [item.url]) {
        try {
          const url = validateInstagramMediaUrl(candidate);
          const parsed = new URL(url);
          this.urls.set(parsed.origin + parsed.pathname, url);
          break;
        } catch { /* Blob URLs, placeholder videos, or non-CDN media are skipped. */ }
      }
    }
  }

  async inspect() {
    const raw = await this.session.evaluate(READ_VISIBLE_MEDIA);
    try { return JSON.parse(raw || '{}'); }
    catch { return { videos: [], tiles: [] }; }
  }

  async run() {
    const searchUrl = `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(this.query)}`;
    const hovered = new Set();
    try {
      const tab = await this.createTab(this.port, searchUrl);
      this.tabId = tab.id;
      if (this.aborted) return;
      this.session = await this.connect(tab.socketUrl);
      await this.session.call('Runtime.enable');
      let noProgress = 0;
      const maxScrolls = Math.min(200, Math.max(24, this.requested * 5));
      for (let scan = 0; scan < maxScrolls && !this.aborted && this.urls.size < this.requested; scan++) {
        await this.pause(scan === 0 ? 1300 : 800);
        let page;
        try { page = await this.inspect(); }
        catch (error) {
          if (this.aborted) return;
          throw error;
        }
        if (page.path?.startsWith('/accounts/login')) {
          throw new InstagramBrowserError('Instagram login required. Sign in manually in the private Chrome window first.', 401);
        }
        const previous = this.urls.size;
        this.capture(page.videos);
        for (const tile of (page.tiles || []).slice(0,5)) {
          if (this.aborted || this.urls.size >= this.requested) break;
          if (hovered.has(tile.href)) continue;
          hovered.add(tile.href);
          await this.session.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tile.x, y: tile.y });
          await this.pause(180);
          this.capture((await this.inspect()).videos);
        }
        this.visited = scan + 1;
        noProgress = this.urls.size === previous ? noProgress + 1 : 0;
        if (noProgress >= 16) {
          this.note = 'No new playable videos loaded after repeated scrolling. Try another keyword or sign in to Instagram.';
          break;
        }
        if (this.urls.size < this.requested) await this.session.evaluate(SCROLL_RESULTS);
      }
      if (!this.aborted) {
        this.phase = 'completed';
        this.note ||= this.urls.size < this.requested
          ? `Collected ${this.urls.size} of ${this.requested}. Instagram did not expose more playable video URLs.`
          : `Collected ${this.requested} direct MP4 URLs.`;
      }
    } finally {
      this.session?.close();
      this.session = null;
      await this.closeTab(this.port, this.tabId);
      this.tabId = null;
      if (this.aborted) this.phase = 'stopped';
    }
  }

  stop() {
    if (this.phase === 'running') {
      this.aborted = true;
      this.note = 'Stopped. Collected links are still available below.';
    }
    return this.status();
  }
}
