#!/usr/bin/env bash
# Install only the system packages missing from this GitHub Codespace.
# Uses Ubuntu/Debian apt and the existing passwordless sudo permission.
# Never touches .env, stream keys, browser profiles, uploads, or MySQL data.
set -euo pipefail

dry_run=false
without_mysql=false
for flag in "$@"; do
  case "$flag" in
    --dry-run) dry_run=true ;;
    --without-mysql) without_mysql=true ;;
    *) echo 'Usage: install-deps.sh [--dry-run] [--without-mysql]' >&2; exit 2 ;;
  esac
done

declare -A packages=()
add_package() { packages["$1"]=1; }

programs=(node npm curl ffmpeg ffprobe tmux Xvfb xdpyinfo openbox x11vnc websockify pulseaudio pactl parec)
if [[ "$without_mysql" == false ]]; then programs+=(mariadb-admin); fi
for program in "${programs[@]}"; do
  if command -v "$program" >/dev/null 2>&1; then continue; fi
  case "$program" in
    node) add_package nodejs ;;
    npm) add_package npm ;;
    ffmpeg|ffprobe) add_package ffmpeg ;;
    Xvfb) add_package xvfb ;;
    xdpyinfo) add_package x11-utils ;;
    mariadb-admin) add_package mariadb-client ;;
    pactl|parec) add_package pulseaudio-utils ;;
    *) add_package "$program" ;;
  esac
done

# MariaDB server and noVNC assets are required even when client commands exist.
if [[ "$without_mysql" == false ]] && ! command -v mariadbd >/dev/null 2>&1 && ! command -v mysqld >/dev/null 2>&1; then
  add_package mariadb-server
fi
if [[ ! -f /usr/share/novnc/vnc.html ]]; then add_package novnc; fi

if ! command -v chromium >/dev/null 2>&1 &&
   ! command -v google-chrome >/dev/null 2>&1 &&
   ! command -v chromium-browser >/dev/null 2>&1; then
  add_package chromium
fi

if (( ${#packages[@]} == 0 )); then
  echo 'All required system packages are already available.'
  exit 0
fi

mapfile -t missing < <(printf '%s\n' "${!packages[@]}" | LC_ALL=C sort)
printf 'Missing system packages: %s\n' "${missing[*]}"
if [[ "$dry_run" == true ]]; then
  echo 'Dry run: nothing was installed.'
  exit 0
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo 'ERROR: Automatic installation requires Debian/Ubuntu apt-get.' >&2
  exit 1
fi
run_as_root() {
  if (( EUID == 0 )); then "$@"; else sudo -n "$@"; fi
}
if (( EUID != 0 )); then
  if ! command -v sudo >/dev/null 2>&1 || ! sudo -n true >/dev/null 2>&1; then
    echo 'ERROR: Automatic installation needs passwordless sudo in Codespaces.' >&2
    exit 1
  fi
fi

echo 'Updating apt package index (only because dependencies are missing)...'
run_as_root apt-get update || { echo 'ERROR: apt update failed; check the Codespace network/apt mirrors.' >&2; exit 1; }
echo 'Installing missing packages...'
run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}" || {
  echo 'ERROR: Could not install all dependencies. Check apt output above and retry.' >&2
  exit 1
}
echo 'Missing dependency installation completed.'
