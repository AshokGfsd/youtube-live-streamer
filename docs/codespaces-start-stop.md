# StreamForge — start / stop everything from GitHub Codespaces

These commands are for the **Codespaces terminal**, not Termux, Android or
Google Cloud Shell. Use the `feature/google-cloud-free-trial` branch.

## One command to start

```bash
cd /workspaces/youtube-live-streamer
bash start-all.sh
```

The script runs these stages in order:

1. Check Node.js 22+, FFmpeg, MariaDB, PulseAudio, Xvfb, VNC/noVNC, tmux and Chrome.
2. Check `~/StreamForge-GCloud/.env` and the private VNC password.
3. Start **MariaDB** with `sudo service mariadb start` if needed.
4. Start **PulseAudio**, create `sf_audio` and set `sf_audio.monitor` for capture.
5. Refresh the API + static dashboard in `~/StreamForge-GCloud` without touching secrets, video uploads or database data.
6. Start **Xvfb :99** (540 × 960) and **Openbox**.
7. Start password-protected **x11vnc (5900)**, **noVNC (6080)** and **Instagram Chrome (9222)**.
8. Start the **StreamForge Node API (4000)** and check the local URLs.

An existing service is reused rather than interrupted. When changing backend
code, stop first, then start again to load the updated source.

First use: if `.env` is missing, follow the error and configure
`~/StreamForge-GCloud/.env` using the example. If `.vnc/passwd` does not exist,
the script prompts you for a private VNC password. Do not paste secrets into
scripts, terminals shared with others or GitHub commits.

Open `http://127.0.0.1:6080/vnc.html` through a **private authenticated
Codespaces port forwarding** route to see the Instagram desktop; open
`http://127.0.0.1:4000` for the StreamForge dashboard through the same
private setup. Never expose ports 4000, 5900, 6080 or 9222 publicly.

Starting the infrastructure does **not** start a livestream. Sign in to
Instagram, play a Reel and start a private YouTube broadcast from StreamForge
after confirming you have rights to that content.

## One command to stop everything

```bash
cd /workspaces/youtube-live-streamer
bash stop-all.sh
```

The script stops active Instagram and other YouTube streams through their APIs,
then stops the exact StreamForge tmux sessions, PulseAudio and MariaDB. It does
not delete any databases, `.env` files, YouTube keys, uploads, Chrome profile
or Instagram login. Stop the broadcast in YouTube Studio separately if it
remains marked live after the encoder disconnects.

If MariaDB is shared with other applications in the Codespace, keep it running:

```bash
bash stop-all.sh --keep-db
```

Stopping the PulseAudio daemon also stops user-level audio for other programs
in that Codespace. Processes manually started outside the named StreamForge
tmux sessions are not forcibly killed.

## View health or troubleshoot

```bash
tmux ls
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:9222/json/version
pactl list short sources
sudo service mariadb status
tmux capture-pane -pt sf-cloud-api -S -80
tmux capture-pane -pt sf-cloud-browser -S -80
```

Codespaces can pause or stop an idle machine, even when the services are in
tmux. These scripts do not provide guaranteed 24/7 hosting. They do not create
cloud resources or enable billing.

## Search + Select Instagram Reels playlist

This feature works entirely through the Codespaces StreamForge dashboard and
the existing private Chrome/noVNC browser. It does **not** automatically search
Instagram's servers, scrape search results, or download anyone's videos.

1. Open the StreamForge dashboard's **Instagram Reels Live** page and select a
   YouTube channel.
2. In the private noVNC desktop, sign in to Instagram. Use Instagram's own
   **Search / Explore** interface to find a Reel you are allowed to rebroadcast.
   Open the **individual Reel** so the Chrome address is like
   `https://www.instagram.com/reel/SHORTCODE/`.
3. In dashboard **Step 03 — Search & Select Reels**, click **Add Current Reel**.
   This detects the URL of your currently open Reel tab (CDP port 9222) and
   saves the link to MySQL under the selected channel. Alternatively paste a
   Reel URL and click **Add Pasted Link**. Optional custom names help organize
   your playlist.
4. Repeat for additional Reels. Use **up/down** buttons to set play order, or
   **remove** unwanted entries. A channel can save at most **60** Reel links.
5. Select **My selected Reels** (the normal **Explore feed** stays available)
   and choose whether **Loop the selected playlist** is enabled. StreamForge
   automatically saves this selection with your live settings.
6. Set YouTube visibility to **Private**, confirm you own/have a license for
   every Reel **and its audio**, and start. The controller navigates through
   the selected URLs in order after each Reel finishes. When looping is off,
   the encoder stops after the last Reel. The iPhone frame, screen capture,
   YouTube stream key and PulseAudio setup do not change.

Playlist edits are blocked while that channel is live. Stop the livestream
first, edit, and restart. Some videos can fail when deleted, region-restricted,
login-gated or blocked by autoplay; open the private Chrome window and check
playback if the live diagnostics report a Reel could not play.

### iPhone layout: vertically wrapped Instagram usernames

Instagram's narrow desktop Reels layout can reduce a long account handle to a
one-character-wide column. StreamForge now corrects those collapsed handles
inside the currently playing Reel (without changing regular captions) and maps
Chrome's emulated **CSS** video bounds to the X11 **physical** pixel resolution
before the iPhone crop. Restart both scripts after pulling, start a new private
test stream, and inspect the output in YouTube Studio. Instagram can change
its web markup at any time, so report a new screenshot if a particular Reel
still displays its overlay incorrectly.

From the Codespaces terminal, check the selected playback position and current
errors without exposing your stream key:

```bash
curl http://127.0.0.1:4000/api/instagram-live/status
```

**After pulling updated code**, restart the two scripts to copy the new API
and prebuilt dashboard into the running app:

```bash
git pull --ff-only origin feature/google-cloud-free-trial
bash stop-all.sh
bash start-all.sh
```

## Direct MP4 → FFmpeg feasibility (Experiment 01)

The Instagram Reels Live page now has an **Experiment 01** card below the
selected-Reels playlist. Paste a direct `.mp4` URL extracted from an Instagram
video, or import the JSON downloaded by the browser's `sfCollector.download()`
script (`directVideoUrls` array).

- **Check media** invokes `ffprobe` on the Codespaces host and reports codec,
  dimensions, FPS, duration and whether an audio stream exists.
- **Test 4s encoding** also asks FFmpeg to decode and encode four seconds using
  a 540 × 960 portrait output, H.264 and AAC when audio exists. It discards
  the encoded output. **It does not broadcast to YouTube or save a video.**
- The API is restricted to private loopback mode and accepts only initial direct
  HTTPS `.mp4` links on Instagram/Meta CDN hosts; all other submitted hostnames
  are rejected. FFmpeg may follow server-side HTTPS redirects after that initial
  validation, so this endpoint must remain private. One probe at a time is allowed.
- Signed URLs may expire or work in a browser but not from the Codespaces
  server. Errors are sanitized so media link query strings are never logged.
- Imported links stay only in browser memory; the API does not permanently
  store them in MySQL. Refreshing the dashboard clears the import.

If a URL works in your terminal but the imported JSON selection returns
**404**, use **Copy exact selected URL** on the dashboard (do not re-copy a
different link from Instagram). Paste it into this private Codespaces terminal
test. `read -s` keeps the signed URL out of the visible terminal and history:

```bash
read -r -s -p 'Paste selected MP4 URL: ' sf_selected_url
printf '\n'
ffprobe -v error \
  -show_entries stream=codec_name,codec_type,width,height,avg_frame_rate \
  -show_entries format=duration -of json "$sf_selected_url"
unset sf_selected_url
```

The `-max_redirects` option is intentionally **not** used because some
Codespaces FFprobe builds reject it with `Option not found`. If the exact
selected URL works in the command above, verify that the dashboard and terminal
are on the same Codespace and restart the StreamForge API after pulling. If it
returns 404, export a fresh Instagram URL. Never post signed URL query strings
in screenshots, issues or chat.

After pulling and restarting, test **three distinct clips** (with audio,
without audio, and a portrait/landscape variation) before live streaming.
Only use sources you own or have permission to rebroadcast.

## Direct MP4 playlist → YouTube Live (no VNC screen capture)

The earlier **Experiment 01** buttons only check and encode a short sample.
To make the MP4 links the actual livestream video source:

1. Stop any existing browser/X11 livestream first.
2. In **Instagram Reels Live**, choose the YouTube channel, then import a
   **fresh** collector JSON in **Direct MP4 → FFmpeg** (or paste one MP4 URL).
3. Turn on **Use these MP4 links as YouTube Live source**. The live control
   changes to **Start Direct MP4 livestream**; if this is off, Start still
   sends the VNC/Chrome screen exactly as before.
4. Choose **Loop the selected playlist** in Step 03 (on = repeat; off = finish
   after the final clip). Set the title and YouTube visibility to **Private**.
   The mobile capture width/height, FPS, bitrate and iPhone-frame choice are
   reused for direct encoding. Browser scrolling and PulseAudio options do
   not apply to the direct source; encoded MP4 audio is used when present.
5. Confirm that you have the rights to broadcast **all clips and their audio**,
   then click **Start Direct MP4 livestream** and verify the actual picture
   and audio in YouTube Studio. Chrome/noVNC may remain open, but its screen
   is not used in this mode. Stop using the same **Stop livestream** button.

The JSON is sent to the API only when you click Start, with a maximum of 100
direct HTTPS Instagram/Meta CDN MP4 URLs. The server writes a private, temporary
FFmpeg concat playlist under the system temporary directory, removes it on
stop, and never stores the signed links in MySQL or Git. Re-import after a
page reload or restart. The existing browser/X11 mode remains available.

**Direct playlist limitations:** This first implementation uses the FFmpeg
concat demuxer, which works best for clips with matching video and audio stream
layouts/codecs. Video-only or inconsistent media can play without audio or fail
at clip transitions. Signed MP4 URLs expire; a long looping stream can stop
when a link expires. If FFmpeg logs an inaccessible/expired URL or a stream
structure error, stop, export fresh links and try a smaller set of compatible
clips. This is direct remote media playback, not a downloader or permanent
video archive. Use only licensed content.

## Automatic Instagram keyword → MP4 playlist collection

1. Make sure the private Chrome `:9222` session is running and signed in to
   Instagram. You can check this through noVNC. The collector does **not**
   bypass login screens, CAPTCHAs or site restrictions.
2. Open **Instagram Reels Live → Find Instagram videos automatically**.
   Enter a keyword (e.g. **naruto**) and a video count (1–100). Click
   **Find videos automatically**. StreamForge opens a temporary tab in the
   signed-in Chrome profile on Instagram's normal keyword search page, inspects
   rendered videos, hovers result tiles and scrolls with small delays.
3. Watch **X / Y videos found** and use **Stop collecting** if needed. The
   collector stops at the target count, when no more playable videos load,
   or after a bounded number of scrolls.
4. Available MP4 links automatically populate the direct playlist and enable
   **Use these MP4 links as YouTube Live source**. Optionally use **Download
   collected JSON** for a temporary backup, or **Check media** on an item.
5. After checking media and confirming you have rights to every clip/audio,
   click **Start Direct MP4 livestream** separately, with YouTube visibility
   initially set to **Private**. Collecting links alone never starts a live.

**Limits:** Instagram may render a thumbnail without an HTML video/media URL;
the requested count cannot be guaranteed. The collector only reads media
rendered in your private logged-in Chrome and creates/closes its own temporary
search tab. It does not call private Instagram APIs, bypass login/CAPTCHA,
download media or store signed links permanently. URLs can expire quickly.
One search at a time is allowed and it cannot run during an active livestream.

## Single-channel configuration in `.env`

The Instagram Live studio can use **one YouTube channel** without removing its
existing MySQL database. Edit the private `/home/codespace/StreamForge-GCloud/.env`
(normally `~/StreamForge-GCloud/.env`) and set:

```dotenv
MULTI_CHANNEL_ENABLED=false
SINGLE_CHANNEL_ID=
SINGLE_CHANNEL_NAME=ClueRipple Live
SINGLE_CHANNEL_HANDLE=
SINGLE_CHANNEL_YOUTUBE_CHANNEL_ID=
SINGLE_CHANNEL_STREAM_KEY=PASTE_YOUR_PRIVATE_YOUTUBE_STREAM_KEY_HERE
SINGLE_CHANNEL_INGEST_URL=rtmps://a.rtmps.youtube.com/live2
SINGLE_CHANNEL_DEFAULT_TITLE=ClueRipple Live
SINGLE_CHANNEL_DEFAULT_DESCRIPTION=
SINGLE_CHANNEL_PRIVACY=private
SINGLE_CHANNEL_LOOP=true
MAX_CONCURRENT_STREAMS=1
```

The stream key in this example is a **placeholder**: enter your real key only
in your untracked private `.env`. Keep the existing `MYSQL_*` settings: the
Instagram Live playlist, channel profile and encryption still rely on MySQL.
The server encrypts the env-supplied stream key before saving it.

On API restart, single-channel mode selects the most recently updated **ready**
channel (or first draft). If you already have multiple stored channels and
want a specific one, put its UUID in `SINGLE_CHANNEL_ID`. Only the selected
channel appears in the dashboard and can be accessed through channel/Instagram
Live APIs; all other existing records remain intact. New channel creation is
disabled. With no saved channels the API creates one draft automatically.
If a `SINGLE_CHANNEL_STREAM_KEY` is provided, the selected channel is marked
ready using the env-configured settings. Any nonempty env fields overwrite the
selected channel's matching saved settings **on each API restart**; leave a
field empty to retain its prior value.

Set `MULTI_CHANNEL_ENABLED=true` later to reveal all saved channels and
restore multichannel creation. In single mode the concurrent-stream limit is
always one, regardless of `MAX_CONCURRENT_STREAMS`.

After changing `.env`, stop any running livestream, then restart the server:

```bash
cd /workspaces/youtube-live-streamer
bash stop-all.sh
bash start-all.sh
curl -s http://127.0.0.1:4000/health
curl -s http://127.0.0.1:4000/api/channels | jq '{multiChannelEnabled, maxConcurrentStreams, channels: [.channels[] | {id, displayName, ready}]}'
```

The API is intentionally *not* hot-reloaded by `start-all.sh` when its existing
tmux session is running. Restarting is needed for `.env` changes to take effect.
