#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

for executable in node ffmpeg ffprobe tmux; do
  if ! command -v "$executable" >/dev/null 2>&1; then
    printf 'Missing %s. Install it with: pkg install nodejs-lts ffmpeg tmux\n' "$executable"
    exit 1
  fi
done

if [ ! -f .env ]; then
  printf 'Setup needed: cp .env.example .env && nano .env\n'
  exit 1
fi

storage_mode="$(sed -nE 's/^[[:space:]]*CHANNEL_STORAGE[[:space:]]*=[[:space:]]*([^#[:space:]]+).*$/\1/p' .env | tail -n 1)"
mysql_database="$(sed -nE 's/^[[:space:]]*MYSQL_DATABASE[[:space:]]*=[[:space:]]*([^#[:space:]]+).*$/\1/p' .env | tail -n 1)"
if [ "$storage_mode" != file ] && [ "$storage_mode" != mysql ]; then
  printf 'Choose CHANNEL_STORAGE=file (recommended) or CHANNEL_STORAGE=mysql in .env.\n'
  exit 1
fi

if [ "$storage_mode" = mysql ] && [ -z "$mysql_database" ]; then
  printf 'MySQL mode needs MYSQL_DATABASE. For zero-database Termux use CHANNEL_STORAGE=file in .env.\n'
  exit 1
fi

if [ ! -f public/index.html ]; then
  printf 'Dashboard missing. Download the prebuilt StreamForge Android ZIP.\n'
  exit 1
fi

if [ ! -d node_modules ]; then
  printf 'Dependencies missing. Run: npm install --omit=dev\n'
  exit 1
fi

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock || printf 'Warning: could not acquire Android wake lock; check Termux permissions.\n'
else
  printf 'Warning: termux-wake-lock not available; Android may suspend the server.\n'
fi

# MariaDB is optional: file-backed channel storage needs no database service.
if [ "$storage_mode" = mysql ]; then
  if ! command -v mariadbd >/dev/null 2>&1; then
    printf 'MySQL mode is configured but MariaDB is missing. Run: pkg install mariadb -y\n'
    exit 1
  fi
  if ! mariadb-admin ping --protocol=tcp --host=127.0.0.1 --silent >/dev/null 2>&1; then
    if ! tmux has-session -t streamforge-db 2>/dev/null; then
      tmux new-session -d -s streamforge-db "mariadbd --basedir=$PREFIX --datadir=$PREFIX/var/lib/mysql --bind-address=127.0.0.1"
      printf 'Starting private MariaDB service in tmux session streamforge-db...\n'
    fi
    for attempt in 1 2 3 4 5 6 7 8 9 10; do
      if mariadb-admin ping --protocol=tcp --host=127.0.0.1 --silent >/dev/null 2>&1; then break; fi
      sleep 1
    done
  fi
fi

if tmux has-session -t streamforge 2>/dev/null; then
  printf 'StreamForge server is already running.\n'
else
  tmux new-session -d -s streamforge -c "$APP_DIR" 'STREAMFORGE_PLATFORM=termux LOCAL_ONLY_MODE=true node src/server.js'
  printf 'Started StreamForge in a private, phone-only background session (no login).\n'
fi

healthy=false
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if node -e "fetch('http://127.0.0.1:4000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" >/dev/null 2>&1; then
    healthy=true
    break
  fi
  sleep 1
done
if [ "$healthy" != true ]; then
  printf '\nStreamForge did not become ready. Recent server output:\n'
  tmux capture-pane -pt streamforge -S -50 || true
  exit 1
fi

printf '\nOpen http://127.0.0.1:4000 in Chrome on THIS PHONE.\n'
printf 'If it does not load: tmux attach -t streamforge (see error output).\n'
printf 'To detach from tmux without stopping: Ctrl+B, then D.\n'
printf 'Keep Termux allowed to run in the background, and keep the phone powered.\n'
