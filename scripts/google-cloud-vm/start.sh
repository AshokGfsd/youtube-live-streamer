#!/usr/bin/env bash
# Run from your git checkout on a private Debian Google Cloud VM.
# Services remain in tmux when the browser-based SSH terminal disconnects.
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
app_dir="$HOME/StreamForge-GCloud"
display=':99'

for executable in node npm ffmpeg ffprobe tmux Xvfb xdpyinfo chromium openbox x11vnc websockify mariadb-admin; do
  if ! command -v "$executable" >/dev/null 2>&1; then
    echo "Missing $executable; see scripts/google-cloud-vm/bootstrap-debian.sh" >&2
    exit 1
  fi
done

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if (( node_major < 22 )); then
  echo "Node.js 22+ is required; installed Node.js is $node_major" >&2
  exit 1
fi

if [[ ! -f "$app_dir/.env" ]]; then
  mkdir -p "$app_dir"
  cp "$repo_dir/deploy/termux/.env.example" "$app_dir/.env.example"
  echo "First configure $app_dir/.env (copy .env.example and set MySQL credentials)." >&2
  echo 'Do not paste secrets into scripts, git, or Cloud Shell history.' >&2
  exit 1
fi

if ! grep -Eq '^LOCAL_ONLY_MODE=true$' "$app_dir/.env" ||
   ! grep -Eq '^LISTEN_HOST=127\.0\.0\.1$' "$app_dir/.env" ||
   ! grep -Eq '^INSTAGRAM_DISPLAY=:99$' "$app_dir/.env"; then
  echo 'Expected .env: LOCAL_ONLY_MODE=true, LISTEN_HOST=127.0.0.1, INSTAGRAM_DISPLAY=:99' >&2
  exit 1
fi

if ! mariadb-admin ping --host=127.0.0.1 --protocol=tcp --silent >/dev/null 2>&1; then
  echo 'MariaDB is offline. Start it with: sudo systemctl start mariadb' >&2
  exit 1
fi

if [[ ! -f "$HOME/.vnc/passwd" ]]; then
  echo 'Set a private VNC password first: mkdir -p ~/.vnc && x11vnc -storepasswd' >&2
  exit 1
fi

mkdir -p "$app_dir/src" "$app_dir/public"
cp -R "$repo_dir/apps/api/src/." "$app_dir/src/"
cp -R "$repo_dir/deploy/termux/public/." "$app_dir/public/"
cp "$repo_dir/apps/api/package.json" "$app_dir/package.json"

if [[ ! -d "$app_dir/node_modules" ]]; then
  (cd "$app_dir" && npm install --omit=dev --no-audit --no-fund)
fi

start_session() {
  local name="$1" command="$2"
  if tmux has-session -t "$name" 2>/dev/null; then
    echo "Already running: $name"
  else
    tmux new-session -d -s "$name" "$command"
    echo "Started: $name"
  fi
}

# The virtual portrait screen continues running when Cloud Shell disconnects.
start_session sf-cloud-display 'Xvfb :99 -screen 0 540x960x24 -nolisten tcp'
display_ready=false
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if xdpyinfo -display :99 >/dev/null 2>&1; then
    display_ready=true
    break
  fi
  sleep 1
done
if [[ "$display_ready" != true ]]; then
  echo 'Virtual display did not start. Inspect: tmux capture-pane -pt sf-cloud-display -S -80' >&2
  exit 1
fi
start_session sf-cloud-window-manager 'DISPLAY=:99 openbox'
start_session sf-cloud-vnc "x11vnc -display :99 -localhost -rfbport 5900 -forever -shared -rfbauth '$HOME/.vnc/passwd'"
start_session sf-cloud-web-vnc 'websockify --web=/usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900'
start_session sf-cloud-browser "DISPLAY=:99 chromium --user-data-dir='$HOME/.streamforge-cloud-chromium' --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --window-position=0,0 --window-size=540,960 --no-first-run --no-default-browser-check --disable-gpu --disable-dev-shm-usage --kiosk --app='https://www.instagram.com/reels/'"
start_session sf-cloud-api "cd '$app_dir' && LOCAL_ONLY_MODE=true node src/server.js"

echo
echo 'All services listen on this VM only. Do NOT add public firewall rules.'
echo 'Local checks (from this VM):'
echo '  curl http://127.0.0.1:9222/json/version'
echo '  curl http://127.0.0.1:4000/health'
echo '  tmux capture-pane -pt sf-cloud-api -S -80'
echo 'View the VM desktop privately through an SSH port-forward to 6080.'
