import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileReelsEmulation } from '../src/instagram-cdp.js';

test('mobile Reels uses an exact portrait viewport and touch input', () => {
  assert.deepEqual(mobileReelsEmulation(540, 960), [
    { method: 'Emulation.setDeviceMetricsOverride', params: {
      width: 540, height: 960, deviceScaleFactor: 1, mobile: true,
    } },
    { method: 'Emulation.setTouchEmulationEnabled', params: { enabled: true, maxTouchPoints: 1 } },
  ]);
});

test('mobile Reels rejects landscape and invalid viewport sizes', () => {
  assert.throws(() => mobileReelsEmulation(960, 540), /portrait/);
  assert.throws(() => mobileReelsEmulation(541.5, 960), /portrait/);
  assert.throws(() => mobileReelsEmulation(200, 960), /portrait/);
});
