import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installReelsWatcher } from '../src/instagram-reels-watcher.js';

function reel({ src = 'synthetic.webm', time = 1, duration = 8, paused = false, visible = true } = {}) {
  return {
    currentSrc: src, src, currentTime: time, duration, paused, ended: false,
    getBoundingClientRect() {
      return visible
        ? { left: 0, top: 0, right: 320, bottom: 600, width: 320, height: 600 }
        : { left: 0, top: 750, right: 320, bottom: 1350, width: 320, height: 600 };
    },
    setVisible(value) { visible = value; },
  };
}

function fixture(videos) {
  let tick = null;
  let cleared = false;
  const host = {
    innerWidth: 320, innerHeight: 600,
    document: { querySelectorAll(selector) { assert.equal(selector, 'video'); return videos; } },
    setInterval(callback) { tick = callback; return 1; },
    clearInterval(id) { assert.equal(id, 1); cleared = true; },
  };
  vm.runInNewContext(`(${installReelsWatcher.toString()})()`, host);
  return { host, tick: () => tick(), get cleared() { return cleared; } };
}

test('waits for completion, requests exactly one scroll, then arms for the next visible video', () => {
  const first = reel();
  const second = reel({ src: 'next.webm', time: 0, visible: false });
  const setup = fixture([first, second]);
  const status = setup.host.__streamforgeReels.state;

  assert.equal(status.phase, 'playing');
  assert.equal(status.videoRect.x, 0);
  assert.equal(status.videoRect.width, 320);
  assert.equal(status.videoRect.height, 600);
  assert.equal(status.scrollRequest, 0);
  first.currentTime = 7.8;
  setup.tick();
  assert.equal(status.scrollRequest, 1);
  assert.equal(status.scrollReason, 'near-end');
  setup.tick();
  assert.equal(status.scrollRequest, 1);

  first.setVisible(false);
  second.setVisible(true);
  second.currentTime = 2;
  setup.tick();
  assert.equal(status.scrollRequest, 1);
  assert.equal(status.phase, 'playing');
  second.ended = true;
  second.paused = true;
  setup.tick();
  assert.equal(status.scrollRequest, 2);
  assert.equal(status.scrollReason, 'ended');

  setup.host.__streamforgeReels.stop();
  assert.equal(setup.cleared, true);
  assert.equal(status.phase, 'stopped');
});

test('ignores paused, offscreen, and unloaded videos', () => {
  const first = reel({ duration: NaN, time: 0 });
  const setup = fixture([first]);
  const status = setup.host.__streamforgeReels.state;
  setup.tick();
  assert.equal(status.scrollRequest, 0);

  first.duration = 8;
  first.currentTime = 7.95;
  first.paused = true;
  setup.tick();
  assert.equal(status.phase, 'paused');
  assert.equal(status.scrollRequest, 0);

  first.setVisible(false);
  first.paused = false;
  setup.tick();
  assert.equal(status.phase, 'waiting');
  assert.equal(status.videoRect, null);
  assert.equal(status.scrollRequest, 0);
});

test('recycled video elements with changed sources are treated as new Reels', () => {
  const first = reel({ duration: 3, time: 2.95 });
  const setup = fixture([first]);
  const status = setup.host.__streamforgeReels.state;
  assert.equal(status.scrollRequest, 1);
  const previousId = status.activeId;

  first.currentSrc = 'different.webm';
  first.currentTime = 0;
  setup.tick();
  assert.notEqual(status.activeId, previousId);
  first.currentTime = 2.95;
  setup.tick();
  assert.equal(status.scrollRequest, 2);
});
