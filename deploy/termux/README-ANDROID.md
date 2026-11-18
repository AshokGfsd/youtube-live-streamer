# StreamForge for Android — no card, no VPS

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

The ZIP method below is an alternative if you prefer not to use Git.

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
