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
