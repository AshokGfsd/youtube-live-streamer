#!/usr/bin/env bash
set -euo pipefail

# Run from a Termux clone: git pull && bash start-android.sh
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$HOME/StreamForge-Android"
PREBUILT_DIR="$REPO_DIR/deploy/termux/public"

if [ ! -f "$PREBUILT_DIR/index.html" ]; then
  printf 'Prebuilt Android dashboard is missing. Pull the latest main branch.\n'
  exit 1
fi

for executable in node npm ffmpeg ffprobe tmux; do
  if ! command -v "$executable" >/dev/null 2>&1; then
    printf 'Missing %s. Install it with: pkg install nodejs ffmpeg tmux git\n' "$executable"
    exit 1
  fi
done

mkdir -p "$APP_DIR/src" "$APP_DIR/public"

needs_install=false
if [ ! -d "$APP_DIR/node_modules" ] || ! cmp -s "$REPO_DIR/apps/api/package.json" "$APP_DIR/package.json"; then
  needs_install=true
fi

# Refresh only application files. Never overwrite user .env, uploads or stream state.
cp -R "$REPO_DIR/apps/api/src/." "$APP_DIR/src/"
cp -R "$PREBUILT_DIR/." "$APP_DIR/public/"
cp "$REPO_DIR/apps/api/package.json" "$APP_DIR/package.json"
cp "$REPO_DIR/deploy/termux/.env.example" "$APP_DIR/.env.example"
cp "$REPO_DIR/deploy/termux/start.sh" "$APP_DIR/start.sh"
cp "$REPO_DIR/deploy/termux/README-ANDROID.md" "$APP_DIR/README-ANDROID.md"

if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  printf '\nFirst-time setup: open nano %s/.env\n' "$APP_DIR"
  printf 'Set YOUTUBE_STREAM_KEY to your private YouTube Studio stream key.\n'
  printf 'Then run: cd %s && bash start-android.sh\n' "$REPO_DIR"
  exit 0
fi

if [ "$needs_install" = true ]; then
  printf 'Installing Android API dependencies...\n'
  (cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund)
fi

if tmux has-session -t streamforge 2>/dev/null; then
  printf 'StreamForge is already running. Preserving the active session (and any livestream).\n'
  printf 'To apply updated backend code, stop your livestream, then run:\n'
  printf '  tmux kill-session -t streamforge\n  bash start-android.sh\n'
fi

(cd "$APP_DIR" && bash start.sh)
