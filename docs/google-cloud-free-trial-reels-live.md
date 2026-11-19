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
| MariaDB | Same VM, local only |
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
bash scripts/google-cloud-vm/bootstrap-debian.sh
```

This installs Chromium, FFmpeg, MariaDB, Xvfb, Openbox, noVNC and tmux. It **does not** launch a livestream or open any firewall ports.

## Step 3 — Create a fresh local MariaDB database

In the VM SSH terminal:

```bash
sudo mariadb
```

Enter these statements, replacing the example password with a private one **you choose**:

```sql
CREATE DATABASE IF NOT EXISTS streamforge CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'streamforge'@'127.0.0.1' IDENTIFIED BY 'REPLACE_WITH_YOUR_PRIVATE_PASSWORD';
GRANT ALL PRIVILEGES ON streamforge.* TO 'streamforge'@'127.0.0.1';
FLUSH PRIVILEGES;
EXIT;
```

Use a **new** password for this VM, not the one from your Android installation. Test login with `mariadb -h 127.0.0.1 -u streamforge -p streamforge -e "SELECT 1"` (enter password at prompt).

## Step 4 — Configure the StreamForge VM environment

```bash
mkdir -p ~/StreamForge-GCloud
cp ~/streamforge-google-test/deploy/termux/.env.example ~/StreamForge-GCloud/.env
nano ~/StreamForge-GCloud/.env
```

Verify the following values, and insert your own database password:

```dotenv
NODE_ENV=production
PORT=4000
LISTEN_HOST=127.0.0.1
WEB_STATIC_DIR=./public
LOCAL_ONLY_MODE=true
DATA_DIR=./data
FRONTEND_ORIGIN=http://127.0.0.1:4000,http://localhost:4000
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=streamforge
MYSQL_PASSWORD=REPLACE_WITH_YOUR_PRIVATE_PASSWORD
MYSQL_DATABASE=streamforge
INSTAGRAM_DISPLAY=:99
MAX_CONCURRENT_STREAMS=1
```

Leave `CHANNEL_ENCRYPTION_KEY` blank only while `LOCAL_ONLY_MODE=true`: StreamForge generates a private local key on first run. Do not delete that key after adding channel data. Add `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` only if you use optional YouTube OAuth event creation. The Google redirect address remains `http://127.0.0.1:4000/api/youtube/oauth/callback` because the Google sign-in flow happens *inside the VM browser*.

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

Inside the virtual desktop, sign in to Instagram manually and play a Reel. To open the local StreamForge dashboard on that same VM desktop, open another Chromium window with `http://127.0.0.1:4000/channels`; complete the channel wizard and save your stream key, then return to the playing Instagram Reels window.

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
