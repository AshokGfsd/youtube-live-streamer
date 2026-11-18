# StreamForge — Your YouTube cloud livestream studio

## Android phone (no credit card / cloud VM required)

### Fast setup with Git (recommended for Termux)

The GitHub repository includes the **prebuilt Android dashboard**. Run these once in Termux:

```bash
pkg install git nodejs ffmpeg tmux -y
cd "$HOME"
git clone https://github.com/AshokGfsd/youtube-live-streamer.git
cd youtube-live-streamer
bash start-android.sh
```

On first launch, edit `~/StreamForge-Android/.env` to set your private `YOUTUBE_STREAM_KEY`, then run `bash start-android.sh` again. Open `http://127.0.0.1:4000` on the same phone. No dashboard login token is required.

**For future updates:**

```bash
cd ~/youtube-live-streamer
git pull
bash start-android.sh
```

This refreshes the app, restarts its Termux background session, and preserves `~/StreamForge-Android/.env` and `~/StreamForge-Android/data/`. Stop any active YouTube broadcast before updating because the server restart interrupts the stream.

You can also run the **Node.js + FFmpeg backend on an Android phone in Termux**, with the Next.js dashboard precompiled on a computer or in GitHub Actions. See [Android instructions](deploy/termux/README-ANDROID.md). Run `npm run build:android` on a Node-capable desktop/CI machine to create an Android-ready folder under `dist/android/StreamForge-Android`. The user does not have to build Next.js on Android.

The Android setup serves the dashboard at `http://127.0.0.1:4000` on the same phone, so no public server or HTTPS tunnel is required. **The phone stays on** and Android may stop background tasks; this is not unattended cloud hosting with an uptime guarantee.

**Android personal mode:** The prebuilt Termux bundle starts with `LOCAL_ONLY_MODE=true`, serves the app only on `127.0.0.1`, and automatically opens the dashboard without a token/login popup. Never expose this phone-only endpoint to the public internet or a network tunnel. Cloud deployments still require `DASHBOARD_TOKEN` and their normal CSP.

**New YouTube automation (Android):** Optionally connect your channel through Google OAuth to create new live events with title, description, privacy and thumbnail, then send your uploaded video with the same reusable stream key. Channel description and banner updates are also available. This requires a Google Cloud Web application OAuth client and API authorization; see [Android YouTube OAuth setup](deploy/termux/README-ANDROID.md#optional-automate-youtube-titles-thumbnails-and-channel-branding). The original manual stream-key mode still works without OAuth.

Upload one video from a Next.js dashboard, then use a self-hosted Node.js + FFmpeg encoder to send it to YouTube Live. The actual stream runs on an Oracle Cloud VM and **continues when your browser and PC are off**.

> This is a personal, single-owner streaming tool. It uses a YouTube Studio stream key, not Google OAuth. One-time setup in YouTube Studio is required. Clicking **Start streaming** starts RTMPS ingestion; the YouTube broadcast goes live automatically only if **Auto-start** is enabled in YouTube Studio.

## Stack

| Component | Stack | Recommended deployment |
| --- | --- | --- |
| Dashboard | Next.js 16, React 19, TypeScript | Vercel Hobby |
| Streaming API | Node.js 22, Express | Oracle Cloud Always Free VM |
| Video encoder | FFmpeg / ffprobe | Same VM, in Docker |
| HTTPS | Caddy / Let's Encrypt | Same VM, in Docker |
| Stored video | Docker named volume | On the VM, no separate paid object storage |

## Features

- Upload a local MP4, MOV, MKV, M4V or WebM with progress display and `ffprobe` validation.
- Keep only the most recently uploaded video (the previous file is removed after replacement).
- Start/stop streaming with optional infinite video looping.
- Transcode to 1280×720, H.264 video + AAC audio; supply silent audio if the original has no audio.
- Retry interrupted FFmpeg streams and resume intended streams when the API restarts.
- Live encoder status and redacted log messages (never disclose the stream key to the dashboard).
- Protect cloud control endpoints with an owner access token; browser uses HTTPS to the VM. Local-only Android mode uses loopback isolation instead of a token.

**What this version does not do:** create YouTube broadcasts automatically, show real viewer metrics, schedule broadcasts, or stream without enabling YouTube Live in Studio. API status **Sending to YouTube** means FFmpeg is running; check YouTube Studio to confirm the actual broadcast is public/live.

## 1. Enable YouTube Live and get your stream key

1. Open [YouTube Studio](https://studio.youtube.com/) → **Create → Go live → Stream**. Complete channel verification/live activation if prompted (first-time activation can take time).
2. Create a stream with your preferred title, audience, privacy and other settings.
3. Enable **Auto-start** if you want video transmission to start the broadcast automatically. Use a persistent/reusable key if desired.
4. Copy the **Stream key**. Keep it secret. Put it **only** in `apps/api/.env` on the VM. Never put it in the frontend, GitHub, Vercel or browser local storage.

Your content must be content you own or have permission to rebroadcast.

## 2. Deploy the streaming server to Oracle VM

1. Create an Oracle Cloud account and provision an **Always Free Ampere A1 VM**, where available (e.g., 2 OCPUs and 12 GB RAM). Use Ubuntu 24.04 ARM64. VM availability is not guaranteed, and free-tier policies can change.
2. Reserve/record its public IP. Point a domain or free DDNS hostname (e.g. `stream.example.com`) to the IP. Caddy needs working DNS and publicly reachable ports 80 and 443 to issue an HTTPS certificate.
3. In Oracle VCN security list / NSG and on the VM firewall, allow **inbound TCP ports 80 and 443 only**. Leave port 4000 private (the Docker API does not publish it).
4. Install Docker Engine + Docker Compose plugin following the [official Ubuntu installation guide](https://docs.docker.com/engine/install/ubuntu/).
5. Clone this repository and configure the environment:

```bash
git clone https://github.com/AshokGfsd/youtube-live-streamer.git
cd youtube-live-streamer
cp .env.example .env
cp apps/api/.env.example apps/api/.env
openssl rand -hex 32
```

Edit root `.env`: set `API_DOMAIN` to the DNS hostname pointing at the VM. Edit `apps/api/.env`:

```dotenv
NODE_ENV=production
PORT=4000
DASHBOARD_TOKEN=THE_LONG_RANDOM_VALUE_FROM_OPENSSL
YOUTUBE_STREAM_KEY=YOUR_REAL_YOUTUBE_STUDIO_STREAM_KEY
YOUTUBE_RTMPS_URL=rtmps://a.rtmps.youtube.com/live2
FRONTEND_ORIGIN=https://YOUR-VERCEL-APP.vercel.app
MAX_UPLOAD_GB=4
DATA_DIR=/data
```

Use an **exact origin** for `FRONTEND_ORIGIN`, without a trailing slash. Separate multiple trusted origins with commas. The API rejects requests from other browser origins. Do not commit `.env` files.

Start the cloud worker (Docker restart policy keeps it running and restarts on host reboot):

```bash
docker compose up -d --build
docker compose logs -f --tail=50 api caddy
```

Check the public HTTPS API before deploying the frontend:

```bash
curl https://YOUR-API-DOMAIN/health
# Expected: {"ok":true,"service":"streamforge-api"}
```

The video persists in the `stream_data` Docker volume. Do not run `docker compose down -v` unless you intend to erase the upload and stream state. Protect the VM and do not publish port 4000 directly.

## 3. Deploy the dashboard to Vercel

1. Import this GitHub repository into [Vercel](https://vercel.com/new).
2. Set **Root Directory** to `apps/web`, framework **Next.js**.
3. Set environment variable `NEXT_PUBLIC_API_BASE_URL=https://YOUR-API-DOMAIN` (no trailing slash).
4. Deploy and copy the Vercel URL. Add that exact origin to `FRONTEND_ORIGIN` in your API `.env`, then `docker compose up -d` to restart the API if changed.
5. Open the dashboard. Enter the cloud API HTTPS URL and your `DASHBOARD_TOKEN` from the VM. The dashboard remembers the API URL in browser local storage and keeps the access token only in session storage.

**Important:** Vercel does not run FFmpeg. The Oracle VM does the long-running work. You do not need to leave your Vercel page open once uploading is complete and you have started streaming.

## 4. Use the app

1. In YouTube Studio, ensure your live event is configured with Auto-start, if using automatic broadcasting.
2. Upload one video in StreamForge and wait for the server to confirm it.
3. Decide whether it should repeat forever, then click **Start streaming**.
4. Check YouTube Studio to confirm the live event is active. You can close the browser.
5. Return later and press **Stop streaming**. You may replace the video while stopped.

## Local development

Requirements: Node.js 22+, FFmpeg and ffprobe on your PATH.

```bash
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
# Set a long DASHBOARD_TOKEN and optional stream key in apps/api/.env.
npm run dev:api
# In another terminal:
npm run dev:web
```

Frontend: `http://localhost:3000`; backend: `http://localhost:4000`. You can run `npm test` and `npm run build` at repository root. YouTube streaming needs a real stream key and network access; **do not use a production key while developing on an untrusted machine**.

## API routes (all except health require owner token)

Send header `Authorization: Bearer <DASHBOARD_TOKEN>`:

| Method | Endpoint | Action |
| --- | --- | --- |
| GET | `/health` | Public liveness check |
| GET | `/api/status` | Video, stream phase, uptime and sanitized logs |
| POST | `/api/upload` | Multipart field `video` |
| POST | `/api/start` | JSON `{ "loop": true }` |
| POST | `/api/stop` | Stop the FFmpeg process |

### Security and streaming notes

- This is **single-owner authentication**, not a multi-tenant app. Share the access token with nobody. Rotate it if exposed.
- Browser requests to the dashboard are HTTPS-only for remote hosts; CORS is restricted to trusted origins. CORS is not authentication; the owner token is required regardless of origin.
- Streaming is 720p/30 FPS at approximately 2.5 Mbps + audio. On low-powered free VMs FFmpeg transcoding may consume significant CPU. Reduce bitrate/resolution or preprocess the file if necessary.
- Uploads use the VM's disk, so a 4 GB file needs adequate free storage and network transfer time. The default limit is configurable in `MAX_UPLOAD_GB`.
- An interrupted FFmpeg process is retried every eight seconds. If the API service restarts, its persisted desired state triggers another streaming attempt.
- YouTube can end broadcasts or reject ingestion for reasons outside this app; always confirm your actual live state in YouTube Studio.
- Oracle's Always Free instances can be unavailable or reclaimed under its published policies; this is **not** an uptime SLA.
- Do not use third-party copyrighted material without appropriate streaming rights.
