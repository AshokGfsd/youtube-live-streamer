#!/usr/bin/env bash
# Stop only the VM sessions belonging to the Google Cloud StreamForge experiment.
set -euo pipefail

for name in sf-cloud-api sf-cloud-browser sf-cloud-web-vnc sf-cloud-vnc sf-cloud-window-manager sf-cloud-display; do
  if tmux has-session -t "$name" 2>/dev/null; then
    tmux kill-session -t "$name"
    echo "Stopped: $name"
  fi
done

echo 'VM still exists: stop or delete it separately in Google Cloud Console to avoid continued billing.'
