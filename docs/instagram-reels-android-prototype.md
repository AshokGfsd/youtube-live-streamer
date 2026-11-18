# Experimental Instagram Reels auto-scroll prototype (Android)

This is **Phase 1 only**. It can test an Instagram Reels tab in Chromium and
request one next-Reel scroll when the visible HTML5 video finishes. It does
**not** publish the Instagram feed to YouTube, download Reels, create Instagram
accounts, or ask for passwords. The working StreamForge My Channels dashboard
and main branch are unchanged.

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

Launch Chromium with a **dedicated local profile** and loopback-only CDP port:

```sh
chromium --user-data-dir="$HOME/.streamforge-reels-browser" \
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

This is a **dry run to the null output**, not a YouTube broadcast. Audio is
not yet included: audio routing and browser codec support must be checked on
your actual phone. Android's own MediaProjection capture APIs are an
alternative, but Android 14+ requires user consent for each capture session,
and playback capture depends on the source app's audio permissions.

## Interpreting the results

| Test | Pass condition |
| --- | --- |
| Synthetic feed | Two verified next-Reel transitions |
| Instagram login | Browser plays a Reel without login interruption |
| Instagram auto-scroll | Next actual Reel starts only after the preceding Reel completes |
| FFmpeg X11 capture | 10 seconds captured without an input error |
| Audio | Tested separately; not implemented in this prototype |
| YouTube Live | **Not integrated in Phase 1** |

If the Instagram test fails because the page does not expose usable video
timing or blocks automated controls, stop. Do not attempt CAPTCHA bypasses,
stealth browser patches or private Instagram API scraping.
