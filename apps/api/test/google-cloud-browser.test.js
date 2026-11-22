import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const resolver = new URL('../../../scripts/google-cloud-vm/browser.sh', import.meta.url).pathname;

function withFakeBrowsers(t, entries, command, overrides = {}) {
  const home = mkdtempSync(join(tmpdir(), 'streamforge-chrome-test-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const bin = join(home, 'bin');
  mkdirSync(bin);
  for (const [name, script] of Object.entries(entries)) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  }
  return spawnSync('/bin/bash', ['-c', `source '${resolver}'; ${command}`], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      PATH: bin,
      STREAMFORGE_BROWSER_BIN: '',
      ...(typeof overrides === 'function' ? overrides({ home, bin }) : overrides),
    },
  });
}

test('Google VM browser selection uses an installed real Chrome instead of snap stub', (t) => {
  const result = withFakeBrowsers(t, {
    'chromium-browser': 'echo "Chromium snap is not installed" >&2; exit 1',
    'google-chrome-stable': 'echo "Google Chrome 157.0.8103.50"',
  }, 'streamforge_browser_path');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\/bin\/google-chrome-stable\n$/);
});

test('Google VM browser selection rejects a snap-only launcher', (t) => {
  const result = withFakeBrowsers(t, {
    'chromium-browser': 'echo "Command requires the chromium snap" >&2; exit 1',
  }, 'streamforge_browser_path');

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
});

test('Google VM browser selection accepts a valid custom binary', (t) => {
  const result = withFakeBrowsers(t, {
    'custom-chrome': 'echo "Google Chrome for Testing 157.0.8103.50"',
  }, 'streamforge_browser_path', ({ bin }) => ({ STREAMFORGE_BROWSER_BIN: join(bin, 'custom-chrome') }));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\/bin\/custom-chrome\n$/);
});
