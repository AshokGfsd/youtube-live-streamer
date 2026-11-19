#!/usr/bin/env bash
# One command to start the entire StreamForge Codespaces environment.
# Database -> Audio -> X11 -> VNC/noVNC -> Chrome -> API.
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$project_dir/scripts/codespaces/start-all.sh" "$@"
