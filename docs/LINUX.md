# WavWiz server on Linux without Docker (0.6.8, F166)

Headless **server only** (no Linux Player; pair a Windows Player, phone/browser, or AirPlay 1 for speakers).

**Supported today:** **64-bit Intel/AMD** (`linux-x64` / `amd64`) on a Linux host such as a NAS or mini PC. That matches the published Docker Hub image (`linux/amd64` only).

**ARM64 / Raspberry Pi (0.7.0, in development):** `build/publish-linux.sh linux-arm64` produces a self-contained tarball for 64-bit Raspberry Pi OS (Pi 4/5) with `install.sh` and the systemd unit. Smoke-tested under QEMU only, **not verified on real Pi hardware**, and not published yet. See [RASPBERRY-PI.md](RASPBERRY-PI.md).

## Build

```sh
build/publish-linux.sh linux-x64   # supported target (self-contained; no .NET needed on the host)
build/publish-linux.sh             # both linux-x64 and linux-arm64
build/publish-linux.sh linux-arm64 # Raspberry Pi 4/5 (64-bit OS) tarball only — 0.7.0, not hardware-verified yet
```
Output: `out/linux/wavwiz-server-<version>-<rid>.tar.gz` (+ `.sha256`). The tarball contains `install.sh` and `wavwiz-server.service`. Official GitHub releases currently ship the Windows installer; Linux tarballs are produced from source with this script.

## Install (systemd)

Easiest (x64 or arm64): `tar -xzf wavwiz-server-<version>-<rid>.tar.gz && sudo ./wavwiz-server/install.sh` (installs ffmpeg and the .NET runtime libraries such as ICU and OpenSSL, the `wavwiz` user, `/opt/wavwiz-server` and the service; `--uninstall` removes it and keeps `/var/lib/wavwiz`). By hand, for the `linux-x64` build:

```sh
sudo apt install ffmpeg ca-certificates tzdata libgssapi-krb5-2 libicu76 libssl3t64   # Debian 12/Ubuntu 22.04: libicu72 libssl3 (Ubuntu 24.04: libicu74 libssl3t64)
sudo useradd --system --home /var/lib/wavwiz --shell /usr/sbin/nologin wavwiz
sudo tar -C /opt -xzf wavwiz-server-<version>-linux-x64.tar.gz
sudo install -d -o wavwiz -g wavwiz /var/lib/wavwiz
sudo cp /opt/wavwiz-server/wavwiz-server.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now wavwiz-server
journalctl -u wavwiz-server     # claim code
```

Run by hand: `WAVWIZ_DATA=~/wavwiz-data WAVWIZ_BIND=0.0.0.0 WAVWIZ_ALLOW_ALL_INTERFACES=1 /opt/wavwiz-server/wavwiz-server`
(or `--data-dir <path> --bind <lan-ip>`). Default data folder without settings: `~/.local/share/WavWiz-server`.

## First run, ports, music

Same as Docker, see [DOCKER.md](DOCKER.md): 15-minute LAN claim window or the code in `<data>/claim.txt`; ports 47800/47443/47801 TCP, 47802/47803/5353 UDP (open them in ufw/firewalld for your LAN); music = any readable folder (mount NAS shares at the OS level).

Saved passwords (remote libraries) use AES with `<data>/secret.key` (0600), weaker than Windows DPAPI.

## Limitations

No local Player audio, CD ripping hidden, AirPlay 2 / Sonos output Windows-only, no server PC mic (use a Player PC or phone), no Windows share logins.
