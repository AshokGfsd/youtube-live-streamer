# StreamForge on Windows (10 / 11)

StreamForge is fully optimized for Windows with a one-command native launcher, encrypted local file storage (no MySQL required), and native hardware-accelerated video broadcasting via FFmpeg.

---

## ⚡ Quick Start (1-Minute Setup)

### 1. Prerequisites

Ensure you have **Node.js 22+** and **FFmpeg** installed. If not, open PowerShell as Administrator and run:

```powershell
# Install Node.js LTS and FFmpeg via Windows Package Manager
winget install OpenJS.NodeJS.LTS
winget install Gyan.FFmpeg
```

*(You can also run `npm run deps:windows` to verify your environment).*

---

### 2. Launch StreamForge

You can start StreamForge using any of the following:

- **Double-click:** `start-windows.bat`
- **PowerShell:** `.\start-windows.ps1`
- **NPM:** `npm run start:windows`

On the first launch:
1. It automatically copies `deploy/windows/.env.example` to `apps/api/.env`.
2. Uses encrypted local file storage (`CHANNEL_STORAGE=file`), so no MySQL or Docker is needed.
3. Serves the prebuilt dashboard at **`http://127.0.0.1:4000`** in personal loopback mode (no token needed).
4. Automatically opens your default web browser to the dashboard.

---

## 🛑 Stopping StreamForge

To stop the background server and release port 4000:
- **Double-click:** `stop-windows.bat`
- **PowerShell:** `.\stop-windows.ps1`
- **NPM:** `npm run stop:windows`

---

## 🎬 Streaming Modes on Windows

### 1. Direct Video / Multi-Channel Studio
- Visit **`http://127.0.0.1:4000/channels`**.
- Create channel profiles, configure your YouTube Live Stream Key, upload MP4/MOV/WebM videos, and stream in 720p or 1080p.
- Stream keys and sensitive credentials are encrypted using AES-256-GCM in `data/channels.json`.

### 2. Direct MP4 Playlist Mode (Instagram Reels)
- Stream Instagram Reels directly from high-speed Meta CDN URLs with zero browser capture overhead.
- Perfect for low CPU and GPU usage on Windows.

### 3. Native Windows Browser Reels Mode (GDI Capture)
- Launch Chrome in portrait debugging mode:
  ```powershell
  npm run launch:reels:windows
  ```
  *(or double-click `scripts\windows\launch-chrome-reels.bat`)*
- On Windows, StreamForge automatically captures using FFmpeg's native **`gdigrab`** desktop grabber (`-f gdigrab`).
- Audio: Use **silent audio** (`audio: silent`) or Direct MP4 mode.

---

## ⚙️ Configuration (`apps/api/.env`)

| Variable | Recommended Windows Value | Description |
| :--- | :--- | :--- |
| `PORT` | `4000` | Local port for API & static UI |
| `LISTEN_HOST` | `127.0.0.1` | Loopback address |
| `LOCAL_ONLY_MODE` | `true` | Allows direct access without authentication token |
| `CHANNEL_STORAGE` | `file` | AES-256-GCM encrypted disk file (`channels.json`) |
| `MULTI_CHANNEL_ENABLED` | `true` | Enable managing multiple YouTube channels |
| `WEB_STATIC_DIR` | `../../deploy/termux/public` | Path to precompiled Next.js dashboard |
| `STREAM_WIDTH` / `HEIGHT` | `1280` / `720` | Broadcast resolution |
| `STREAM_FPS` | `30` | Stream frame rate |
| `STREAM_BITRATE_KBPS` | `2500` | Video bitrate |
| `STREAM_PRESET` | `veryfast` or `faster` | H.264 CPU encoding speed |
