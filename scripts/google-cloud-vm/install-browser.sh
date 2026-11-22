#!/usr/bin/env bash
# Install Google's official Chrome for Testing to the user's home (no snap/root).
# Useful for Ubuntu Cloud Shell test sessions; a persistent VM is still required
# for continuous streaming.
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
if ! streamforge_browser_path >/dev/null; then
  echo 'Chrome was downloaded, but cannot execute. Check for missing system libraries.' >&2
  exit 1
fi

echo "READY: $("$browser_root/current" --version)"
echo "Browser path: $browser_root/current"
echo 'Cloud Shell sessions expire; for persistent livestreaming, use a Compute Engine VM.'
