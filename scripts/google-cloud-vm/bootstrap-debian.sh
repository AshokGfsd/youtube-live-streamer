#!/usr/bin/env bash
# Install runtime packages on a Debian 12/13 Google Compute Engine VM.
# This script does not provision a VM, enable billing, open ports, or create credentials.
set -euo pipefail

if [[ "$(id -u)" -eq 0 ]]; then
  echo 'Run this script as the normal VM SSH user (it uses sudo where needed).' >&2
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo 'This bootstrap supports Debian/Ubuntu apt hosts only.' >&2
  exit 1
fi

sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates curl gnupg git ffmpeg mariadb-server \
  xvfb x11-utils x11vnc novnc websockify openbox chromium tmux

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 22 ]]; then
  echo
  echo 'Node.js 22+ is required. Install a current LTS release using the official' >&2
  echo 'Node.js download or package instructions, then rerun this bootstrap.' >&2
  echo 'https://nodejs.org/en/download' >&2
  exit 1
fi

sudo systemctl enable --now mariadb

echo 'Runtime packages are ready. Next: configure MariaDB and StreamForge .env.'
echo 'Do not expose ports 4000, 5900, 6080, or 9222 in the VM firewall.'
