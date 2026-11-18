# StreamForge for Android — no card, no VPS

> **Instagram Reels screen-capture preview:** on branch
> `feature/instagram-auto-scroll-live`, see
> `docs/instagram-reels-android-prototype.md` in your Git checkout and open
> `http://127.0.0.1:4000/instagram-live` after installing the branch via
> `bash start-android.sh`. This is experimental Android/X11 functionality.

This ZIP contains the **prebuilt Next.js dashboard** and the **Node.js + FFmpeg backend**. You don't need Docker, Oracle Cloud or a Next.js compiler on your Android phone.

**Your phone becomes the server.** You can close Chrome and switch apps while streaming, but **the phone must stay switched on, connected to the internet, and allowed to run Termux in the background**. Android can still kill background or CPU-intensive processes. This is not guaranteed 24/7 cloud hosting.

## Git clone instead of ZIP (recommended for easy updates)

The repository now includes prebuilt Android frontend files, so you don't need to compile Next.js on your phone:

```bash
pkg install git nodejs ffmpeg tmux -y
cd "$HOME"
git clone https://github.com/AshokGfsd/youtube-live-streamer.git
cd youtube-live-streamer
bash start-android.sh
```

On the first run, set `YOUTUBE_STREAM_KEY` in `nano ~/StreamForge-Android/.env`, then run `bash start-android.sh` again. Open `http://127.0.0.1:4000`. For subsequent updates:

```bash
cd ~/youtube-live-streamer
git pull
bash start-android.sh
```

It preserves `.env` and `data/` in `~/StreamForge-Android`. Stop an active broadcast before updating: the start script restarts the Termux server. **Never expose port 4000 publicly** while in password-free local mode.

## NEW: MySQL multi-channel setup (Android / Termux)

The **My Channels** page (`http://127.0.0.1:4000/channels`) stores separate YouTube
profiles, branding, stream destinations, default titles and privacy settings in
MySQL-compatible MariaDB. Channel stream keys and Google refresh tokens are
encrypted using AES-256-GCM **before** they are written to MySQL. The classic
single-stream dashboard continues working without a database.

> This step has to be performed **on your phone**. A remote GitHub push cannot
> install MariaDB or write your private database password on the device.

1. Install MariaDB and OpenSSL command-line tools:

   ```bash
   pkg update
   pkg install mariadb openssl-tool -y
   ```

2. Initialize MariaDB **only if** the installer has not already initialized it:

   ```bash
   mariadb-install-db --datadir="$PREFIX/var/lib/mysql" --auth-root-authentication-method=normal
   ```

   An "already exists" message means you can skip this step. Start the server
   for initial database setup:

   ```bash
   mariadbd-safe --datadir="$PREFIX/var/lib/mysql" --bind-address=127.0.0.1 &
   mariadb -u root
   ```

3. At the MariaDB prompt, create a private database and dedicated local user.
   Replace `CHOOSE_A_PRIVATE_PASSWORD` with your own strong password:

   ```sql
   CREATE DATABASE IF NOT EXISTS streamforge CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER IF NOT EXISTS 'streamforge'@'127.0.0.1' IDENTIFIED BY 'CHOOSE_A_PRIVATE_PASSWORD';
   GRANT ALL PRIVILEGES ON streamforge.* TO 'streamforge'@'127.0.0.1';
   FLUSH PRIVILEGES;
   EXIT;
   ```

4. On this **private Android-only app**, the encryption key is generated and
   saved automatically inside `DATA_DIR` when you configure MySQL. You do not
   need to set `CHANNEL_ENCRYPTION_KEY` or sign in to a dashboard.

   For an existing installation that already encrypted channel secrets, keep
   the original key! Do not delete the persistent key file or move the database
   without its associated key.

   Open the configuration:

   ```bash
   nano ~/StreamForge-Android/.env
   ```

   Add these fields to the **existing** `.env` and substitute your password and
   database password:

   ```dotenv
   MYSQL_HOST=127.0.0.1
   MYSQL_PORT=3306
   MYSQL_USER=streamforge
   MYSQL_PASSWORD=CHOOSE_A_PRIVATE_PASSWORD
   MYSQL_DATABASE=streamforge
   CHANNEL_ENCRYPTION_KEY=
   MAX_CONCURRENT_STREAMS=1
   ```

   **Do not paste secrets into GitHub or chat. Never delete your generated
   channel encryption key file: saved keys would become unreadable. Back up
   your private data directory securely.** The backend automatically creates its table on
   startup; no SQL migration tool is needed.

5. Pull and start the latest app:

   ```bash
   cd ~/youtube-live-streamer
   git pull
   bash start-android.sh
   ```

   `start.sh` now keeps MariaDB in a separate `streamforge-db` tmux session when
   configured; StreamForge itself uses the `streamforge` session. The session
   is only accessible from the phone by default.

6. Open **http://127.0.0.1:4000/channels**. Press **New channel** and complete:

   - **Identity:** channel name, handle and optional YouTube ID/URL.
   - **Branding:** description, keywords and category saved to MySQL.
   - **Connection:** that channel's reusable YouTube stream key, encrypted.
   - **Preferences:** privacy, default live title/description and looping.

   **Save & continue** writes the completed step immediately to MySQL. Closing
   the wizard keeps saved steps. **Continue setup** resumes the next unfinished
   step. Once ready, every channel has its own video, upload button and start/stop
   controls. You can connect **each** channel to Google separately (same Google
   OAuth client and redirect URL as the existing setup) to automate broadcasts.

**Phone performance:** `MAX_CONCURRENT_STREAMS=1` is deliberate. You can manage
many YouTube channels while running only one FFmpeg encoder at a time. Increase
this only on a device with sufficient CPU, memory, upload bandwidth and cooling.
The classic single-channel encoder also counts toward this limit for the new
channel controls. Starting a YouTube encoder does not guarantee YouTube has
actually published the event: confirm it in the Live Control Room.

**Privacy note:** Channel name/handle and branding settings are saved as a
workspace profile. They are not automatically edited on YouTube. Google OAuth
can create broadcasts for each channel; use YouTube Studio to change the actual
channel name and handle.

The ZIP method below is an alternative if you prefer not to use Git.

## Optional: automate YouTube titles, thumbnails and channel branding

StreamForge can create a YouTube broadcast, add its title/description/thumbnail,
set privacy, bind it to your **existing reusable stream key**, and start FFmpeg.
It can also update your channel description and banner. The first-time setup
needs Google OAuth because the stream key alone cannot edit channel settings.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create/select a project. Enable **YouTube Data API v3**.
2. Configure the **Google Auth Platform / OAuth consent screen**. For personal testing, use the testing audience and add your own YouTube Google account as a **test user**.
3. Go to **Clients → Create client → Web application** and add this exact **Authorized redirect URI**:

   `http://127.0.0.1:4000/api/youtube/oauth/callback`

4. In Termux, run `nano ~/StreamForge-Android/.env` and add the two values shown by Google Cloud:

   ```dotenv
   GOOGLE_CLIENT_ID=your-oauth-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-oauth-client-secret
   ```

   Keep your current `YOUTUBE_STREAM_KEY` in the same `.env`. **Do not send your stream key or OAuth secret in chat or commit either to GitHub.**

5. Restart the app:

   ```bash
   cd ~/youtube-live-streamer
   bash start-android.sh
   ```

6. Open `http://127.0.0.1:4000`, scroll to **YouTube Live Automation**, and press **Connect Google**. Approve access for your channel.
7. Upload a video; fill in the **Live title, description, privacy and optional thumbnail**; choose **Create & Start YouTube Live**. Confirm the broadcast in [YouTube Studio](https://studio.youtube.com/).

**Important limitations:** This release expects the stream key in `.env` to be a *reusable YouTube live stream* visible through the YouTube API. If StreamForge cannot find it, use a custom reusable key from YouTube Studio and update `.env`. The YouTube event is created on demand (no unattended scheduling yet). A supported JPG/PNG thumbnail is optional and capped at 6 MB here. For channel banners, use a 16:9 image at least 2048×1152 and at most 6 MB. Channel name/handle are not editable through this API.

OAuth refresh tokens are saved only in the private Termux `data/youtube-oauth.json` file (owner-only permissions); they are never exposed in the dashboard or committed. **Do not expose the phone's port 4000 through any public tunnel while password-free mode is enabled.** Google may require you to reauthorize periodically while your OAuth app is in Testing mode.

## Before starting

- Install Termux from [F-Droid](https://f-droid.org/en/packages/com.termux/), or from the official Termux GitHub project. Avoid mixing Termux and add-ons from different distributors.
- Open Termux and install the packages (you already installed Node and FFmpeg):

```bash
pkg update && pkg upgrade -y
pkg install nodejs-lts ffmpeg tmux unzip nano -y
termux-setup-storage
```

- In Android Settings → Apps → Termux → Battery, choose **Unrestricted** / **Don't optimize** if your device offers it. Turn off power-saving mode while streaming. Keep the phone plugged in and watch its temperature.
- Enable YouTube Live on your account. In YouTube Studio, create a stream and enable **Auto-start** if you want the broadcast to go live when the encoder starts. Keep your stream key secret.

## 1. Extract the Android ZIP

Download `StreamForge-Android.zip` with your phone browser. It should appear in **Downloads**. Then in Termux:

```bash
cd "$HOME"
unzip "$HOME/storage/downloads/StreamForge-Android.zip"
cd "$HOME/StreamForge-Android"
```

If `termux-setup-storage` shows a permissions request, allow file access. If the ZIP has a different filename, use that exact filename instead.

## 2. Install only the small Node backend dependencies

```bash
npm install --omit=dev
```

You do **not** run `next build` on Android. The web dashboard was already compiled and is included in `public/`.

## 3. Configure your YouTube stream key

```bash
cp .env.example .env
nano .env
```

Inside `.env`, replace `YOUTUBE_STREAM_KEY` with your YouTube Studio stream key. **No dashboard token is required on Android.** `start.sh` forces local-only mode and the server listens on `127.0.0.1`, accessible only from this phone. The default encoding profile is 480p/24fps to reduce CPU use. Save in Nano with **Ctrl+O, Enter, Ctrl+X**.

**Never post the stream key or `.env` file in chat, GitHub or screenshots.** Never expose this token-free local server through port forwarding, a reverse proxy or a public tunnel.

## 4. Start the server and open the dashboard

```bash
bash start.sh
```

In Chrome on the **same phone**, open:

**http://127.0.0.1:4000**

The **dashboard opens directly without a security popup**. Choose a video, upload it, enable **Loop**, and press **Start streaming**. Check your broadcast in YouTube Studio. After the upload and start steps, Chrome can close; FFmpeg continues inside Termux as long as Android keeps it alive.

### Updating an existing StreamForge installation

Download the latest `StreamForge-Android.zip` to your phone's Downloads folder. Then in Termux:

```bash
tmux kill-session -t streamforge
unzip -o "$HOME/storage/downloads/StreamForge-Android.zip" -d "$HOME"
cd "$HOME/StreamForge-Android"
bash start.sh
```

This replaces the application code but **preserves your existing `.env` and uploaded videos** (the ZIP does not include them). You don't need to regenerate a token or reinstall dependencies. If the old popup still appears, open `http://127.0.0.1:4000` in a fresh Chrome Incognito tab so the previous page is not cached.

## 5. Check or stop the stream

To see the Node/FFmpeg console in Termux:

```bash
tmux attach -t streamforge
```

To leave this console **without stopping** the server: press **Ctrl+B**, release, then press **D**.

To stop the YouTube stream, use the **Stop streaming** button in the dashboard. To stop the server itself, first stop streaming, then run:

```bash
tmux kill-session -t streamforge
termux-wake-unlock
```

To start again, run `bash start.sh`.

## Troubleshooting

- **Site not loading:** Open `tmux attach -t streamforge` and check for errors. Make sure `http://127.0.0.1:4000` is opened on the phone, not a different device.
- **Old security popup still showing:** Restart the tmux server with the updated `start.sh`, then open a new Chrome Incognito tab. Check `http://127.0.0.1:4000/health`: it should show `"localOnly":true`.
- **Video uploaded but YouTube still offline:** Check the YouTube Studio Live Control Room. Confirm Live is enabled, stream key correct, and Auto-start enabled. YouTube may need you to click Go Live manually.
- **Stream freezes / video too slow:** Phone may not keep up with 480p encoding. In `.env`, try `STREAM_WIDTH=640`, `STREAM_HEIGHT=360`, `STREAM_FPS=15`, `STREAM_BITRATE_KBPS=800`; then stop streaming and restart the Termux server.
- **Process stops when screen locks:** Enable unrestricted battery behavior for Termux, call `termux-wake-lock`, and disable aggressive battery management. No Android setting guarantees the process will always survive.
- **Upload cannot complete:** Check free phone storage. The uploaded copy stays in `data/uploads/`; replacing it while stopped removes the old copy. If you delete the app files, your upload is lost.

**Safety note:** Use only videos you own or have the rights to broadcast. Streaming uses mobile data, CPU and battery; a long session can heat your phone. Start with a short private/unlisted test stream.
