#!/usr/bin/env bash
# Install only the system packages missing from this GitHub Codespace.
# Uses Ubuntu/Debian apt and the existing passwordless sudo permission.
# Never touches .env, stream keys, browser profiles, uploads, or MySQL data.
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_dir/scripts/google-cloud-vm/browser.sh"

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

programs=(node npm curl unzip ffmpeg ffprobe tmux Xvfb xdpyinfo openbox x11vnc websockify pulseaudio pactl parec)
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

# Ubuntu's chromium-browser package can be an unusable Snap launcher. Checking
# only command -v mistakenly treats it as a working browser.
needs_standalone_browser=false
if ! streamforge_browser_path >/dev/null; then
  needs_standalone_browser=true
fi

if (( ${#packages[@]} == 0 )) && [[ "$needs_standalone_browser" == false ]]; then
  echo 'All required system packages are already available.'
  exit 0
fi

if (( ${#packages[@]} > 0 )); then
  mapfile -t missing < <(printf '%s\n' "${!packages[@]}" | LC_ALL=C sort)
  printf 'Missing system packages: %s\n' "${missing[*]}"
fi
if [[ "$needs_standalone_browser" == true ]]; then
  echo 'Missing a working Chrome/Chromium browser; Snap launcher does not count.'
fi
if [[ "$dry_run" == true ]]; then
  if [[ "$needs_standalone_browser" == true ]]; then
    echo 'Dry run: would install official standalone Chrome for Testing in the user home directory.'
  fi
  echo 'Dry run: nothing was installed.'
  exit 0
fi

if (( ${#packages[@]} > 0 )); then
  if ! command -v apt-get >/dev/null 2>&1; then
    echo 'ERROR: Automatic system installation requires Debian/Ubuntu apt-get.' >&2
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
  echo 'Missing system dependency installation completed.'
fi

if [[ "$needs_standalone_browser" == true ]]; then
  echo 'Installing official Chrome for Testing without Snap or root...'
  bash "$repo_dir/scripts/google-cloud-vm/install-browser.sh" || {
    echo 'ERROR: Chrome for Testing could not be installed. Check download access and shared libraries.' >&2
    exit 1
  }
  streamforge_browser_path >/dev/null || {
    echo 'ERROR: No runnable Chrome binary found after installation.' >&2
    exit 1
  }
fi
