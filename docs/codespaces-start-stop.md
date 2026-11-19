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
