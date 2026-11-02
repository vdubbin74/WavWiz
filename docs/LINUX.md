# WavWiz server on Linux without Docker (0.6.0, F166)

Headless **server only** (no Player). amd64 and arm64 (Pi 4/5, 4 GB+).

## Build

```sh
build/publish-linux.sh            # linux-x64 + linux-arm64 (self-contained, no .NET needed on target)
build/publish-linux.sh linux-x64  # one arch
```
Output: `out/linux/wavwiz-server-<version>-<rid>.tar.gz`.

## Install (systemd)

```sh
sudo apt install ffmpeg
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
