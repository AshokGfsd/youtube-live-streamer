#!/usr/bin/env bash
# Source this file to find a real Chrome/Chromium browser, not an Ubuntu snap stub.

streamforge_browser_path() {
  local candidate version
  local -a candidates=()

  if [[ -n "${STREAMFORGE_BROWSER_BIN:-}" ]]; then
    candidates+=("$STREAMFORGE_BROWSER_BIN")
  else
    candidates+=("$HOME/.local/share/streamforge-browser/current")
    local name
    for name in chromium google-chrome-stable google-chrome chromium-browser; do
      candidate="$(command -v "$name" 2>/dev/null || true)"
      if [[ -n "$candidate" ]]; then candidates+=("$candidate"); fi
    done
  fi

  for candidate in "${candidates[@]}"; do
    if [[ ! -x "$candidate" ]]; then continue; fi
    version="$("$candidate" --version 2>/dev/null)" || continue
    if [[ "$version" == *Chrome* || "$version" == *Chromium* || "$version" == *"Microsoft Edge"* ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}
