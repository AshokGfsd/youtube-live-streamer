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

test('allows token-free mode only for a loopback-bound bundled dashboard', () => {
  const local = { LOCAL_ONLY_MODE: 'true', LISTEN_HOST: '127.0.0.1', WEB_STATIC_DIR: './public' };
  assert.equal(assertValidConfiguration(local).maxBytes, 4 * 1024 ** 3);
  assert.throws(() => assertValidConfiguration({ ...local, LISTEN_HOST: '0.0.0.0' }), /LOCAL_ONLY_MODE/);
  assert.throws(() => assertValidConfiguration({ ...local, LISTEN_HOST: 'localhost' }), /LOCAL_ONLY_MODE/);
  assert.throws(() => assertValidConfiguration({ ...local, WEB_STATIC_DIR: '' }), /LOCAL_ONLY_MODE/);
});

test('wildcard CORS and Cloud Shell preview require an explicit private token and HTTPS origin', () => {
  const local = { LOCAL_ONLY_MODE: 'true', LISTEN_HOST: '127.0.0.1', WEB_STATIC_DIR: './public' };
  const token = 'test-dashboard-access-token-over-24-chars';
  assert.throws(() => assertValidConfiguration({ ...local, CORS_ALLOW_ALL_ORIGINS: 'true' }), /DASHBOARD_TOKEN/);
  assert.throws(() => assertValidConfiguration({ ...local, CLOUD_SHELL_PREVIEW_ORIGIN: 'https://preview.example' }), /DASHBOARD_TOKEN/);
  assert.throws(() => assertValidConfiguration({ ...local, DASHBOARD_TOKEN: token, CLOUD_SHELL_PREVIEW_ORIGIN: 'http://preview.example' }), /exact HTTPS/);
  assert.throws(() => assertValidConfiguration({ ...local, DASHBOARD_TOKEN: token, CLOUD_SHELL_PREVIEW_ORIGIN: 'https://preview.example/unsafe' }), /exact HTTPS/);
  assert.throws(() => assertValidConfiguration({ ...local, DASHBOARD_TOKEN: token, CLOUD_SHELL_PREVIEW_ORIGIN: 'https://preview.example?key=x' }), /exact HTTPS/);
  const result = assertValidConfiguration({ ...local, DASHBOARD_TOKEN: token,
    CLOUD_SHELL_PREVIEW_ORIGIN: 'https://4000-cs-user.cloudshell.dev', CORS_ALLOW_ALL_ORIGINS: 'true' });
  assert.equal(result.previewOrigin, 'https://4000-cs-user.cloudshell.dev');
  assert.equal(result.allowAllOrigins, true);
});
