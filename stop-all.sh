#!/usr/bin/env bash
# One command to stop every StreamForge service, including MariaDB.
# Does NOT delete any project data, browser sessions or keys.
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$project_dir/scripts/codespaces/stop-all.sh" "$@"
