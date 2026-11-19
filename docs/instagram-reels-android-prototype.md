# Instagram Reels → YouTube Live: Android feature branch

Phase 1 **passed on an actual Termux Android phone**: Chromium at local CDP
port 9222 was reachable and an original synthetic test feed advanced twice.
The user has also started the real Instagram watcher. **Phase 2** now adds an
Android-only dashboard, MySQL-backed settings, automatic scrolling and X11
screen capture with FFmpeg to YouTube RTMPS. It has been code-tested but a
**real device video/audio capture + YouTube ingest test is still required.**

The original StreamForge `main` branch is unchanged. This experimental feature
is isolated on `feature/instagram-auto-scroll-live`.

**Do not rely on this for unattended livestreaming.** Instagram can change
its web interface, autoplay/loop behavior or login requirements. Android can
pause Termux and the graphical display, especially when the screen is locked.
Also, Instagram's terms restrict unauthorized automated access, and YouTube
may interrupt restreams of copyrighted third-party Reels. Only use an account
and content you are authorized to operate and rebroadcast; never bypass an
Instagram login challenge.

## 1. Install graphical Chromium on your Android phone

The phone must have sufficient free storage, RAM and cooling. First pull this
**feature branch** into a separate checkout (do not replace your working
StreamForge installation):

```sh
cd "$HOME"
git clone --branch feature/instagram-auto-scroll-live https://github.com/AshokGfsd/youtube-live-streamer.git streamforge-reels-test
cd streamforge-reels-test
pkg install x11-repo -y
pkg install chromium termux-x11-nightly ffmpeg pulseaudio -y
```

Install the **matching Termux:X11 Android companion APK** from the official
[Termux:X11 releases](https://github.com/termux/termux-x11/releases). The
terminal package alone is not sufficient. Follow the official app-signing
guidance if using Termux from F-Droid vs. GitHub.

Start an X11 display (open the Termux:X11 Android app as needed):

```sh
termux-x11 :1 &
export DISPLAY=:1
pulseaudio --start --exit-idle-time=-1
```

For **mobile-looking video** instead of the desktop sidebar in your screenshot,
set the Termux:X11 Android companion app's display resolution mode to
**exact 540 × 960 portrait**. Restart X11 after changing the resolution.
Close **all** old Chromium windows (a second launch would reuse the original
desktop process), then run:

```sh
cd ~/streamforge-reels-test
bash scripts/launch-instagram-mobile.sh
```

This starts Chromium in fullscreen **kiosk app mode** without tabs or an
address bar. The StreamForge live controller then applies a phone-width
responsive Instagram viewport. Kiosk mode and a portrait X11 screen are both
needed: the Chromium viewport setting alone cannot change the X11 resolution.

For the original **desktop-layout prototype**, the older command is:

```sh
chromium-browser --user-data-dir="$HOME/.streamforge-reels-browser" \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 \
  'https://www.instagram.com/reels/' &
```

Keep that browser profile private. It contains session cookies. Do not commit,
share or upload it. Never expose port `9222` through a tunnel or public IP.

## 2. Test a fully offline synthetic feed first

No Instagram account or videos are required for this test. In another Termux
session **with Chromium still running**:

```sh
cd "$HOME/streamforge-reels-test"
node scripts/instagram-reels-prototype.mjs --demo
```

The script creates three temporary original WebM test videos with FFmpeg,
opens a local test feed tab in Chromium and automatically watches for each
video's completion. Expected output includes:

```
Active Reel: 1
Reel finished: near-end — requesting one scroll
Verified next Reel (1): 2
...
PASS: auto-scroll transitioned to 2 successive videos.
```

If the browser never moves to the next clip, try the other navigation mode:

```sh
node scripts/instagram-reels-prototype.mjs --demo --scroll=arrow
```

The temporary test videos are deleted when the script exits. This test never
uses your YouTube stream key.

## 3. Try the actual Instagram Reels browser page

Manually log in **inside that Chromium window** and open
`https://www.instagram.com/reels/`. Then run:

```sh
node scripts/instagram-reels-prototype.mjs --instagram
```

You should see the active video's duration, a completion event, and a single
scroll request. Use Ctrl+C to stop the prototype. If the Instagram page
doesn't respond to a wheel scroll, stop it and retry:

```sh
node scripts/instagram-reels-prototype.mjs --instagram --scroll=arrow
```

Do **not** assume the title of a YouTube broadcast changes Instagram's feed
recommendations. The feed is chosen by Instagram for the logged-in account.

## 4. Test display capture without broadcasting copyrighted material

With a synthetic test feed visible in Termux:X11, confirm your local FFmpeg
can read the X11 display. Adjust `-video_size` if the display is smaller:

```sh
ffmpeg -hide_banner -f x11grab -framerate 15 -video_size 320x568 \
  -i :1.0 -t 10 -an -c:v libx264 -preset ultrafast -f null -
```

This is a **dry run to the null output**, not a YouTube broadcast. It must pass
before using the new screen-capture dashboard. Match capture width/height to
your actual X11 display; values larger than the display will fail.

## 5. Launch the Reels Live studio (new)

**Stop** `node scripts/instagram-reels-prototype.mjs --instagram` with Ctrl+C
before using the new built-in controller. Running two controllers at once can
cause double-scrolls. Keep X11, PulseAudio, Chromium and its Instagram tab
running. You already have these packages on your device.

```sh
cd ~/streamforge-reels-test
git switch feature/instagram-auto-scroll-live
git pull --ff-only origin feature/instagram-auto-scroll-live
bash start-android.sh
```

This uses the **same existing** `~/StreamForge-Android/.env`, MySQL data and
uploaded videos. The script restarts the StreamForge API tmux session, so stop
any *other* active live before running the updater. It does **not** alter the
working GitHub `main` branch.

If MySQL is not yet configured, follow `deploy/termux/README-ANDROID.md` to set
`MYSQL_DATABASE` and `CHANNEL_ENCRYPTION_KEY` first. Then complete the channel
wizard at `http://127.0.0.1:4000/channels`.

1. Open **http://127.0.0.1:4000/instagram-live** in your Android Chrome.
2. Select your completed YouTube channel with its saved stream key.
3. In the Termux:X11 companion app, select portrait **540 × 960**, close the
   old desktop Chromium window and launch `bash scripts/launch-instagram-mobile.sh`.
   Log in manually and play one Reel. Kiosk mode removes browser controls.
4. Press **Check local browser**.
5. Enter live title, description, privacy and auto-scroll method. Each edit
   saves automatically to MySQL. For your **first test**, select `Private` and
   `Silent audio` under Capture settings.
6. Leave **Mobile portrait Reels** enabled. Set capture X/Y to **0 / 0** and
   dimensions to the *actual* portrait X11 display (**540 × 960** by default).
   For a smaller X11 display, use matching even capture sizes, e.g.
   **320 × 568**. Portrait capture requires width smaller than height.
7. If you connected the YouTube account using Google OAuth, check **Create
   YouTube event automatically**. Otherwise prepare a live event in YouTube
   Studio using the configured stream key; entering a title in StreamForge
   alone doesn't create a YouTube event.
8. Only after confirming you own or are licensed to rebroadcast the feed and
   audio, check the rights box and press **Start Reels livestream**.
9. Open **YouTube Studio** to confirm the video preview and that the event is
   receiving packets. Confirm the Reel fills the portrait canvas with **no
   Chromium address bar or Instagram desktop sidebar**. Check the live
   diagnostics for FFmpeg errors.
10. Press **Stop livestream** to stop both FFmpeg and the Reels controller.

You can test the API without starting a stream:

```sh
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:4000/api/instagram-live/browser
curl http://127.0.0.1:4000/api/instagram-live/status
```

The browser control is only allowed on loopback `127.0.0.1:9222`. The API is
phone-only. It neither extracts Instagram login secrets nor downloads Reels.
`PulseAudio monitor` is **experimental**: the phone must have a working
`parec` capture device receiving the Chromium audio. It is not yet verified on
your phone. A missing monitor or stopped audio process stops the live rather
than silently claiming audio is working.

The stream **does not automatically resume after a restart**. Explicitly press
Start when you're ready and can see the authorized Reels feed.

## Interpreting the results

| Test | Pass condition |
| --- | --- |
| Synthetic feed | Two verified next-Reel transitions |
| Instagram login | Browser plays a Reel without login interruption |
| Instagram auto-scroll | Next actual Reel starts only after the preceding Reel completes |
| FFmpeg X11 capture | 10 seconds captured without an input error |
| Audio | Silent stream available; PulseAudio monitor experimental |
| YouTube Live | Dashboard and FFmpeg RTMPS integrated; confirm on device |

If the Instagram test fails because the page does not expose usable video
timing or blocks automated controls, stop. Do not attempt CAPTCHA bypasses,
stealth browser patches or private Instagram API scraping.
