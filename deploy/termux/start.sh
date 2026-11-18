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

if [ ! -f public/index.html ]; then
  printf 'Dashboard missing. Download the prebuilt StreamForge Android ZIP.\n'
  exit 1
fi

if [ ! -d node_modules ]; then
  printf 'Dependencies missing. Run: npm install --omit=dev\n'
  exit 1
fi

termux-wake-lock

# Keep the local MariaDB worker alive independently from Chrome and the Node API.
# The database is only started when multi-channel mode has been configured.
if grep -Eq '^MYSQL_DATABASE=[^[:space:]#]+' .env; then
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
  tmux new-session -d -s streamforge -c "$APP_DIR" 'LOCAL_ONLY_MODE=true node src/server.js'
  printf 'Started StreamForge in a private, phone-only background session (no login).\n'
fi

printf '\nOpen http://127.0.0.1:4000 in Chrome on THIS PHONE.\n'
printf 'If it does not load: tmux attach -t streamforge (see error output).\n'
printf 'To detach from tmux without stopping: Ctrl+B, then D.\n'
printf 'Keep Termux allowed to run in the background, and keep the phone powered.\n'
