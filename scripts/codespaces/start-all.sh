#!/usr/bin/env bash
# Start all StreamForge services in GitHub Codespaces (no Termux).
# Run from anywhere: bash /workspaces/youtube-live-streamer/start-all.sh
# tmux keeps the services alive when you close the terminal.
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_dir/scripts/google-cloud-vm/browser.sh"
app_dir="$HOME/StreamForge-GCloud"
file_storage=false
if [[ -f "$app_dir/.env" ]] && grep -Eq '^CHANNEL_STORAGE=file[[:space:]]*$' "$app_dir/.env"; then file_storage=true; fi

step() { printf '\n[%s] %s\n' "$1" "$2"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# 1. Install only missing system prerequisites on Ubuntu/Debian Codespaces.
# Re-running start-all is safe; no apt update/install runs when all are present.
step '1/8' 'Checking and auto-installing missing programs...'
install_args=()
if [[ "$file_storage" == true ]]; then install_args+=(--without-mysql); fi
bash "$repo_dir/scripts/codespaces/install-edge.sh" || fail 'Microsoft Edge installation failed.'
export STREAMFORGE_BROWSER_BIN="$(command -v microsoft-edge-stable || command -v microsoft-edge)"
bash "$repo_dir/scripts/codespaces/install-deps.sh" "${install_args[@]}" || fail 'Could not install missing system dependencies.'
programs=(node npm curl ffmpeg ffprobe tmux Xvfb xdpyinfo openbox x11vnc websockify pulseaudio pactl parec)
if [[ "$file_storage" == false ]]; then programs+=(mariadb-admin); fi
for program in "${programs[@]}"; do
  command -v "$program" >/dev/null 2>&1 || fail "$program is still missing after installation."
done
browser="$(streamforge_browser_path)" || fail 'A working Microsoft Edge browser is required.'
echo "Browser selected: $browser"
[[ -d /usr/share/novnc ]] || fail 'noVNC web files missing; install the novnc package.'
(( $(node -p 'Number(process.versions.node.split(".")[0])') >= 22 )) || fail 'Node.js 22+ is required.'

# 2. Keep the existing DB passwords, stream keys and saved Instagram session.
# First run only: enter a PRIVATE password when x11vnc prompts you.
step '2/8' 'Checking .env and the private VNC password...'
if [[ ! -f "$app_dir/.env" ]]; then
  mkdir -p "$app_dir"
  cp "$repo_dir/deploy/termux/.env.example" "$app_dir/.env.example"
  fail "Copy $app_dir/.env.example to $app_dir/.env and configure CHANNEL_STORAGE=file for a database-free setup."
fi
grep -Eq '^LOCAL_ONLY_MODE=true$' "$app_dir/.env" || fail 'Set LOCAL_ONLY_MODE=true in .env'
grep -Eq '^LISTEN_HOST=127\.0\.0\.1$' "$app_dir/.env" || fail 'Set LISTEN_HOST=127.0.0.1 in .env'
grep -Eq '^INSTAGRAM_DISPLAY=:99$' "$app_dir/.env" || fail 'Set INSTAGRAM_DISPLAY=:99 in .env'
mkdir -p "$HOME/.vnc"
chmod 700 "$HOME/.vnc"
if [[ ! -s "$HOME/.vnc/passwd" ]]; then
  echo 'Choose a VNC password when prompted; do not share it.'
  x11vnc -storepasswd "$HOME/.vnc/passwd" || fail 'VNC password setup failed.'
fi
chmod 600 "$HOME/.vnc/passwd"

# 3. Start MariaDB via service (works without systemd in GitHub Codespaces).
# Existing database tables and user accounts are preserved.
step '3/8' 'Starting MariaDB...'
if [[ "$file_storage" == true ]]; then
  echo 'Skipped: CHANNEL_STORAGE=file (encrypted channel data on local disk).'
else
  if ! sudo mariadb-admin ping --silent >/dev/null 2>&1; then
    sudo service mariadb start || fail 'MariaDB failed to start; check sudo service mariadb status'
  fi
  sudo mariadb-admin ping --silent >/dev/null 2>&1 || fail 'MariaDB is still unavailable.'
  echo 'MariaDB ready.'
fi

# 4. Start PulseAudio and create the virtual sink captured by the livestream.
# The Instagram browser will send its audio to sf_audio.
step '4/8' 'Starting PulseAudio and sf_audio...'
if ! pactl info >/dev/null 2>&1; then
  pulseaudio --start --exit-idle-time=-1 || fail 'PulseAudio could not start.'
fi
if ! pactl list short sinks | awk '$2 == "sf_audio" { found=1 } END { exit !found }'; then
  pactl load-module module-null-sink sink_name=sf_audio sink_properties=device.description=StreamForgeAudio >/dev/null
fi
pactl set-default-sink sf_audio
pactl set-default-source sf_audio.monitor
echo 'Audio capture: sf_audio.monitor'

# 5. Refresh ONLY application files. Never overwrite .env, MySQL data,
# Instagram browser profiles, uploaded videos or encrypted channel keys.
step '5/8' 'Refreshing API and dashboard...'
mkdir -p "$app_dir/src" "$app_dir/public"
needs_install=false
if [[ ! -d "$app_dir/node_modules" ]] || ! cmp -s "$repo_dir/apps/api/package.json" "$app_dir/package.json"; then
  needs_install=true
fi
cp -R "$repo_dir/apps/api/src/." "$app_dir/src/"
cp -R "$repo_dir/deploy/termux/public/." "$app_dir/public/"
cp "$repo_dir/apps/api/package.json" "$app_dir/package.json"
if [[ "$needs_install" == true ]]; then
  (cd "$app_dir" && npm install --omit=dev --no-audit --no-fund)
fi

# Each process gets one named tmux session. Starting twice is safe: existing
# sessions stay running, so a running YouTube broadcast is not interrupted.
start_session() {
  local name="$1" command="$2"
  if tmux has-session -t "$name" 2>/dev/null; then
    echo "Already running: $name"
  else
    tmux new-session -d -s "$name" "$command"
    echo "Started: $name"
  fi
}

# 6. Start the virtual landscape screen and window manager.
step '6/8' 'Starting Xvfb :99 at 1366x768 and Openbox...'
if ! xdpyinfo -display :99 >/dev/null 2>&1; then
  start_session sf-cloud-display 'Xvfb :99 -screen 0 1366x768x24 -nolisten tcp'
else
  echo 'X11 display :99 already active; reusing it.'
fi
ready=false
for attempt in {1..12}; do
  if xdpyinfo -display :99 >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || fail 'Xvfb did not start. Try: tmux capture-pane -pt sf-cloud-display -S -80'
start_session sf-cloud-window-manager 'DISPLAY=:99 openbox'

# 7. Start password-protected VNC, browser-based noVNC and Instagram Chrome.
# Use a normal browser window (tabs, address bar and navigation visible), not
# kiosk/app mode. The collector can still open tabs through the private CDP port.
# Ports 5900, 6080 and 9222 listen on 127.0.0.1 only (not public Internet).
step '7/8' 'Starting x11vnc, noVNC and Instagram Chrome...'
start_session sf-cloud-vnc "x11vnc -display :99 -localhost -rfbport 5900 -forever -shared -rfbauth '$HOME/.vnc/passwd'"
start_session sf-cloud-web-vnc 'websockify --web=/usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900'
# Keep crash diagnostics even when the browser exits and tmux removes its pane.
umask 077
mkdir -p "$app_dir/logs"
printf -v browser_quoted '%q' "$browser"
start_session sf-cloud-browser "DISPLAY=:99 $browser_quoted --user-data-dir='$HOME/.streamforge-cloud-edge' --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --window-position=0,0 --window-size=1366,768 --start-maximized --no-first-run --no-default-browser-check --disable-gpu --disable-dev-shm-usage --new-window 'https://www.instagram.com/reels/' >> '$app_dir/logs/browser.log' 2>&1"

# 8. Start the Node.js backend (including MariaDB-backed channel management).
# Starting services is NOT starting YouTube Live: use the dashboard after login.
step '8/8' 'Starting StreamForge API on 127.0.0.1:4000...'
start_session sf-cloud-api "cd '$app_dir' && LOCAL_ONLY_MODE=true node src/server.js"

check_url() {
  local title="$1" url="$2" session="$3"
  for attempt in {1..12}; do
    if curl --silent --fail --max-time 2 "$url" >/dev/null 2>&1; then
      echo "READY: $title — $url"
      return 0
    fi
    sleep 1
  done
  echo "WARNING: $title did not become ready. Check: tmux capture-pane -pt $session -S -80" >&2
  if [[ "$session" == sf-cloud-browser ]]; then
    echo "Browser errors are also saved to: $app_dir/logs/browser.log" >&2
    tail -n 25 "$app_dir/logs/browser.log" >&2 || true
  fi
  return 1
}

echo
all_ready=true
check_url 'StreamForge API' 'http://127.0.0.1:4000/health' sf-cloud-api || all_ready=false
check_url 'Instagram Chrome' 'http://127.0.0.1:9222/json/version' sf-cloud-browser || all_ready=false
check_url 'Private noVNC' 'http://127.0.0.1:6080/vnc.html' sf-cloud-web-vnc || all_ready=false
[[ "$all_ready" == true ]] || fail 'One or more services failed their startup checks. Inspect the tmux logs above.'
echo
echo 'Start your private YouTube livestream from the StreamForge dashboard.'
echo 'To stop these services: bash stop-all.sh'
echo 'Do not publicly expose ports 4000, 5900, 6080 or 9222.'
