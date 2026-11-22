import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const resolver = new URL('../../../scripts/google-cloud-vm/browser.sh', import.meta.url).pathname;
const codespacesInstaller = new URL('../../../scripts/codespaces/install-deps.sh', import.meta.url).pathname;

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

function codespacesDryRunWithBrowsers(t, browsers) {
  const home = mkdtempSync(join(tmpdir(), 'streamforge-codespaces-browser-test-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const bin = join(home, 'bin');
  mkdirSync(bin);
  // Only the shell utilities required for a read-only --dry-run are present.
  // Isolate browser resolution from Chrome possibly installed in the CI host.
  symlinkSync('/usr/bin/dirname', join(bin, 'dirname'));
  symlinkSync('/usr/bin/sort', join(bin, 'sort'));
  for (const [name, script] of Object.entries(browsers)) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  }
  return spawnSync('/bin/bash', [codespacesInstaller, '--dry-run', '--without-mysql'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: bin, HOME: home, STREAMFORGE_BROWSER_BIN: '' },
  });
}

test('Codespaces dry run detects snap-only Chromium and selects standalone Chrome install', (t) => {
  const result = codespacesDryRunWithBrowsers(t, {
    'chromium-browser': 'echo "Command requires the chromium snap" >&2; exit 1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Snap launcher does not count/);
  assert.match(result.stdout, /would install official standalone Chrome for Testing/);
  assert.match(result.stdout, /nothing was installed/);
});

test('Codespaces dry run accepts a real Chromium executable', (t) => {
  const result = codespacesDryRunWithBrowsers(t, {
    chromium: 'echo "Chromium 157.0.8103.50"',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /standalone Chrome for Testing/);
});
