# WavWiz server in Docker (0.7.3, F166/F167)

Headless WavWiz **server** (not the Windows Player) for a home server, NAS, mini PC, or Raspberry Pi 4/5, on **64-bit Intel/AMD (`linux/amd64`)** and **64-bit ARM (`linux/arm64`)**. Same web UI, zones, scenes, schedules, alarms, Jukebox and Remote as on Windows.
Audio plays on WavWiz Players (Windows PCs), phones/browsers, Cast and AirPlay 1 speakers, and (0.7.0) the host's own sound card when you
pass `/dev/snd` through, see [Local speakers](#local-speakers-070).

**Published image:** `docker.io/vdubbin74/wavwiz-server` (tags `0.7.3`, `latest`) is a **multi-arch** image (`linux/amd64` and `linux/arm64`). Docker picks the right platform automatically. The amd64 image runs on x86-64 Linux hosts (including many NAS boxes and mini PCs). The arm64 image is for Raspberry Pi 4/5 on 64-bit Raspberry Pi OS; it has been built and smoke-tested under QEMU emulation only and is **not yet verified on real Pi hardware**. See [RASPBERRY-PI.md](RASPBERRY-PI.md).

## Limits vs the Windows app

Docker is a **server only** build. It does not do everything the full Windows app does:

- **Headless:** no microphone on the Docker host (use a WavWiz Player PC's mic or a phone for calibration). Local speakers need `/dev/snd` (0.7.0).
- **No CD ripping**, **no Windows share logins**.
- **No audio inputs** (This PC · Speakers, Aux in, S/PDIF in, microphones as sources): they come only from the WavWiz Player on a Windows server PC, see [AUDIO-INPUTS.md](AUDIO-INPUTS.md). Announce from a phone or PC browser works.
- **No AirPlay 2 / Sonos / HomePod output.**
- **Windows Docker Desktop:** no real `network_mode: host`, so discovery (mDNS, AirPlay, Players finding the server) is weaker. Use published ports, see [Windows Docker Desktop (step-by-step)](#windows-docker-desktop-step-by-step).
- **Want PC speakers or richer output?** Pair a Windows Player (or run the full Windows app).

**Still included:** web UI, zones, scenes, schedules, alarms, Jukebox, Remote, and playback to Windows Players, phones/browsers and AirPlay 1 speakers.

## Quick start

```yaml
# docker-compose.yml
services:
  wavwiz:
    image: docker.io/vdubbin74/wavwiz-server:0.7.3
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
    image: docker.io/vdubbin74/wavwiz-server:0.7.3
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

## Local speakers (0.7.0)

The 0.7.0 image can play through the host's own headphone jack, HDMI or USB DAC (ALSA). Pass the sound devices and the host's `audio` group:

```yaml
    devices:
      - /dev/snd:/dev/snd
    group_add:
      - "29"          # getent group audio | cut -d: -f3  (29 on Debian, Ubuntu, Raspberry Pi OS)
```

`docker run ... --device /dev/snd --group-add 29 ...` does the same. The host then appears in Devices as a speaker named after the
container's hostname (set `hostname:` in compose for a nicer name), with ANALOG / HDMI / USB outputs. Without `/dev/snd` nothing changes
(Diagnostics > "This machine's speakers (ALSA)" says why). `WAVWIZ_LOCAL_AUDIO=off` turns it off. Docker Desktop on Windows/macOS has no `/dev/snd`.
Not yet verified on real hardware.

## Host vs bridge networking

**Host** (recommended): players find the server automatically.

**Bridge** works, but automatic discovery and mDNS (AirPlay/Spotify advertising) usually will not cross the Docker bridge. Add the server by address/QR in the Player. Ports:

**Bridge mode: set the advertise address (0.7.1).** In bridge mode the container only knows its own Docker address (172.17.x–172.31.x),
which no other device can reach, so Players that found the server were told to connect there and failed. Set
`WAVWIZ_ADVERTISE_ADDRESS` to **this host's home-network address** (the one you open the web page on, e.g. `192.168.1.20`); the discovery
answer and the Bonjour/mDNS record then carry that address. It must be an IPv4 address (a name is ignored, and the log says so). When the
server sees it is in a bridge-mode container without it, the log says so at start:
`Docker bridge network detected: this container's address (172.18.0.3) cannot be reached from other devices …`.
Players (0.7.1) also skip a Docker-internal address when the answer came from a reachable one (the host, through the published discovery
port), and never "move" a working connection to one — but setting the address is the reliable fix.

**Phones' secure connection (0.7.3).** When HTTPS for phones is not on yet, the server turns it on by itself at start if it has a home-network
address: with host networking, or in bridge mode with `WAVWIZ_ADVERTISE_ADDRESS` set. In bridge mode without it (and on loopback) it stays
manual: Settings > Devices > Phone & HTTPS. HTTPS that is already on is left as it is. If it fails, Settings shows the error and the reason.
Phone QR codes open the plain-http set-up page, which walks the phone through trusting the certificate and then continues to the secure address.

**Server name.** Docker names a container after its id (`3f2a9c1b7d4e`), so Players listed "WavWiz on 3f2a9c1b7d4e". A container whose
host name is only its id now shows as **WavWiz (Docker)**. Set `WAVWIZ_SERVER_NAME` (or `hostname:` in compose) for your own name; the
server name an admin sets in Settings always wins.

```yaml
    # bridge mode instead of network_mode: host
    ports: ["47800:47800", "47443:47443", "47801:47801", "47802:47802/udp", "47803:47803/udp"]
    environment:
      WAVWIZ_DATA: /data
      WAVWIZ_ADVERTISE_ADDRESS: "192.168.1.20"   # this host's home-network address
      WAVWIZ_SERVER_NAME: "Living room NAS"      # optional
```

Ports:

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

Other env: `WAVWIZ_ADVERTISE_ADDRESS` (bridge mode, above), `WAVWIZ_SERVER_NAME`, `WAVWIZ_DISCOVERY=0`, `WAVWIZ_AIRPLAY=0`, `WAVWIZ_BIND` (default `0.0.0.0` in the image), `WAVWIZ_FFMPEG`.

## iPhone: Pair / Administrator only reloads the sign-in page (fixed in 0.7.3)

Up to 0.7.2 an iPhone that opened WavWiz from the **Camera's QR code** (or a link in Messages / Mail, or a Home Screen icon) could not
sign in: Pair or Administrator was accepted, the page reloaded, and the sign-in page came back. The session cookie was `SameSite=Strict`, and
iPhone Safari does not use a Strict cookie on a page that was opened from outside the site, not even on that page's own requests or its
reload. Docker showed it first because there the phones open the plain-http QR link directly. 0.7.3 uses `SameSite=Lax` (cross-site writes
are still refused: every signed-in write must come from the WavWiz page itself), continues after sign-in without a reload, and if a browser
still does not keep the sign-in it says so instead of showing the form again. Nothing to change in your compose file.

It was **not** the Docker network: WavWiz accepts only home-network sources (10.x, 172.16–31.x, 192.168.x, link-local, loopback), and a Docker
bridge or NAT address is one of them. It never reads `X-Forwarded-For`, so a proxy header cannot make a request look local. In bridge mode with Docker's userland proxy every
phone can appear as the bridge gateway (for example `172.17.0.1`): sign-in still works, but devices then share one sign-in attempt limit
(5 wrong tries a minute) and new sign-ins are named after that address. Host networking (`network_mode: host`) keeps each phone's own address.

If an iPhone still says *"You were signed in, but this browser did not keep the sign-in"*: open the address in Safari itself (not inside
another app), turn off Private Browsing, and check Settings > Apps > Safari > Block All Cookies is off.

## Side-by-side test (keep a live server untouched)

Host networking shares ports with the host, so on a machine already running WavWiz use other ports, another data folder and no discovery:

```yaml
services:
  wavwiz-sbs:
    image: docker.io/vdubbin74/wavwiz-server:0.7.3
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

Summary of [Limits vs the Windows app](#limits-vs-the-windows-app): CD ripping, audio inputs, AirPlay 2 / Sonos / HomePod **output**, the server's microphone (use a WavWiz Player PC's mic or a phone for calibration), Windows share logins; local speakers need `/dev/snd` (0.7.0). These are hidden or labelled in the UI.

## Building the image (local / experimental)

The Dockerfile cross-builds `linux/amd64` and `linux/arm64` (the .NET build runs on the build machine's own CPU; only the runtime layer's `apt-get` runs under QEMU for arm64). The runtime base is `mcr.microsoft.com/dotnet/aspnet:10.0` (Ubuntu 24.04 "noble"; Microsoft publishes amd64, arm64 and arm/v7 manifests, WavWiz uses amd64 + arm64). Hub publishes both platforms as one multi-arch manifest (`0.7.2` and `latest`). arm64/Pi is **not yet hardware-verified** (see [RASPBERRY-PI.md](RASPBERRY-PI.md)). To build locally:

```sh
docker build -t wavwiz-server:dev .
# 0.7.0 multi-arch build into the local image store (no push). On an x86-64 machine register QEMU for arm64 once:
docker run --privileged --rm tonistiigi/binfmt --install arm64
docker buildx build --platform linux/amd64,linux/arm64 -t wavwiz-server:0.7.3-dev --load .
# needs Docker's containerd image store for a multi-platform --load; add --network host if the build can't reach the internet,
# and --build-arg APT_HTTPS=1 if your proxy blocks plain-http apt mirrors.
docker run --rm --platform linux/arm64 --network host wavwiz-server:0.7.3-dev    # try the arm64 image under QEMU (slow)
```
