#!/usr/bin/env bash
# F166: publish WavWiz.Server (server only, not the Player) for Linux.
#   build/publish-linux.sh [linux-x64|linux-arm64|all]   (default: all)
# Output: out/linux/<rid>/wavwiz-server/ and out/linux/wavwiz-server-<version>-<rid>.tar.gz
# Self-contained (no .NET install needed on the target). Needs ffmpeg on the target (install.sh runs apt install ffmpeg).
# 0.7.0: linux-arm64 = Raspberry Pi OS 64-bit (Pi 4 / Pi 5), see docs/RASPBERRY-PI.md. The tarball carries install.sh + the systemd unit.
set -euo pipefail
cd "$(dirname "$0")/.."
VER=$(sed -n 's:.*<WavWizVersion>\(.*\)</WavWizVersion>.*:\1:p' Directory.Build.props)
RIDS=("${1:-all}"); [[ "${RIDS[0]}" == all ]] && RIDS=(linux-x64 linux-arm64)
for rid in "${RIDS[@]}"; do
  dest="out/linux/$rid/wavwiz-server"
  rm -rf "$dest"
  dotnet publish src/WavWiz.Server/WavWiz.Server.csproj -c Release -r "$rid" --self-contained true \
    -p:PublishSingleFile=false -p:DebugType=none -o "$dest"
  cp build/linux/wavwiz-server.service "$dest/"
  install -m 0755 build/linux/install.sh "$dest/install.sh"
  chmod 0755 "$dest/wavwiz-server"
  tar --owner=0 --group=0 -C "out/linux/$rid" -czf "out/linux/wavwiz-server-$VER-$rid.tar.gz" wavwiz-server
  (cd out/linux && sha256sum "wavwiz-server-$VER-$rid.tar.gz" > "wavwiz-server-$VER-$rid.tar.gz.sha256")
  echo "-> out/linux/wavwiz-server-$VER-$rid.tar.gz"
done
