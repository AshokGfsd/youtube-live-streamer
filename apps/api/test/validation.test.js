import test from 'node:test';
import assert from 'node:assert/strict';
import { validVideoName, safeEquals, safeLogLine, assertValidConfiguration } from '../src/validation.js';

test('accepts supported video extensions without trusting MIME type', () => {
  assert.equal(validVideoName('holiday.MP4'), true);
  assert.equal(validVideoName('clip.mkv'), true);
  assert.equal(validVideoName('script.js'), false);
  assert.equal(validVideoName('fake.mp4.exe'), false);
});

test('auth token comparison requires an exact match', () => {
  assert.equal(safeEquals('Bearer 123456', 'Bearer 123456'), true);
  assert.equal(safeEquals('Bearer 123457', 'Bearer 123456'), false);
  assert.equal(safeEquals(null, 'Bearer 123456'), false);
});

test('never exposes a stream key in ffmpeg output', () => {
  assert.equal(safeLogLine('rtmps://example/live/secret-123', 'secret-123'), 'rtmps://example/live/[REDACTED]');
});

test('validates public deployment secrets and URL', () => {
  const token = 'this-is-an-example-token-123456';
  assert.throws(() => assertValidConfiguration({ DASHBOARD_TOKEN: 'short' }));
  assert.throws(() => assertValidConfiguration({ DASHBOARD_TOKEN: token, YOUTUBE_RTMPS_URL: 'http://bad' }));
  assert.equal(assertValidConfiguration({ DASHBOARD_TOKEN: token }).maxBytes, 4 * 1024 ** 3);
});
