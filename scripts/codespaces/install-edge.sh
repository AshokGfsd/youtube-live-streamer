#!/usr/bin/env bash
set -euo pipefail
if command -v microsoft-edge-stable >/dev/null && microsoft-edge-stable --version; then exit 0; fi
[[ "$(dpkg --print-architecture)" == amd64 ]] || { echo 'Microsoft Edge Linux requires amd64.' >&2; exit 1; }
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor | sudo tee /etc/apt/keyrings/streamforge-microsoft.gpg >/dev/null
sudo chmod 0644 /etc/apt/keyrings/streamforge-microsoft.gpg
echo 'deb [arch=amd64 signed-by=/etc/apt/keyrings/streamforge-microsoft.gpg] https://packages.microsoft.com/repos/edge stable main' | sudo tee /etc/apt/sources.list.d/microsoft-edge-stable.list >/dev/null
sudo apt-get update
sudo apt-get install -y microsoft-edge-stable
microsoft-edge-stable --version
