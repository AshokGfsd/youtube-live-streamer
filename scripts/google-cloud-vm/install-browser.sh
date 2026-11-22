#!/usr/bin/env bash
# Install Google's official Chrome for Testing to the user's home (no Snap).
# Useful for Ubuntu Cloud Shell test sessions; a persistent VM is still required
# for continuous streaming.
# Codespaces may opt in to system library installation with
# STREAMFORGE_INSTALL_SYSTEM_CHROME_DEPS=true (requires passwordless sudo).
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_dir/scripts/google-cloud-vm/browser.sh"

for program in curl unzip node; do
  if ! command -v "$program" >/dev/null 2>&1; then
    echo "Missing $program; install it before downloading Chrome for Testing." >&2
    exit 1
  fi
done

case "$(uname -m)" in
  x86_64|amd64) platform=linux64 ;;
  aarch64|arm64) platform=linux-arm64 ;;
  *) echo 'Chrome for Testing is not available for this architecture.' >&2; exit 1 ;;
esac

browser_root="$HOME/.local/share/streamforge-browser"
mkdir -p "$browser_root"
temp_dir="$(mktemp -d)"
trap 'rm -rf -- "$temp_dir"' EXIT

manifest='https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json'
curl --fail --location --silent --show-error --retry 3 --max-time 60 "$manifest" -o "$temp_dir/versions.json"

read -r version download_url < <(node - "$temp_dir/versions.json" "$platform" <<'NODE'
const fs = require('node:fs');
const [file, platform] = process.argv.slice(2);
const stable = JSON.parse(fs.readFileSync(file, 'utf8')).channels.Stable;
const asset = stable.downloads.chrome.find((entry) => entry.platform === platform);
if (!asset || !/^https:\/\/storage\.googleapis\.com\/chrome-for-testing-public\//.test(asset.url)) {
  throw new Error(`No official Chrome for Testing download for ${platform}`);
}
process.stdout.write(`${stable.version} ${asset.url}\n`);
NODE
)

if [[ ! "$version" =~ ^[0-9]+(\.[0-9]+){3}$ || "$download_url" != https://storage.googleapis.com/chrome-for-testing-public/* ]]; then
  echo 'Chrome for Testing manifest returned an invalid download.' >&2
  exit 1
fi

target_dir="$browser_root/$version"
if [[ ! -x "$target_dir/chrome-$platform/chrome" ]]; then
  echo "Downloading Chrome for Testing $version ($platform)..."
  curl --fail --location --silent --show-error --retry 3 "$download_url" -o "$temp_dir/chrome.zip"
  unzip -q "$temp_dir/chrome.zip" -d "$temp_dir"
  if [[ ! -x "$temp_dir/chrome-$platform/chrome" ]]; then
    echo 'The downloaded archive did not contain an executable Chrome browser.' >&2
    exit 1
  fi
  mkdir -p "$target_dir"
  mv "$temp_dir/chrome-$platform" "$target_dir/"
fi

ln -sfnT "$version/chrome-$platform/chrome" "$browser_root/current"

browser_path="$browser_root/current"
browser_error=''
if ! browser_version="$("$browser_path" --version 2>&1)"; then
  browser_error="$browser_version"
fi

if [[ -n "$browser_error" ]] && [[ "${STREAMFORGE_INSTALL_SYSTEM_CHROME_DEPS:-false}" == true ]]; then
  # Chrome for Testing ships its official Debian package dependencies in
  # chrome-linux64/deb.deps. Do not guess Ubuntu's renamed library packages.
  # Install them only when ldd confirms a missing shared library.
  missing_libraries=''
  if command -v ldd >/dev/null 2>&1; then
    missing_libraries="$(ldd "$browser_path" 2>&1 | grep 'not found' || true)"
  fi
  if [[ -n "$missing_libraries" ]]; then
    deps_file="$target_dir/chrome-$platform/deb.deps"
    if [[ ! -s "$deps_file" ]]; then
      echo 'Chrome has missing shared libraries but its official deb.deps file is unavailable.' >&2
      printf '%s\n' "$missing_libraries" >&2
      exit 1
    fi
    if ! command -v apt-get >/dev/null 2>&1; then
      echo 'Chrome dependencies require apt-get on Debian/Ubuntu.' >&2
      exit 1
    fi
    run_as_root() {
      if (( EUID == 0 )); then "$@"; else sudo -n "$@"; fi
    }
    if (( EUID != 0 )) &&
       { ! command -v sudo >/dev/null 2>&1 || ! sudo -n true >/dev/null 2>&1; }; then
      echo 'Missing Chrome shared libraries require passwordless sudo in Codespaces.' >&2
      printf '%s\n' "$missing_libraries" >&2
      exit 1
    fi
    echo 'Installing Chrome for Testing system dependencies using its official deb.deps list...'
    run_as_root apt-get update
    while IFS= read -r requirement || [[ -n "$requirement" ]]; do
      [[ -n "$requirement" && "$requirement" != \#* ]] || continue
      run_as_root apt-get satisfy -y --no-install-recommends "$requirement"
    done < "$deps_file"
  fi
fi

if ! browser_version="$("$browser_path" --version 2>&1)" ||
   [[ "$browser_version" != *Chrome* && "$browser_version" != *Chromium* ]]; then
  echo 'Chrome was downloaded but could not run. Browser error:' >&2
  printf '%s\n' "$browser_version" >&2
  if command -v ldd >/dev/null 2>&1; then
    echo 'Missing shared libraries (if any):' >&2
    ldd "$browser_path" 2>&1 | grep 'not found' >&2 || true
  fi
  exit 1
fi

echo "READY: $browser_version"
echo "Browser path: $browser_path"
echo 'Cloud Shell sessions expire; for persistent livestreaming, use a Compute Engine VM.'
