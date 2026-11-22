# StreamForge Google Cloud Console experiment — Linux VM (no Termux)

**Branch:** `feature/google-cloud-free-trial` · **Status:** prototype scripts prepared; actual Google VM, Instagram login, FFmpeg ingest and YouTube Live are **not yet tested**.

The original `main`, MySQL multi-channel studio and Android/Termux branch remain independent. No Google Cloud resources are provisioned automatically.

## Important: “Free” has three different meanings

1. **Cloud Shell (free web terminal):** Google's quota currently limits usage to **50 hours/week**, with non-interactive sessions automatically ending after **40 minutes** and a **12-hour session cap**. It is useful for accessing a VM, but **not** for a persistent video encoder/browser. See [Cloud Shell quotas](https://docs.cloud.google.com/shell/docs/quotas-limits).
2. **Compute Engine Always Free:** one eligible `e2-micro` VM worth of hours/month in `us-west1`, `us-central1` or `us-east1`, subject to disk/egress limits. This shared-CPU machine is **not a realistic guaranteed host** for Chromium + a virtual screen + MariaDB + real-time FFmpeg. The VM may run out of memory, throttle or drop frames.
3. **New Google Cloud Free Trial:** eligible new accounts get **$300 credit for 90 days**. You can use a more capable VM for a **short proof-of-concept**, but its usage consumes credit and is **not Always Free**. A paid billing upgrade could result in charges. See [Google Free Program](https://docs.cloud.google.com/free/docs/free-cloud-features) and [Free Trial FAQs](https://cloud.google.com/signup-faqs).

**Recommendation:** For an initial 10–15 minute private live test, create one temporary **Debian 12 Compute Engine VM, e2-standard-2 (2 vCPU, 8 GiB RAM)** using Free Trial credit. This is a test-size recommendation, not a claim of free indefinite operation. Stop/delete it after testing. Do not choose Cloud Run or Cloud Shell as the permanent browser/encoder host.

## What runs where?

| Component | Location |
| --- | --- |
| Google Cloud Console + Cloud Shell | Your normal web browser (no Termux) |
| Node.js StreamForge server | VM, bound to `127.0.0.1:4000` |
| Channel settings, keys and saved Reels | Encrypted file in VM `DATA_DIR` (**no MySQL required**) |
| Virtual portrait X11 desktop | `Xvfb :99` on VM at 540 × 960 |
| Chromium Instagram Reels | VM on `:99`, local DevTools port 9222 |
| Remote browser interaction | Password-protected noVNC through an **SSH tunnel**, not a public firewall rule |
| FFmpeg → YouTube RTMPS | Direct from VM over outbound Internet |

Instagram content belongs to other creators unless you have explicit rights; stream only owned/licensed Reels. No account bypasses, scraping or download are used.

## Step 1 — Create a temporary VM in Google Cloud Console

1. Sign in at <https://console.cloud.google.com/> and ensure your **Free Trial is active** if you intend to use trial credit.
2. Enable **Compute Engine API** if prompted.
3. Open **Compute Engine → VM instances → Create instance**.
4. Example VM name: `streamforge-test`; region `us-central1`, zone `us-central1-a`.
5. Machine for the trial: **e2-standard-2**, NOT e2-micro for this test.
6. Boot image: **Debian GNU/Linux 12 (Bookworm), x86/64**, standard persistent disk (e.g. 30 GB).
7. Leave **Allow HTTP traffic** and **Allow HTTPS traffic** unchecked. Never expose ports **4000, 5900, 6080 or 9222** to the Internet.
8. Review the console's actual **estimated cost and applicable trial credits** before clicking Create. Set a budget alert (alerts are not a hard cost limit).

**Stop or delete the VM when done.** The credits, disk and bandwidth limits are subject to Google's current pricing; do not assume zero cost just because the name contains “free”.

## Step 2 — SSH using Google Cloud Console only

In **VM instances**, click the VM's **SSH** button. This opens a Linux VM terminal inside your web browser. The following commands run **on the VM**, not on your phone.

```bash
git clone --branch feature/google-cloud-free-trial https://github.com/AshokGfsd/youtube-live-streamer.git streamforge-google-test
cd ~/streamforge-google-test
```

Debian's default Node.js package may be too old. **Node.js 22 or newer is required**. Install the supported Node.js LTS using the official instructions at <https://nodejs.org/en/download> before running the bootstrap, then check:

```bash
node --version
```

Then install the VM runtime packages:

```bash
bash scripts/google-cloud-vm/bootstrap-debian.sh --without-mysql
```

This installs Chromium, FFmpeg, Xvfb, Openbox, noVNC and tmux, **without MariaDB**. It **does not** launch a livestream or open any firewall ports.

### Ubuntu Cloud Shell: `Missing chromium` even after `apt install chromium`

Google Cloud Shell can run Ubuntu 24.04, whose `chromium-browser` apt package is a
Snap **launcher**, not an installed browser. Repeating `apt install chromium`
does not install a working executable. StreamForge now detects actual Chromium,
Google Chrome, or the official standalone **Chrome for Testing** binary. To try
the browser in a **temporary testing session** without Snap, use:

```bash
bash scripts/google-cloud-vm/install-browser.sh
```

This downloads Google's Stable Chrome for Testing into
`~/.local/share/streamforge-browser` and does not require root. After the full
runtime setup (`bootstrap-debian.sh --without-mysql`), `start.sh` automatically
finds the downloaded binary. Use
`STREAMFORGE_BROWSER_BIN=/absolute/path/to/chrome` if you have another real
Chrome binary. A Snap launcher that cannot execute is ignored.

**This is only a browser-install workaround, not a Cloud Shell hosting
recommendation.** Cloud Shell is ephemeral, can terminate unexpectedly, and is
not appropriate for unattended livestreams. Chrome may also require libraries
or sandbox capabilities that Cloud Shell does not provide. Use a **Debian
Compute Engine VM** for persistent streaming; never open the local dashboard,
VNC, or debugging ports to the Internet.

### Optional: Connect the dashboard through your own Cloud Shell preview URL

The Cloud Shell **Web Preview** URL is an HTTPS proxy hostname. By default the
StreamForge API accepts only local Host headers, so `http://127.0.0.1:4000/health`
can work even while the preview dashboard reports **Failed to fetch**. CORS
alone cannot fix the Host restriction. The following opt-in keeps the API
bound to `127.0.0.1` and requires a separate owner token for preview requests:

1. In Cloud Shell, obtain **your exact preview origin** (do not share its
   session-specific link publicly):

   ```bash
   printf 'https://4000-%s\n' "$WEB_HOST"
   ```

2. Generate a secret locally using `openssl rand -hex 32`. Open the private
   `~/StreamForge-GCloud/.env` with `nano` and set the values below (replace
   `https://4000-YOUR-WEB-HOST` with the output above):

   ```dotenv
   LOCAL_ONLY_MODE=true
   LISTEN_HOST=127.0.0.1
   CHANNEL_STORAGE=file
   MULTI_CHANNEL_ENABLED=false
   CLOUD_SHELL_PREVIEW_ORIGIN=https://4000-YOUR-WEB-HOST
   CORS_ALLOW_ALL_ORIGINS=true
   DASHBOARD_TOKEN=YOUR_RANDOM_64_CHARACTER_HEX_TOKEN
   ```

   Wildcard CORS permits frontends on other origins to *attempt* requests, but
   actual preview and cross-origin API controls still require this token. Do
   not use `*` as the preview hostname; it must be an exact HTTPS origin.

3. Restart the services to pick up the new `.env`:

   ```bash
   cd ~/youtube-live-streamer
   bash scripts/google-cloud-vm/stop.sh
   bash scripts/google-cloud-vm/start.sh
   ```

4. Open **Cloud Shell Web Preview → port 4000**. The dashboard will show the
   connection form. Enter the exact `https://4000-...` preview URL as its API
   address, and the random `DASHBOARD_TOKEN` value from `.env` as its access
   token. Do not send the token to anyone or paste it in a chat.

Cloud Shell's own identity redirect must complete before requests can reach
StreamForge. The preview URL can change when Cloud Shell is re-provisioned;
update `CLOUD_SHELL_PREVIEW_ORIGIN` if that happens. This setup still does **not**
make Cloud Shell a reliable continuous livestream host.

## Step 3 — Use encrypted file storage (no database)

StreamForge can store a single channel and its saved Instagram Reel settings on
the VM disk. There is **no database setup, username, password, or MySQL server**.
To enable this mode, set `CHANNEL_STORAGE=file` and `MULTI_CHANNEL_ENABLED=false`
in the private environment file during Step 4.

Existing MySQL users can leave `CHANNEL_STORAGE=mysql` unchanged. Selecting
`file` does **not** import old MySQL channels; the original database remains
untouched. Switch modes only after safely backing up any saved channel records.

## Step 4 — Configure the StreamForge VM environment

```bash
mkdir -p ~/StreamForge-GCloud
cp ~/streamforge-google-test/deploy/termux/.env.example ~/StreamForge-GCloud/.env
chmod 600 ~/StreamForge-GCloud/.env
nano ~/StreamForge-GCloud/.env
```

Verify the following values, and insert your **own** YouTube stream key in the
private `.env` (never post it online):

```dotenv
NODE_ENV=production
PORT=4000
LISTEN_HOST=127.0.0.1
WEB_STATIC_DIR=./public
LOCAL_ONLY_MODE=true
DATA_DIR=./data
FRONTEND_ORIGIN=http://127.0.0.1:4000,http://localhost:4000
CHANNEL_STORAGE=file
MULTI_CHANNEL_ENABLED=false
MYSQL_DATABASE=
SINGLE_CHANNEL_NAME=ClueRipple Live
SINGLE_CHANNEL_STREAM_KEY=YOUR_REAL_YOUTUBE_STUDIO_STREAM_KEY
SINGLE_CHANNEL_INGEST_URL=rtmps://a.rtmps.youtube.com/live2
SINGLE_CHANNEL_DEFAULT_TITLE=ClueRipple Live
SINGLE_CHANNEL_PRIVACY=private
INSTAGRAM_DISPLAY=:99
MAX_CONCURRENT_STREAMS=1
```

`SINGLE_CHANNEL_STREAM_KEY` in `.env` provisions your channel automatically.
You can also leave it blank and complete the channel wizard in the dashboard.
The channel records, Instagram stream settings, and saved Reels playlist are in
`~/StreamForge-GCloud/data/channels.json`. Stream and OAuth secrets in that file
are encrypted. **Back up `channels.json` and `channel-encryption.key` together**:
without the key, saved secrets cannot be recovered. The private `.env` contains
your key in plaintext if you configure it there, so do not commit or share it.

Leave `CHANNEL_ENCRYPTION_KEY` blank only while `LOCAL_ONLY_MODE=true`:
StreamForge generates a private local key on first run. Add `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` only if you use optional YouTube OAuth event creation.
The Google redirect address remains `http://127.0.0.1:4000/api/youtube/oauth/callback`
because the Google sign-in flow happens *inside the VM browser*.

Save in nano with **Ctrl+O**, **Enter**, then **Ctrl+X**.

## Step 5 — Configure private browser access

```bash
mkdir -p ~/.vnc
x11vnc -storepasswd
```

Create a **private VNC password** when prompted; it is distinct from your Google password. Never publish noVNC publicly. The stream itself does **not** need inbound network access.

Now start VM services and the portrait desktop:

```bash
cd ~/streamforge-google-test
bash scripts/google-cloud-vm/start.sh
```

These services run in named tmux sessions on the **VM**, independent of your browser SSH session. Verify locally:

```bash
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:9222/json/version
```

The health response should include `"channelStorage":"file"` and
`"mysqlConfigured":false`. To check the channel exists:

```bash
curl -s http://127.0.0.1:4000/api/channels
```

If they fail, inspect:

```bash
tmux capture-pane -pt sf-cloud-api -S -80
tmux capture-pane -pt sf-cloud-browser -S -80
```

## Step 6 — See the VM's browser from Google Cloud Console

Open a **Cloud Shell** terminal tab at the top of Google Cloud Console (this is different from the VM SSH terminal). Start a private SSH tunnel:

```bash
gcloud compute ssh streamforge-test --zone=us-central1-a -- -N -L 6080:127.0.0.1:6080
```

Leave this Cloud Shell tunnel running. Use **Cloud Shell → Web Preview → Change port → 6080** and open `/vnc.html` on the preview URL. Enter the VNC password you created. This route is experimental and depends on Cloud Shell's web preview supporting the WebSocket proxy; if it cannot connect, use an ordinary **local SSH port-forwarding client** and visit `http://127.0.0.1:6080/vnc.html` instead. **Do not create public firewall rules to make VNC work.**

Inside the virtual desktop, sign in to Instagram manually and play a Reel. To open the local StreamForge dashboard on that same VM desktop, open another Chromium window with `http://127.0.0.1:4000/channels`; your `.env` channel should already be configured if you supplied its key. Otherwise, complete the channel wizard, then return to the playing Instagram Reels window.

The browser window must show a full **portrait Reel without the desktop Instagram sidebar or browser address bar**.

## Step 7 — Private YouTube Live test

In the StreamForge dashboard, choose your completed YouTube channel and open **Instagram Reels Live**. Set:

| Setting | Test value |
| --- | --- |
| Privacy | Private |
| Mobile portrait Reels | Enabled |
| Capture width × height | 540 × 960 |
| Capture X / Y | 0 / 0 |
| FPS | 10 or 15 |
| Audio | Silent (first test) |
| Scroll | Wheel; try Arrow if needed |

If YouTube OAuth is connected, you can use **Create YouTube event automatically**; otherwise prepare the event in YouTube Studio and use its configured stream key. Once the Instagram window is visible again and playing a Reel, start the authorized private stream and watch YouTube Studio's preview. For a trial VM, test **a few minutes** and stop if there are encoder errors or lag.

**Important:** Google Cloud free trial credits do not guarantee sufficient CPU, smooth video playback, reliable Instagram autoplay or working audio. The code supports optional PulseAudio monitor, but this VM prototype does **not** configure a working browser audio monitor. The first test uses silent audio on purpose.

## Step 8 — Stop and avoid ongoing charges

On VM SSH:

```bash
cd ~/streamforge-google-test
bash scripts/google-cloud-vm/stop.sh
```

This stops only the experimental StreamForge tmux sessions. **It does not stop VM billing.** Go back to **Google Cloud Console → Compute Engine → VM instances**, and **Stop** the VM when testing ends. Disks and static external IPs may still incur charges depending on configuration. **Delete** the temporary VM and unnecessary resources when you no longer need them, after exporting any data you want to keep.

## What has actually been verified?

| Check | Status |
| --- | --- |
| Existing Reels watcher unit tests | Verified locally before this branch |
| No-MySQL file storage, encrypted secrets and Instagram playlists | Automated tests pass locally |
| Linux scripts parse with Bash | Run `bash -n` test in the repository |
| Real Google VM provisioning | Not performed; requires your account/approval |
| VNC via Cloud Shell Web Preview | Not tested on your Google project |
| Actual Instagram mobile playback | Not tested on VM |
| YouTube Live stream from VM | Not tested; private test required |

This is an experiment, not a promise of continuous free livestreaming.

## Official references

- [Google Cloud Shell quotas](https://docs.cloud.google.com/shell/docs/quotas-limits)
- [Google Cloud Free features and limits](https://docs.cloud.google.com/free/docs/free-cloud-features)
- [Google Free Trial FAQs](https://cloud.google.com/signup-faqs)
- [Google Compute Engine VMs](https://cloud.google.com/compute/docs/instances)
