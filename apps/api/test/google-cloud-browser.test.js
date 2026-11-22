import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const resolver = new URL('../../../scripts/google-cloud-vm/browser.sh', import.meta.url).pathname;
const codespacesInstaller = new URL('../../../scripts/codespaces/install-deps.sh', import.meta.url).pathname;
const standaloneInstaller = new URL('../../../scripts/google-cloud-vm/install-browser.sh', import.meta.url).pathname;

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

test('Codespaces Chrome installer installs official deb.deps when shared libraries are missing', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'streamforge-chrome-deps-test-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const bin = join(home, 'bin');
  mkdirSync(bin);
  const target = join(home, '.local/share/streamforge-browser/158.0.8127.36/chrome-linux64');
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'chrome'), `#!/bin/sh\nif [ ! -f "$HOME/deps-installed" ]; then\n  echo 'error while loading shared libraries: libnss3.so' >&2\n  exit 127\nfi\necho 'Google Chrome for Testing 158.0.8127.36'\n`, { mode: 0o755 });
  writeFileSync(join(target, 'deb.deps'), 'libnss3 (>= 2:3.26)\nlibgbm1\n');
  writeFileSync(join(home, 'manifest.json'), JSON.stringify({ channels: { Stable: {
    version: '158.0.8127.36',
    downloads: { chrome: [{ platform: 'linux64', url: 'https://storage.googleapis.com/chrome-for-testing-public/158.0.8127.36/linux64/chrome-linux64.zip' }] },
  } } }));
  writeFileSync(join(bin, 'curl'), `#!/bin/sh\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = '-o' ]; then shift; output="$1"; fi\n  shift\ndone\ncp "$HOME/manifest.json" "$output"\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'ldd'), `#!/bin/sh\nif [ ! -f "$HOME/deps-installed" ]; then echo 'libnss3.so => not found'; fi\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'sudo'), `#!/bin/sh\nif [ "$1" = '-n' ]; then shift; fi\nif [ "$1" = 'true' ]; then exit 0; fi\nif [ "$1" != 'apt-get' ]; then exit 1; fi\nprintf '%s\\n' "$*" >> "$HOME/apt-commands"\nif [ "$2" = 'satisfy' ]; then touch "$HOME/deps-installed"; fi\n`, { mode: 0o755 });
  const result = spawnSync('/bin/bash', [standaloneInstaller], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, STREAMFORGE_INSTALL_SYSTEM_CHROME_DEPS: 'true', STREAMFORGE_BROWSER_BIN: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Installing Chrome for Testing system dependencies/);
  assert.match(result.stdout, /READY: Google Chrome for Testing 158/);
  const aptCalls = readFileSync(join(home, 'apt-commands'), 'utf8');
  assert.match(aptCalls, /update/);
  assert.match(aptCalls, /satisfy -y --no-install-recommends libnss3/);
  assert.match(aptCalls, /satisfy -y --no-install-recommends libgbm1/);
});
