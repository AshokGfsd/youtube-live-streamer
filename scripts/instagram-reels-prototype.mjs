#!/usr/bin/env node
/**
 * Experimental Instagram Reels auto-scroll proof of concept for Termux Chromium.
 * It never asks for an Instagram password, downloads Reels or uploads a video.
 * A manually authenticated Chromium page is controlled through loopback CDP.
 *
 * This script does NOT publish to YouTube. First validate the demo, the real
 * Reels playback behavior and X11 capture independently on the user's device.
 */
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installReelsWatcher } from '../apps/api/src/instagram-reels-watcher.js';
import { startReelsDemo } from './instagram-reels-demo.mjs';

function settingsFromArgv(args) {
  const settings = { mode: '', scroll: 'wheel', port: 9222, maxAdvances: null, timeoutSeconds: 45 };
  for (const arg of args) {
    if (arg === '--demo') settings.mode = 'demo';
    else if (arg === '--instagram') settings.mode = 'instagram';
    else if (arg.startsWith('--scroll=')) settings.scroll = arg.slice('--scroll='.length);
    else if (arg.startsWith('--debug-port=')) settings.port = Number(arg.slice('--debug-port='.length));
    else if (arg.startsWith('--max-advances=')) settings.maxAdvances = Number(arg.slice('--max-advances='.length));
    else if (arg.startsWith('--timeout-seconds=')) settings.timeoutSeconds = Number(arg.slice('--timeout-seconds='.length));
    else throw new Error('Unknown option: ' + arg);
  }
  if (!['demo', 'instagram'].includes(settings.mode)) throw new Error('Specify --demo or --instagram');
  if (!['wheel', 'arrow'].includes(settings.scroll)) throw new Error('--scroll must be wheel or arrow');
  if (!Number.isInteger(settings.port) || settings.port < 1024 || settings.port > 65535) throw new Error('Invalid debug port');
  if (settings.maxAdvances === null) settings.maxAdvances = settings.mode === 'demo' ? 2 : 0;
  if (!Number.isInteger(settings.maxAdvances) || settings.maxAdvances < 0 || settings.maxAdvances > 10000) throw new Error('Invalid max advances');
  if (!Number.isInteger(settings.timeoutSeconds) || settings.timeoutSeconds < 5 || settings.timeoutSeconds > 3600) throw new Error('Invalid timeout');
  return settings;
}

class CdpConnection {
  static async connect(debuggerUrl, port) {
    // Chrome's local debugging socket must never connect to a remote host.
    const url = new URL(debuggerUrl);
    if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      throw new Error('Refusing non-loopback Chrome debugging connection');
    }
    const websocket = new WebSocket(`ws://127.0.0.1:${port}${url.pathname}${url.search}`);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chromium debugging connection timed out')), 7000);
      websocket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      websocket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Cannot connect to Chromium debugging tab')); }, { once: true });
    });
    return new CdpConnection(websocket);
  }

  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    socket.addEventListener('message', ({ data }) => {
      let message;
      try { message = JSON.parse(data); } catch { return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Chromium debugging tab closed'));
      }
      this.pending.clear();
    });
  }

  call(method, params = {}) {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Chrome debugging connection is closed'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Chromium CDP command timed out: ' + method));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { this.socket.close(); }
}

async function chromeRequest(port, path, method = 'GET') {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error(`Chromium debugging endpoint returned HTTP ${response.status}`);
  return response.json();
}

async function selectTab(settings, demoUrl) {
  if (demoUrl) {
    return chromeRequest(settings.port, `/json/new?${encodeURIComponent(demoUrl)}`, 'PUT');
  }
  const tabs = await chromeRequest(settings.port, '/json/list');
  const candidates = tabs.filter((tab) => {
    if (tab.type !== 'page' || !tab.webSocketDebuggerUrl) return false;
    try { return ['www.instagram.com', 'instagram.com'].includes(new URL(tab.url).hostname); }
    catch { return false; }
  });
  const reels = candidates.find((tab) => new URL(tab.url).pathname.startsWith('/reels'));
  if (!reels && candidates.length === 0) {
    throw new Error('Open Instagram Reels and log in manually in the Termux Chromium window first');
  }
  if (!reels) console.log('Tip: manually open https://www.instagram.com/reels/ for the Reels feed.');
  return reels || candidates[0];
}

async function evaluate(client, expression) {
  const result = await client.call('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error('Browser page evaluation failed');
  return result.result?.value;
}

async function scroll(client, state, mode) {
  if (mode === 'arrow') {
    await client.call('Input.dispatchKeyEvent', {
      type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40,
    });
    await client.call('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40,
    });
    return;
  }
  await client.call('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: Math.round((state.viewportWidth || 400) / 2),
    y: Math.round((state.viewportHeight || 800) / 2),
    deltaX: 0, deltaY: Math.round((state.viewportHeight || 800) * 0.98),
  });
}

export async function runPrototype(args = process.argv.slice(2)) {
  const settings = settingsFromArgv(args);
  let demo = null;
  let client = null;
  let stopping = false;
  const onSignal = () => { stopping = true; };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    if (settings.mode === 'demo') {
      console.log('Preparing three short, synthetic (original) Reel test videos...');
      demo = await startReelsDemo();
      console.log('Temporary demo feed:', demo.url);
    }
    let target;
    try { target = await selectTab(settings, demo?.url); }
    catch (error) {
      throw new Error('Chromium not ready. Start it with --remote-debugging-address=127.0.0.1 --remote-debugging-port=' + settings.port + ' and a dedicated --user-data-dir. ' + error.message);
    }
    client = await CdpConnection.connect(target.webSocketDebuggerUrl, settings.port);
    await client.call('Runtime.enable');
    const injection = `(${installReelsWatcher.toString()})(${JSON.stringify({ tickMs: 130 })})`;
    await evaluate(client, injection);
    console.log('Watching visible HTML5 Reels. Scroll method:', settings.scroll);
    console.log('No Instagram credentials, video files or cookies are copied by this prototype. Ctrl+C to stop.');

    let lastId = null;
    let lastPhase = null;
    let handledRequest = 0;
    let awaitingNextId = null;
    let verifiedAdvances = 0;
    const begun = Date.now();
    while (!stopping) {
      if (settings.mode === 'demo' && Date.now() - begun > settings.timeoutSeconds * 1000) {
        throw new Error('Demo timed out: the browser may not be playing or scrolling the test videos');
      }
      const encoded = await evaluate(client, 'JSON.stringify(globalThis.__streamforgeReels?.state || null)');
      const state = encoded ? JSON.parse(encoded) : null;
      if (!state) {
        // A navigation discards the previous page's watcher and counters.
        handledRequest = 0;
        awaitingNextId = null;
        lastId = null;
        lastPhase = null;
        await evaluate(client, injection);
        await delay(350);
        continue;
      }
      if (state.activeId && state.activeId !== lastId) {
        if (awaitingNextId !== null && state.activeId !== awaitingNextId) {
          verifiedAdvances += 1;
          console.log(`Verified next Reel (${verifiedAdvances}):`, state.activeId);
          awaitingNextId = null;
          if (settings.maxAdvances && verifiedAdvances >= settings.maxAdvances) {
            console.log('PASS: auto-scroll transitioned to', settings.maxAdvances, 'successive videos.');
            return;
          }
        }
        lastId = state.activeId;
        console.log('Active Reel:', state.activeId);
      }
      if (state.phase !== lastPhase) {
        lastPhase = state.phase;
        console.log(`Feed state: ${state.phase}${state.duration ? ` (${state.duration}s)` : ''}`);
      }
      if (state.scrollRequest > handledRequest) {
        handledRequest = state.scrollRequest;
        awaitingNextId = state.activeId;
        console.log('Reel finished:', state.scrollReason, '— requesting one scroll');
        await scroll(client, state, settings.scroll);
      }
      if (state.phase === 'stalled') {
        throw new Error('Scroll did not reveal another video. Try --scroll=arrow, or check Instagram page behavior.');
      }
      await delay(300);
    }
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    try { await client?.call('Runtime.evaluate', { expression: 'globalThis.__streamforgeReels?.stop?.()' }); } catch { /* ignore */ }
    client?.close();
    if (demo) await demo.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runPrototype().catch((error) => {
    console.error('Prototype failed:', error.message);
    process.exitCode = 1;
  });
}
