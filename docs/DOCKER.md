# WavWiz server in Docker (0.6.8, F166/F167)

Headless WavWiz **server** (not the Windows Player) for a home server, NAS, or mini PC on **64-bit Intel/AMD (`linux/amd64`)**. Same web UI, zones, scenes, schedules, alarms, Jukebox and Remote as on Windows.
The container has **no local speakers**: audio plays on WavWiz Players (Windows PCs), phones/browsers, and AirPlay 1 speakers.

**Published image:** `docker.io/vdubbin74/wavwiz-server` (tags `0.6.8`, `latest`) is **`linux/amd64` only**. It runs on x86-64 Linux hosts (including many NAS boxes and mini PCs that support Docker). It does **not** run natively on Raspberry Pi / ARM64 today.

**ARM64 / Raspberry Pi:** planned for **0.7.0**, subject to hardware verification. Not available on Docker Hub yet.

## Limits vs the Windows app

Docker is a **server only** build. It does not do everything the full Windows app does:

- **Headless:** no local speakers or microphone on the Docker host (use a WavWiz Player PC's mic or a phone for calibration).
- **No CD ripping**, **no Windows share logins**, **no Linux Player**.
- **No AirPlay 2 / Sonos / HomePod output.**
- **Windows Docker Desktop:** no real `network_mode: host`, so discovery (mDNS, AirPlay, Players finding the server) is weaker. Use published ports, see [Windows Docker Desktop (step-by-step)](#windows-docker-desktop-step-by-step).
- **Want PC speakers or richer output?** Pair a Windows Player (or run the full Windows app).

**Still included:** web UI, zones, scenes, schedules, alarms, Jukebox, Remote, and playback to Windows Players, phones/browsers and AirPlay 1 speakers.

## Quick start

```yaml
# docker-compose.yml
services:
  wavwiz:
    image: docker.io/vdubbin74/wavwiz-server:0.6.8
    container_name: wavwiz
    network_mode: host          # recommended: discovery (UDP) + mDNS need it
    user: "10001:10001"
    restart: unless-stopped
    environment:
      WAVWIZ_DATA: /data
      # TZ: America/Chicago     # alarms/schedules use this time zone
    volumes:
      - ./wavwiz-data:/data            # must be writable by uid 10001
      - /path/to/your/music:/music:ro
```

```sh
mkdir -p wavwiz-data && sudo chown 10001:10001 wavwiz-data
docker compose up -d
docker compose logs wavwiz      # shows the claim code once
```

Open `http://<host-ip>:47800/`.


## Windows Docker Desktop (step-by-step)

Docker Desktop on Windows does **not** give real `network_mode: host` to the browser — use published ports. This walkthrough matches a first-time home PC setup.

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and leave it running.
2. In File Explorer open your user folder `C:\Users\<you>` (for example `C:\Users\trevo`). Create a folder `wavwiz`, and inside it create `wavwiz-data`.
3. Turn on file extensions: **View → Show → File name extensions** (or Folder Options → View → uncheck “Hide extensions for known file types”).
4. In `wavwiz`, create a new text file named exactly `docker-compose.yml` (not `.yml.txt`). Paste:

```yaml
services:
  wavwiz:
    image: docker.io/vdubbin74/wavwiz-server:0.6.8
    container_name: wavwiz
    user: "10001:10001"
    restart: unless-stopped
    ports:
      - "47800:47800"
      - "47443:47443"
      - "47801:47801"
      - "47802:47802/udp"
      - "47803:47803/udp"
    environment:
      WAVWIZ_DATA: /data
      TZ: America/Chicago
    volumes:
      - ./wavwiz-data:/data
      - "D:/Music:/music:ro"
```

5. Change `"D:/Music:/music:ro"` to your real music folder (the example uses `D:/Music`):
   - Quote the whole left/right mount.
   - Use **forward** slashes: `D:/Music`, never `D:\Music`.
   - Put a slash right after the drive colon (`D:/Music`, not `D:Music`), and no slash before the drive letter (not `/D:/Music`).
   - Wrong paths show as “too many colons” or “invalid volume specification”.
6. Open PowerShell:

```powershell
cd C:\Users\<you>\wavwiz   # e.g. C:\Users\trevo\wavwiz
docker compose up -d
docker compose logs wavwiz
```

7. Open `http://localhost:47800/` in a browser on that PC. Use the claim code from the logs (or `wavwiz-data\claim.txt`) if asked.
8. In **Settings → Library**, add the folder **`/music`** (the path inside the container), then scan. Do not enter `D:\Music` in the app.

**Limits on Windows Desktop:** automatic discovery / mDNS / AirPlay advertising are weaker without host networking. Add players by address/QR if they do not find the server. For full discovery, prefer Linux or a Linux VM with `network_mode: host` (see Quick start above).

## First run (claim)

A headless server has no "browser on this PC", so first-time setup works two ways:

1. **15-minute window**: for 15 minutes after the container starts (while no admin password exists), any browser on your home network can set the admin password. The setup page shows a countdown banner.
2. **Claim code**: after that, setup asks for the one-time code in `/data/claim.txt` (mode 0600; also printed once in the log). `cat wavwiz-data/claim.txt` on the host.

Restarting the container reopens the 15-minute window. The file is deleted once the password is set. Only home-network (private) addresses are ever accepted.

## Music

- Bind-mount your music at `/music` (read-only is fine), then add `/music` under **Settings > Library**. Extra folders: more mounts (e.g. `/music2`).
- **NAS / SMB / NFS**: mount the share on the host (fstab / cifs / nfs) or as a compose volume, then bind it in. The built-in Windows share login is not available on Linux.
- Paths are case-sensitive.
- Moving from Windows: restore a `.wavwizbackup` in Settings, then fix the music folder paths to `/music/...`.

## Data volume `/data`

Settings, library DB (`wavwiz.db`), backups, HTTPS CA, logs, `claim.txt`, and `secret.key`.
`secret.key` (0600) encrypts saved passwords (remote Subsonic/Navidrome logins) with AES-256-GCM. This is weaker than Windows DPAPI: anyone who can read `/data` can decrypt them. Protect the volume.

## Host vs bridge networking

**Host** (recommended): players find the server automatically.

**Bridge** works, but automatic discovery and mDNS (AirPlay/Spotify advertising) usually will not cross the Docker bridge. Add the server by address/QR in the Player. Ports:

| Port | Proto | Use | Env override |
|---|---|---|---|
| 47800 | TCP | HTTP web UI / API | `WAVWIZ_HTTP_PORT` |
| 47443 | TCP | HTTPS (phones: mic, phone-as-device) | `WAVWIZ_HTTPS_PORT` |
| 47801 | TCP | Audio to Players | `WAVWIZ_AUDIO_PORT` |
| 47802 | UDP | Clock sync | `WAVWIZ_CLOCK_PORT` |
| 47803 | UDP | Discovery | `WAVWIZ_DISCOVERY_PORT` |
| 5353 | UDP | mDNS | — |
| 47804 | TCP | AirPlay receiver ("WavWiz – Everywhere") | `WAVWIZ_AIRPLAY_PORT` |
| 47805 | TCP | Spotify Connect (add-on) | `WAVWIZ_SPOTIFY_PORT` |
| per zone | TCP | Per-zone AirPlay/Spotify receivers (Settings shows them) | — |

```yaml
    ports: ["47800:47800", "47443:47443", "47801:47801", "47802:47802/udp", "47803:47803/udp"]
```

Other env: `WAVWIZ_DISCOVERY=0`, `WAVWIZ_AIRPLAY=0`, `WAVWIZ_BIND` (default `0.0.0.0` in the image), `WAVWIZ_FFMPEG`.

## Side-by-side test (keep a live server untouched)

Host networking shares ports with the host, so on a machine already running WavWiz use other ports, another data folder and no discovery:

```yaml
services:
  wavwiz-sbs:
    image: docker.io/vdubbin74/wavwiz-server:0.6.8
    network_mode: host
    user: "10001:10001"
    environment:
      WAVWIZ_DATA: /data
      WAVWIZ_HTTP_PORT: "48800"
      WAVWIZ_HTTPS_PORT: "48443"
      WAVWIZ_AUDIO_PORT: "48801"
      WAVWIZ_CLOCK_PORT: "48802"
      WAVWIZ_DISCOVERY_PORT: "48803"
      WAVWIZ_AIRPLAY_PORT: "48804"
      WAVWIZ_SPOTIFY_PORT: "48805"
      WAVWIZ_DISCOVERY: "0"
      WAVWIZ_AIRPLAY: "0"
    volumes: ["./data:/data", "/path/to/music:/music:ro"]
```

## Updating

Auto-update is off. `docker compose pull && docker compose up -d`. (Watchtower works too if you like.) Back up first: Settings > Backup.

## Not on Linux

Summary of [Limits vs the Windows app](#limits-vs-the-windows-app): CD ripping, AirPlay 2 / Sonos / HomePod **output**, the server's own speakers and microphone (use a WavWiz Player PC's mic or a phone for calibration), Windows share logins, Linux Player. These are hidden or labelled in the UI.

## Building the image (local / experimental)

The Dockerfile can cross-build `linux/amd64` and `linux/arm64`, but **Hub does not publish an arm64 tag today**, and arm64/Pi is **not** a supported or hardware-verified configuration yet (planned for 0.7.0). Use these only for local experiments:

```sh
docker build -t docker.io/vdubbin74/wavwiz-server:0.6.8 .
# Experimental multi-arch local build only (needs QEMU/binfmt for arm64). Not published on Hub; not a supported configuration yet.
docker buildx build --platform linux/amd64,linux/arm64 -t docker.io/vdubbin74/wavwiz-server:0.6.8 .
```
