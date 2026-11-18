import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'apps/web');
const target = path.join(root, 'dist/android/StreamForge-Android');

console.log('Building the static dashboard for Android...');
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
  'run', 'build', '--workspace', '@streamforge/web',
], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, STREAMFORGE_STATIC_EXPORT: '1', NEXT_PUBLIC_API_BASE_URL: '' },
});

await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(target, { recursive: true });
await Promise.all([
  fs.cp(path.join(root, 'apps/api/src'), path.join(target, 'src'), { recursive: true }),
  fs.cp(path.join(web, 'out'), path.join(target, 'public'), { recursive: true }),
  fs.copyFile(path.join(root, 'apps/api/package.json'), path.join(target, 'package.json')),
  fs.copyFile(path.join(root, 'deploy/termux/.env.example'), path.join(target, '.env.example')),
  fs.copyFile(path.join(root, 'deploy/termux/README-ANDROID.md'), path.join(target, 'README-ANDROID.md')),
  fs.copyFile(path.join(root, 'deploy/termux/start.sh'), path.join(target, 'start.sh')),
]);
await fs.chmod(path.join(target, 'start.sh'), 0o755);
console.log('Android kit created: ' + target);
