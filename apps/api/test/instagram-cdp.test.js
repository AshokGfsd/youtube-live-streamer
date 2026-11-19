import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileReelsEmulation } from '../src/instagram-cdp.js';

test('mobile Reels renders a phone-width CSS viewport at the X11 capture resolution', () => {
  assert.deepEqual(mobileReelsEmulation(540, 960), [
    { method: 'Emulation.setDeviceMetricsOverride', params: {
      width: 360, height: 640, deviceScaleFactor: 1.5, mobile: true,
      screenWidth: 360, screenHeight: 640,
    } },
    { method: 'Emulation.setTouchEmulationEnabled', params: { enabled: true, maxTouchPoints: 1 } },
  ]);
});

test('mobile emulation keeps smaller captures at 1x and larger captures proportional', () => {
  const small = mobileReelsEmulation(320, 568)[0].params;
  assert.equal(small.width, 320);
  assert.equal(small.height, 568);
  assert.equal(small.deviceScaleFactor, 1);

  const large = mobileReelsEmulation(1080, 1920)[0].params;
  assert.equal(large.width, 360);
  assert.equal(large.height, 640);
  assert.equal(large.deviceScaleFactor, 3);
  assert.equal(large.width * large.deviceScaleFactor, 1080);
  assert.equal(large.height * large.deviceScaleFactor, 1920);
});

test('mobile Reels rejects landscape and invalid viewport sizes', () => {
  assert.throws(() => mobileReelsEmulation(960, 540), /portrait/);
  assert.throws(() => mobileReelsEmulation(541.5, 960), /portrait/);
  assert.throws(() => mobileReelsEmulation(200, 960), /portrait/);
});
