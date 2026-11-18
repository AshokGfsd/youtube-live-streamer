# StreamForge for Android — no card, no VPS

This ZIP contains the **prebuilt Next.js dashboard** and the **Node.js + FFmpeg backend**. You don't need Docker, Oracle Cloud or a Next.js compiler on your Android phone.

**Your phone becomes the server.** You can close Chrome and switch apps while streaming, but **the phone must stay switched on, connected to the internet, and allowed to run Termux in the background**. Android can still kill background or CPU-intensive processes. This is not guaranteed 24/7 cloud hosting.

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

## 3. Configure your private credentials

```bash
cp .env.example .env
openssl rand -hex 32
nano .env
```

Inside `.env`, replace `DASHBOARD_TOKEN` with the long random string printed by OpenSSL; replace `YOUTUBE_STREAM_KEY` with your YouTube Studio stream key. The default encoding profile is 480p/24fps to reduce CPU use. Save in Nano with **Ctrl+O, Enter, Ctrl+X**.

**Never post the stream key, access token, or `.env` file in chat, GitHub or screenshots.**

## 4. Start the server and open the dashboard

```bash
bash start.sh
```

In Chrome on the **same phone**, open:

**http://127.0.0.1:4000**

Enter:

- Server URL: `http://127.0.0.1:4000`
- Dashboard token: your `DASHBOARD_TOKEN` from `.env`

Then choose a video, upload it, enable **Loop**, and press **Start streaming**. Check your broadcast in YouTube Studio. After the upload and start steps, Chrome can close; FFmpeg continues inside Termux as long as Android keeps it alive.

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
- **Invalid dashboard token:** Re-enter the exact `DASHBOARD_TOKEN` saved in your local `.env`.
- **Video uploaded but YouTube still offline:** Check the YouTube Studio Live Control Room. Confirm Live is enabled, stream key correct, and Auto-start enabled. YouTube may need you to click Go Live manually.
- **Stream freezes / video too slow:** Phone may not keep up with 480p encoding. In `.env`, try `STREAM_WIDTH=640`, `STREAM_HEIGHT=360`, `STREAM_FPS=15`, `STREAM_BITRATE_KBPS=800`; then stop streaming and restart the Termux server.
- **Process stops when screen locks:** Enable unrestricted battery behavior for Termux, call `termux-wake-lock`, and disable aggressive battery management. No Android setting guarantees the process will always survive.
- **Upload cannot complete:** Check free phone storage. The uploaded copy stays in `data/uploads/`; replacing it while stopped removes the old copy. If you delete the app files, your upload is lost.

**Safety note:** Use only videos you own or have the rights to broadcast. Streaming uses mobile data, CPU and battery; a long session can heat your phone. Start with a short private/unlisted test stream.
