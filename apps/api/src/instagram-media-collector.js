import { ChannelError } from "./channel-store.js";
import {
  DevtoolsSession,
  InstagramBrowserError,
  launchPrivateChrome,
} from "./instagram-cdp.js";
import { InstagramMediaProber, validateInstagramMediaUrl } from "./instagram-media-probe.js";

const MIN_FPS_CHOICES = [0, 24, 30, 40, 60];
const MIN_RESOLUTIONS = Object.freeze({ any: null, "480p": [480, 854], "720p": [720, 1280], "1080p": [1080, 1920] });

export function matchesMediaFilters(media, { minFps = 0, minResolution = "any" } = {}) {
  const { width, height, fps } = media?.video || {};
  if (minFps && (!Number.isFinite(fps) || fps + 0.1 < minFps)) return false;
  const minimum = MIN_RESOLUTIONS[minResolution];
  if (minimum && (!Number.isFinite(width) || !Number.isFinite(height) ||
      Math.min(width, height) < minimum[0] || Math.max(width, height) < minimum[1])) return false;
  return true;
}


const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function validateMediaSearch(input) {
  const query = input?.query;
  const count = input?.count;
  const minFps = input?.minFps ?? 0;
  const minResolution = input?.minResolution ?? "any";
  if (
    typeof query !== "string" ||
    query.trim().length < 2 ||
    query.trim().length > 80 ||
    /[\x00-\x1f\x7f]/.test(query)
  ) {
    throw new ChannelError(
      "Enter a search keyword between 2 and 80 characters",
    );
  }
  if (!Number.isInteger(count) || count < 0 || count > 50000) {
    throw new ChannelError("Choose a video count of 1 or more (or 0 for unlimited)");
  }
  if (!MIN_FPS_CHOICES.includes(minFps)) throw new ChannelError("Choose a valid minimum FPS filter");
  if (!Object.hasOwn(MIN_RESOLUTIONS, minResolution)) throw new ChannelError("Choose a valid minimum resolution filter");
  return { query: query.trim(), count, minFps, minResolution };
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
  if (!tab?.id || !tab.webSocketDebuggerUrl || tab.type !== "page") {
    throw new InstagramBrowserError(
      "Chromium could not create an Instagram search tab",
    );
  }
  const ws = new URL(tab.webSocketDebuggerUrl);
  if (
    ws.protocol !== "ws:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(ws.hostname)
  ) {
    throw new InstagramBrowserError(
      "Refusing a non-local Chromium debugger",
      400,
    );
  }
  return {
    id: tab.id,
    socketUrl: `ws://127.0.0.1:${port}${ws.pathname}${ws.search}`,
  };
}

async function createSearchTab(port, searchUrl) {
  let response;
  try {
    response = await fetch(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent(searchUrl)}`,
      {
        method: "PUT",
        signal: AbortSignal.timeout(3000),
      },
    );
  } catch {
    const launched = await launchPrivateChrome(port, searchUrl).catch(
      () => false,
    );
    if (launched) {
      try {
        response = await fetch(
          `http://127.0.0.1:${port}/json/new?${encodeURIComponent(searchUrl)}`,
          {
            method: "PUT",
            signal: AbortSignal.timeout(6000),
          },
        );
      } catch {
        response = null;
      }
    }
  }
  if (!response) {
    throw new InstagramBrowserError(
      "Start the private Chrome service before using automatic Instagram search",
    );
  }
  if (!response.ok)
    throw new InstagramBrowserError(
      `Local Chrome tab creation failed (HTTP ${response.status})`,
    );
  return localDebugger(await response.json(), port);
}

async function closeSearchTab(port, id) {
  if (!id) return;
  try {
    await fetch(
      `http://127.0.0.1:${port}/json/close/${encodeURIComponent(id)}`,
      {
        signal: AbortSignal.timeout(3000),
      },
    );
  } catch {
    /* Local Chrome may have closed already. */
  }
}

export class InstagramMediaCollector {
  constructor({
    port = 9222,
    createTab = createSearchTab,
    closeTab = closeSearchTab,
    connect = DevtoolsSession.connect,
    pause = wait,
    probeMedia = (url) => new InstagramMediaProber().probe(url),
  } = {}) {
    this.port = port;
    this.createTab = createTab;
    this.closeTab = closeTab;
    this.connect = connect;
    this.pause = pause;
    this.probeMedia = probeMedia;
    this.phase = "idle";
    this.query = "";
    this.requested = 0;
    this.minFps = 0;
    this.minResolution = "any";
    this.checked = 0;
    this.rejected = 0;
    this.visited = 0;
    this.error = null;
    this.note = "";
    this.urls = new Map();
    this.seen = new Set();
    this.details = new Map();
    this.aborted = false;
    this.session = null;
    this.tabId = null;
  }

  status() {
    return {
      phase: this.phase,
      query: this.query,
      requested: this.requested,
      minFps: this.minFps,
      minResolution: this.minResolution,
      checked: this.checked,
      rejected: this.rejected,
      found: this.urls.size,
      visited: this.visited,
      error: this.error,
      note: this.note,
    };
  }

  results() {
    const entries = this.requested > 0
      ? [...this.urls.entries()].slice(0, this.requested)
      : [...this.urls.entries()];
    return {
      ...this.status(),
      directVideoUrls: entries.map(([, url]) => url),
      videoDetails: entries.map(([key]) => this.details.get(key) ?? null),
    };
  }

  start(input) {
    if (this.phase === "running")
      throw new ChannelError(
        "An Instagram link collection is already running",
        409,
      );
    const { query, count, minFps, minResolution } = validateMediaSearch(input);
    this.query = query;
    this.requested = count;
    this.minFps = minFps;
    this.minResolution = minResolution;
    this.checked = 0;
    this.rejected = 0;
    this.visited = 0;
    this.error = null;
    this.note = "";
    this.urls.clear();
    this.seen.clear();
    this.details.clear();
    this.aborted = false;
    this.phase = "running";
    void this.run().catch((error) => {
      this.phase = this.aborted ? "stopped" : "failed";
      this.error = this.aborted
        ? null
        : error instanceof ChannelError ||
            error instanceof InstagramBrowserError
          ? error.message
          : "Instagram search stopped unexpectedly. Check the private Chrome login.";
    });
    return this.status();
  }

  async capture(items) {
    const targetCount = this.requested > 0 ? this.requested : Infinity;
    const filtered = this.minFps > 0 || this.minResolution !== "any";
    const candidates = [];
    for (const item of items || []) {
      if (this.aborted || this.urls.size >= targetCount || candidates.length >= 24) break;
      for (const candidate of Array.isArray(item.urls) ? item.urls : [item.url]) {
        try {
          const url = validateInstagramMediaUrl(candidate);
          const parsed = new URL(url);
          const key = parsed.origin + parsed.pathname;
          if (!this.seen.has(key)) {
            this.seen.add(key);
            candidates.push({ key, url });
          }
          break;
        } catch {
          // Blob URLs, placeholder videos and non-CDN sources are skipped.
        }
      }
      if (!filtered && this.urls.size + candidates.length >= targetCount) break;
    }
    if (!filtered) {
      for (const { key, url } of candidates) this.urls.set(key, url);
      return;
    }

    // Only probe vetted Instagram CDN URLs. Three simultaneous FFprobe jobs
    // keep the scan responsive without overwhelming the Codespace/network.
    const outcomes = new Array(candidates.length);
    let cursor = 0;
    const worker = async () => {
      while (!this.aborted && cursor < candidates.length) {
        const index = cursor++;
        try {
          const media = await this.probeMedia(candidates[index].url);
          this.checked++;
          if (matchesMediaFilters(media, this)) {
            outcomes[index] = {
              ...candidates[index],
              details: { width: media.video.width, height: media.video.height, fps: media.video.fps },
            };
          } else this.rejected++;
        } catch {
          // Expired or restricted signed links count as rejected; never expose
          // their query tokens through status, errors, or logs.
          this.checked++;
          this.rejected++;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, worker));
    if (this.aborted) return;
    for (const outcome of outcomes) {
      if (!outcome || this.urls.size >= targetCount) continue;
      this.urls.set(outcome.key, outcome.url);
      this.details.set(outcome.key, outcome.details);
    }
  }

  async inspect() {
    const raw = await this.session.evaluate(READ_VISIBLE_MEDIA);
    try {
      return JSON.parse(raw || "{}");
    } catch {
      return { videos: [], tiles: [] };
    }
  }

  async run() {
    const searchUrl = `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(this.query)}`;
    const hovered = new Set();
    try {
      const tab = await this.createTab(this.port, searchUrl);
      this.tabId = tab.id;
      if (this.aborted) return;
      this.session = await this.connect(tab.socketUrl);
      await this.session.call("Runtime.enable");
      const targetCount = this.requested > 0 ? this.requested : Infinity;
      let noProgress = 0;
      const maxScrolls =
        targetCount === Infinity
          ? 10000
          : Math.min(5000, Math.max(24, targetCount * 5));
      for (
        let scan = 0;
        scan < maxScrolls && !this.aborted && this.urls.size < targetCount;
        scan++
      ) {
        await this.pause(scan === 0 ? 1300 : 800);
        let page;
        try {
          page = await this.inspect();
        } catch (error) {
          if (this.aborted) return;
          throw error;
        }
        if (page.path?.startsWith("/accounts/login")) {
          throw new InstagramBrowserError(
            "Instagram login required. Sign in manually in the private Chrome window first.",
            401,
          );
        }
        const previous = this.urls.size;
        await this.capture(page.videos);
        for (const tile of (page.tiles || []).slice(0, 5)) {
          if (this.aborted || this.urls.size >= targetCount) break;
          if (hovered.has(tile.href)) continue;
          hovered.add(tile.href);
          await this.session.call("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: tile.x,
            y: tile.y,
          });
          await this.pause(180);
          await this.capture((await this.inspect()).videos);
        }
        this.visited = scan + 1;
        noProgress = this.urls.size === previous ? noProgress + 1 : 0;
        if (noProgress >= 16) {
          this.note =
            "No new playable videos loaded after repeated scrolling. Try another keyword or sign in to Instagram.";
          break;
        }
        if (this.urls.size < targetCount)
          await this.session.evaluate(SCROLL_RESULTS);
      }
      if (!this.aborted) {
        if (this.minFps || this.minResolution !== "any") {
          this.note = `${this.checked} inspected with FFprobe; ${this.rejected} skipped (quality mismatch or inaccessible media).`;
        }
        this.phase = "completed";
        this.note += this.note ? " " : "";
        this.note +=
          targetCount === Infinity
            ? `Collected ${this.urls.size} direct MP4 URLs (unlimited mode).`
            : this.urls.size < targetCount
              ? `Collected ${this.urls.size} of ${targetCount}. Instagram did not expose more playable video URLs.`
              : `Collected ${targetCount} direct MP4 URLs.`;
      }
    } finally {
      this.session?.close();
      this.session = null;
      await this.closeTab(this.port, this.tabId);
      this.tabId = null;
      if (this.aborted) this.phase = "stopped";
    }
  }

  stop() {
    if (this.phase === "running") {
      this.aborted = true;
      this.note = "Stopped. Collected links are still available below.";
    }
    return this.status();
  }
}
