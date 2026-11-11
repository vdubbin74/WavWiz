# WavWiz server on Raspberry Pi (0.7.0, in development)

> **Status: not yet verified on real Raspberry Pi hardware.** The 0.7.0 arm64 build has been built and smoke-tested only under QEMU
> arm64 emulation on an x86-64 build machine (Docker image, plus the bare tarball in Debian 13 and Debian 12 arm64 containers).
> Microsoft does not support running .NET under QEMU, so performance and timing on a real Pi are still unknown. Nothing is published
> to Docker Hub or GitHub Releases yet. Please treat this page as the plan for 0.7.0 and report what you find.

A Raspberry Pi makes a quiet, low-power, always-on **WavWiz server**: the web UI, library, zones, scenes, schedules, alarms, Jukebox and
Remote, with playback to **Google Cast** speakers (new in 0.7.0), **AirPlay** speakers, Windows WavWiz Players, and phones or browsers.
It is the same headless server as the [Docker](DOCKER.md) and [Linux](LINUX.md) builds, compiled for 64-bit ARM (`linux/arm64`).

## What you need

**Supported boards: Raspberry Pi 4 and Raspberry Pi 5, 64-bit OS only.** Pi 3B+ and Zero 2 W may work but are not supported.

| | Recommended | Minimum (expected; unverified) |
|---|---|---|
| Board | Raspberry Pi 5 (best) or Pi 4 Model B | Pi 4 with 2 GB |
| RAM | 4 GB or more | 2 GB |
| OS | **Raspberry Pi OS (64-bit)**, Debian 13 "trixie" (the current release; Lite is fine) | Raspberry Pi OS (Legacy, 64-bit), Debian 12 "bookworm" |
| Storage | SSD/USB drive or a good A2 microSD card; music on USB or a NAS | 8 GB free for the OS + WavWiz + library database |
| Network | Wired Ethernet | Wi-Fi works but adds jitter for in-sync playback |

**32-bit Raspberry Pi OS is not supported** (`uname -m` says `armv7l`): .NET's 32-bit ARM build exists, but WavWiz ships only 64-bit
builds. Re-flash with Raspberry Pi OS (64-bit) using Raspberry Pi Imager.

## Option A: Docker (simplest to update)

```sh
curl -fsSL https://get.docker.com | sh          # Docker Engine + compose plugin (official convenience script)
sudo usermod -aG docker $USER && newgrp docker
mkdir -p ~/wavwiz/wavwiz-data && cd ~/wavwiz && sudo chown 10001:10001 wavwiz-data
```

`docker-compose.yml` (use the same file as on x86-64; Docker picks the arm64 image automatically once 0.7.0 is published):

```yaml
services:
  wavwiz:
    image: docker.io/vdubbin74/wavwiz-server:0.7.0   # not published yet: see "Status" above
    container_name: wavwiz
    network_mode: host          # needed for discovery, mDNS (AirPlay/Cast speakers) and Players finding the server
    user: "10001:10001"
    restart: unless-stopped
    environment:
      WAVWIZ_DATA: /data
      TZ: America/Chicago       # alarms/schedules use this time zone
    volumes:
      - ./wavwiz-data:/data
      - /mnt/music:/music:ro    # your music (USB drive or NAS mounted on the Pi)
```

```sh
docker compose up -d && docker compose logs wavwiz    # shows the claim code once
```

The image is Ubuntu 24.04 based (`mcr.microsoft.com/dotnet/aspnet:10.0`) and includes ffmpeg. About 250 MB on arm64.

## Option B: without Docker (systemd)

Download `wavwiz-server-0.7.0-linux-arm64.tar.gz` (self-contained: no .NET install needed), then:

```sh
tar -xzf wavwiz-server-0.7.0-linux-arm64.tar.gz
sudo ./wavwiz-server/install.sh
```

`install.sh` checks the board is 64-bit ARM, installs `ffmpeg` and the libraries .NET needs (ICU, OpenSSL, ca-certificates, tzdata, Kerberos) with apt, creates a `wavwiz` system user, copies the program to
`/opt/wavwiz-server` (keeping the previous copy as `/opt/wavwiz-server.prev`), installs and starts the `wavwiz-server` systemd service.
Settings and the library database live in `/var/lib/wavwiz` and are never touched by install, upgrade or `--uninstall`.
Options: `--no-start`, `--no-apt` (you install the packages yourself), `--uninstall`.

Installing by hand instead? You need `ffmpeg ca-certificates tzdata libgssapi-krb5-2` plus `libicu76 libssl3t64` (trixie) or
`libicu72 libssl3` (bookworm). Without ICU the server stops at start with "Couldn't find a valid ICU package".

```sh
systemctl status wavwiz-server
journalctl -u wavwiz-server -f          # the claim code is printed once
sudo cat /var/lib/wavwiz/claim.txt
```

Upgrade: unpack the new tarball and run its `install.sh` again. Roll back: `sudo systemctl stop wavwiz-server && sudo rm -rf /opt/wavwiz-server && sudo mv /opt/wavwiz-server.prev /opt/wavwiz-server && sudo systemctl start wavwiz-server`.

## First run

Open `http://<pi-address>:47800/` (for example `http://raspberrypi.local:47800/`) from a phone or PC on the same network within 15
minutes of starting, or use the claim code. Add your music folder under **Settings > Library** (for Docker: `/music`; for systemd: the
real path, which must be readable by the `wavwiz` user, e.g. `sudo apt install acl && sudo setfacl -R -m u:wavwiz:rX /mnt/music`).

Music on a NAS: mount the share on the Pi first (`/etc/fstab` with `cifs` or `nfs`), then point WavWiz at the mount point.

## Speakers on a Pi

- **Google Cast** (0.7.0): Nest speakers, Chromecast Audio, Cast TVs and soundbars appear in the **Cast speakers** card under Devices.
  The Cast device fetches the audio from the Pi over HTTP on port 47800, so allow it through any firewall.
- **AirPlay** speakers (AirPlay 1; AirPlay 2 output is experimental and off by default). AirPlay 2 needs UDP ports 319/320: as a systemd
  service uncomment the two `CAP_NET_BIND_SERVICE` lines in `/etc/systemd/system/wavwiz-server.service`; in Docker with host networking
  run `sudo sysctl -w net.ipv4.ip_unprivileged_port_start=319` (or keep AirPlay 2 off).
- **Windows WavWiz Players**, **phones and browsers** (including a browser on another Pi with a speaker).
- **Not on a Pi:** the Pi's own headphone jack/HDMI/USB DAC as a WavWiz speaker. The Linux server has no local audio output yet; see
  "Not available on Linux" below.

## mDNS and Avahi

Raspberry Pi OS runs `avahi-daemon` (that is what makes `raspberrypi.local` work). WavWiz shares UDP 5353 with it: both open the port
with address/port reuse, WavWiz joins the mDNS group and asks with normal multicast queries, so Avahi keeps working and you do not need to
stop it. With Docker this needs `network_mode: host` (bridge networking cannot see mDNS on your LAN). Tested under QEMU with an
Avahi-style socket held by a different user; not yet tested with a real `avahi-daemon` on a Pi.

## Not available on Linux (Pi included)

| Feature | Why | Instead |
|---|---|---|
| Local speaker output (Pi jack/HDMI/USB DAC) | The Windows Player uses WASAPI; there is no Linux Player or ALSA output yet | Cast, AirPlay, a Windows Player, or a browser as a speaker. An ALSA output is an open question for after 0.7.0 |
| CD ripper | Needs the Windows `wavwiz-cdda.exe` helper and Windows drive access; the Linux server shows an empty drive list | Rip on a Windows WavWiz PC |
| AirPlay **receiver** ("WavWiz – Everywhere") and Spotify Connect | The bundled receiver helpers are Windows builds only | Play from the WavWiz web app; AirPlay *output* to speakers works |
| Saved Windows-share logins | Windows-only API | Mount the share in Linux |
| Server microphone for calibration | Headless | Calibrate with a phone or a Windows Player's mic |

## Troubleshooting

- `Exec format error` / `cannot execute binary file`: you are on 32-bit Pi OS or used the x64 tarball. Use 64-bit OS + the arm64 tarball.
- Speakers not found: check `network_mode: host` (Docker), that the Pi and the speakers are on the same network/VLAN, and that no firewall
  blocks UDP 5353. Diagnostics (Help > Diagnostics) shows the network checks.
- Cast speaker added but silent: the speaker must reach `http://<pi-ip>:47800/` (firewall); and see the Cast notes in the Devices card.
- Slow first start: .NET compiles on first run; a Pi 4 should be ready in well under a minute (to be measured on hardware).
