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

if tmux has-session -t streamforge 2>/dev/null; then
  printf 'StreamForge server is already running.\n'
else
  tmux new-session -d -s streamforge -c "$APP_DIR" 'node src/server.js'
  printf 'Started StreamForge in a Termux background session.\n'
fi

printf '\nOpen http://127.0.0.1:4000 in Chrome on THIS PHONE.\n'
printf 'If it does not load: tmux attach -t streamforge (see error output).\n'
printf 'To detach from tmux without stopping: Ctrl+B, then D.\n'
printf 'Keep Termux allowed to run in the background, and keep the phone powered.\n'
