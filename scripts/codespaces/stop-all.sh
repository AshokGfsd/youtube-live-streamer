#!/usr/bin/env bash
# Stop ALL StreamForge services in this Codespace, including MariaDB.
# Run: bash stop-all.sh                 (full shutdown)
#      bash stop-all.sh --keep-db       (leave shared MariaDB running)
# No databases, Chrome logins, .env, uploads or stream keys are deleted.
set -euo pipefail

keep_db=false
case "${1:-}" in
  '') ;;
  --keep-db) keep_db=true ;;
  *) echo 'Usage: bash stop-all.sh [--keep-db]' >&2; exit 2 ;;
esac

# STEP 1: Stop active YouTube/Instagram broadcasts through the app first.
# This also clears the saved auto-reconnect flag, so streams do not
# unexpectedly restart on the next launch. Only loopback APIs are contacted.
echo '[1/4] Stopping any active livestreams gracefully...'
if command -v node >/dev/null 2>&1; then
  node --input-type=module -e '
    const base = "http://127.0.0.1:4000";
    const request = async (path, method = "GET") => {
      const response = await fetch(base + path, {
        method, signal: AbortSignal.timeout(3500),
        ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: "{}" } : {}),
      });
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      return response.json();
    };
    try {
      const instagram = await request("/api/instagram-live/status");
      if (instagram.activeChannelId) {
        try {
          await request(`/api/instagram-live/${encodeURIComponent(instagram.activeChannelId)}/stop`, "POST");
          console.log("Stopped Instagram Reels livestream.");
        } catch (error) { console.log("Instagram stop warning:", error.message); }
      }
      const channels = await request("/api/channels");
      for (const channel of channels.channels || []) {
        if (channel.stream?.desiredRunning || channel.stream?.phase === "reconnecting") {
          try {
            await request(`/api/channels/${encodeURIComponent(channel.id)}/stop`, "POST");
            console.log("Stopped YouTube channel:", channel.displayName || channel.handle || channel.id);
          } catch (error) { console.log("Channel stop warning:", error.message); }
        }
      }
      try { await request("/api/stop", "POST"); }
      catch (error) { console.log("Legacy stream stop warning:", error.message); }
    } catch (error) {
      console.log("API stop skipped or incomplete:", error.message);
      console.log("Next: terminating only StreamForge tmux services.");
    }
  ' || true
fi

# STEP 2: Stop only StreamForge-owned tmux sessions (never tmux kill-server).
# Node SIGINT handlers terminate FFmpeg, its audio reader and their retries.
echo '[2/4] Stopping API, Chrome, noVNC, VNC, Openbox and Xvfb...'
sessions=(sf-cloud-api sf-cloud-browser sf-cloud-web-vnc sf-cloud-vnc sf-cloud-window-manager sf-cloud-display)
if command -v tmux >/dev/null 2>&1; then
  for name in "${sessions[@]}"; do
    if tmux has-session -t "$name" 2>/dev/null; then
      tmux send-keys -t "$name" C-c 2>/dev/null || true
    fi
  done
  sleep 2
  for name in "${sessions[@]}"; do
    if tmux has-session -t "$name" 2>/dev/null; then
      tmux kill-session -t "$name"
    fi
    echo "Stopped: $name"
  done
fi

# STEP 3: Stop the user-level PulseAudio daemon used by the virtual sink.
# Other apps in this Codespace using this users PulseAudio will lose audio.
echo '[3/4] Stopping PulseAudio virtual sound...'
if command -v pulseaudio >/dev/null 2>&1; then
  pulseaudio --kill >/dev/null 2>&1 || true
fi
echo 'PulseAudio stopped (or was already offline).'

# STEP 4: Stop MariaDB after the API has disconnected; never remove its files.
echo '[4/4] Stopping the MariaDB service...'
if [[ -f "$HOME/StreamForge-GCloud/.env" ]] && grep -Eq '^CHANNEL_STORAGE=file[[:space:]]*$' "$HOME/StreamForge-GCloud/.env"; then
  echo 'Skipped: file channel storage does not use MariaDB.'
elif [[ "$keep_db" == true ]]; then
  echo 'MariaDB kept running (--keep-db).'
elif command -v service >/dev/null 2>&1; then
  if sudo service mariadb stop; then
    echo 'MariaDB stopped; all databases remain on disk.'
  else
    echo 'WARNING: Unable to stop MariaDB; check: sudo service mariadb status' >&2
    exit 1
  fi
else
  echo 'WARNING: service command unavailable; stop MariaDB manually.' >&2
  exit 1
fi

echo
echo 'StreamForge services stopped. Your files, MySQL data and Instagram login remain saved.'
echo 'Restart everything with: bash start-all.sh'
echo 'If YouTube Studio still shows the broadcast as live, end it there separately.'
