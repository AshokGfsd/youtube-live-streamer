/**
 * Experimental, page-local Reel completion detector.
 *
 * This function deliberately has no imports or free variables: its source can
 * be evaluated in a Chromium tab using the Chrome DevTools Protocol. It reads
 * the HTMLMediaElement state only. Navigation is performed by a separate,
 * user-operated CDP client so that it can be stopped immediately.
 */
export function installReelsWatcher({ tickMs = 150, nearEndSeconds = 0.3 } = {}) {
  const host = globalThis;
  host.__streamforgeReels?.stop?.();

  const state = {
    phase: 'waiting',
    activeId: null,
    currentTime: null,
    duration: null,
    scrollRequest: 0,
    scrollReason: null,
    viewportWidth: host.innerWidth || 400,
    viewportHeight: host.innerHeight || 800,
    // CSS pixel rectangle for the Reel currently playing. This lets FFmpeg
    // capture just the video instead of empty Instagram web-page margins.
    videoRect: null,
    error: null,
  };
  const identity = new WeakMap();
  let nextIdentity = 0;
  let currentId = null;
  let requestedFor = null;
  let requestedAt = 0;

  function visibleFraction(video) {
    const rect = video.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return 0;
    const visibleWidth = Math.max(0, Math.min(rect.right, host.innerWidth) - Math.max(0, rect.left));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, host.innerHeight) - Math.max(0, rect.top));
    return (visibleWidth * visibleHeight) / (rect.width * rect.height);
  }

  function activeVideo() {
    const videos = Array.from(host.document.querySelectorAll('video'));
    const scored = videos.map((video) => ({
      video,
      visible: visibleFraction(video),
      playing: !video.paused && !video.ended,
    })).filter((item) => item.visible >= 0.3);
    scored.sort((a, b) => (b.visible + (b.playing ? 0.4 : 0)) - (a.visible + (a.playing ? 0.4 : 0)));
    return scored[0]?.video || null;
  }

  function identify(video) {
    const source = video.currentSrc || video.src || '';
    let entry = identity.get(video);
    if (!entry || entry.source !== source) {
      entry = { source, id: ++nextIdentity };
      identity.set(video, entry);
    }
    return entry.id;
  }

  function tick() {
    try {
      state.viewportWidth = host.innerWidth || 400;
      state.viewportHeight = host.innerHeight || 800;
      const video = activeVideo();
      if (!video) {
        state.phase = 'waiting';
        state.activeId = null;
        state.videoRect = null;
        state.currentTime = null;
        state.duration = null;
        return;
      }

      const id = identify(video);
      const rect = video.getBoundingClientRect();
      state.videoRect = {
        x: Math.round(rect.left), y: Math.round(rect.top),
        width: Math.round(rect.width), height: Math.round(rect.height),
      };
      if (currentId !== id) {
        currentId = id;
        requestedFor = null;
        requestedAt = 0;
      }
      state.activeId = id;

      const duration = Number(video.duration);
      const currentTime = Number(video.currentTime);
      state.duration = Number.isFinite(duration) && duration > 0 ? Math.round(duration * 10) / 10 : null;
      state.currentTime = Number.isFinite(currentTime) ? Math.round(currentTime * 10) / 10 : null;

      if (requestedFor === id) {
        state.phase = Date.now() - requestedAt > 6500 ? 'stalled' : 'scroll-requested';
        return;
      }

      const ended = video.ended === true;
      const closeToEnd = Number.isFinite(duration) && duration > 0.5 &&
        Number.isFinite(currentTime) && currentTime >= Math.max(0.25, duration - Math.min(nearEndSeconds, duration * 0.15)) &&
        !video.paused;
      state.phase = video.paused && !ended ? 'paused' : 'playing';
      if (ended || closeToEnd) {
        requestedFor = id;
        requestedAt = Date.now();
        state.scrollRequest += 1;
        state.scrollReason = ended ? 'ended' : 'near-end';
        state.phase = 'scroll-requested';
      }
    } catch {
      // Instagram can replace video DOM nodes during a transition. Keep the
      // controller alive and re-detect on the next tick without leaking details.
      state.phase = 'waiting';
      state.error = 'Video elements temporarily unavailable';
    }
  }

  const timer = host.setInterval(tick, Math.max(75, Math.min(Number(tickMs) || 150, 1000)));
  host.__streamforgeReels = {
    state,
    stop() { host.clearInterval(timer); state.phase = 'stopped'; },
  };
  tick();
  return state;
}
