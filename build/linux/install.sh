#!/usr/bin/env bash
# 0.7.0: install / upgrade the WavWiz server from this unpacked tarball (Raspberry Pi OS 64-bit, Debian/Ubuntu x64 or arm64).
#   tar -xzf wavwiz-server-<ver>-linux-arm64.tar.gz && sudo ./wavwiz-server/install.sh
# Options: --no-start (install only)   --no-ffmpeg (skip "apt-get install ffmpeg")   --uninstall (stop + remove program; keeps /var/lib/wavwiz)
# What it does: checks the CPU matches this build, installs ffmpeg, creates the "wavwiz" system user, copies this folder to /opt/wavwiz-server
# (the previous copy is kept as /opt/wavwiz-server.prev), installs the systemd unit and starts it. Your data in /var/lib/wavwiz is never touched.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"; DEST=/opt/wavwiz-server; DATA=/var/lib/wavwiz; UNIT=/etc/systemd/system/wavwiz-server.service
START=1; FFMPEG=1; UNINSTALL=0
for a in "$@"; do case "$a" in --no-start) START=0;; --no-ffmpeg) FFMPEG=0;; --uninstall) UNINSTALL=1;; -h|--help) sed -n '2,6p' "$0"; exit 0;; *) echo "unknown option $a" >&2; exit 2;; esac; done
[ "$(id -u)" = 0 ] || { echo "Run with sudo: sudo $0 $*" >&2; exit 1; }
command -v systemctl >/dev/null || { echo "systemd is required." >&2; exit 1; }

if [ "$UNINSTALL" = 1 ]; then
  systemctl disable --now wavwiz-server 2>/dev/null || true
  rm -f "$UNIT"; systemctl daemon-reload; rm -rf "$DEST" "$DEST.prev"
  echo "WavWiz server removed. Your settings and library database are still in $DATA (delete it yourself if you want)."; exit 0
fi

# 1. the right build for this CPU (a 32-bit Raspberry Pi OS reports armv7l: not supported, install the 64-bit OS)
arch="$(uname -m)"; want=""
[ -f "$SRC/wavwiz-server" ] || { echo "Run this from the unpacked wavwiz-server folder." >&2; exit 1; }
case "$(head -c 20 "$SRC/wavwiz-server" | od -An -tx1 | tr -d ' \n' | cut -c37-40)" in b700) want=aarch64;; 3e00) want=x86_64;; esac
if [ -n "$want" ] && [ "$arch" != "$want" ]; then
  echo "This package is for $want but this machine is $arch." >&2
  [ "$arch" = armv7l ] || [ "$arch" = armv6l ] && echo "32-bit Raspberry Pi OS is not supported: install Raspberry Pi OS (64-bit) on a Pi 3/4/5." >&2
  exit 1
fi

# 2. ffmpeg (audio decoding) from the OS packages
if ! command -v ffmpeg >/dev/null; then
  if [ "$FFMPEG" = 1 ] && command -v apt-get >/dev/null; then apt-get update -qq && apt-get install -y --no-install-recommends ffmpeg
  else echo "WARNING: ffmpeg is not installed; WavWiz can't play most files until you install it (sudo apt install ffmpeg)." >&2; fi
fi

# 3. user + data folder
id wavwiz >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin wavwiz
install -d -m 0750 -o wavwiz -g wavwiz "$DATA"

# 4. program files (keep one previous copy for a quick roll-back)
systemctl stop wavwiz-server 2>/dev/null || true
if [ "$SRC" != "$DEST" ]; then
  [ -d "$DEST" ] && { rm -rf "$DEST.prev"; mv "$DEST" "$DEST.prev"; }
  cp -a "$SRC" "$DEST"
fi
chown -R root:root "$DEST"; chmod 0755 "$DEST/wavwiz-server"

# 5. service
install -m 0644 "$DEST/wavwiz-server.service" "$UNIT"
systemctl daemon-reload
systemctl enable wavwiz-server >/dev/null
if [ "$START" = 1 ]; then
  systemctl start wavwiz-server
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo "WavWiz server is starting. Open http://${ip:-<this-pi>}:47800/ from a phone or PC on the same network."
  echo "First-time setup: within 15 minutes, or use the code from: sudo cat $DATA/claim.txt   (log: journalctl -u wavwiz-server)"
else
  echo "Installed. Start it with: sudo systemctl start wavwiz-server"
fi
