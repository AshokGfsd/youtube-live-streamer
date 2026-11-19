#!/data/data/com.termux/files/usr/bin/bash
# Run after choosing a portrait resolution in the Termux:X11 app.
# Never stops a running browser or changes existing Instagram login data.
set -euo pipefail

if ! command -v chromium-browser >/dev/null 2>&1; then
  echo 'Chromium missing. Run: pkg install x11-repo chromium -y' >&2
  exit 1
fi
if curl --silent --fail --max-time 2 http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  echo 'Chromium already runs on port 9222. Close every Chromium window first.' >&2
  echo 'Launching again would reuse desktop-mode settings.' >&2
  exit 1
fi

export DISPLAY="${INSTAGRAM_DISPLAY:-:1}"
echo "Launching portrait kiosk on X11 ${DISPLAY}."
echo 'Set Termux:X11 display to 540 x 960 (portrait) in the Android companion app.'

chromium-browser \
  --user-data-dir="$HOME/.streamforge-reels-browser" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --window-position=0,0 \
  --window-size=540,960 \
  --no-first-run \
  --no-default-browser-check \
  --kiosk \
  --app='https://www.instagram.com/reels/' &

echo 'Chromium launched. Open Termux:X11 and play one Reel before starting live.'
