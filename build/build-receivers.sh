#!/usr/bin/env bash
# Builds the two bundled receiver helpers for Windows x64 (cross build on Linux; separate processes, never linked into WavWiz):
#   wavwiz-airplay.exe  = shairplay (LGPL-2.1+, pinned commit, unmodified) + build/receivers/wavwiz-airplay.c (MIT)
#   librespot.exe       = librespot (MIT, pinned tag, unmodified; pipe backend + built-in zeroconf/mDNS, Windows SChannel TLS)
#   wavwiz-hook.exe     = build/receivers/wavwiz-hook.c (MIT; librespot --onevent forwarder)
# Output: $WAVWIZ_TOOLS_CACHE/receivers/out/{bin,source}
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; cache="${WAVWIZ_TOOLS_CACHE:-$here/../.cache}/receivers"; out="$cache/out"
SHAIRPLAY_COMMIT=096b61ad14c90169f438e690d096e3fcf87e504e
LIBRESPOT_TAG=v0.8.0
mkdir -p "$cache" "$out/bin" "$out/source"; cd "$cache"
CC=x86_64-w64-mingw32-gcc
[ -d shairplay ] || git clone -q https://github.com/juhovh/shairplay.git
git -C shairplay checkout -q "$SHAIRPLAY_COMMIT"
L=shairplay/src/lib
$CC -O2 -s -static -Wno-incompatible-pointer-types -Wno-int-conversion -DWIN32 -D_WIN32_WINNT=0x0601 -I shairplay/include -I shairplay/include/shairplay -I $L -I $L/crypto -I $L/alac -I $L/curve25519 -I $L/ed25519 \
  "$here/receivers/wavwiz-airplay.c" \
  $L/base64.c $L/digest.c $L/http_parser.c $L/http_request.c $L/http_response.c $L/httpd.c $L/logger.c $L/netutils.c $L/raop.c $L/raop_buffer.c \
  $L/raop_rtp.c $L/rsakey.c $L/rsapem.c $L/sdp.c $L/aes_ctr.c $L/pairing.c $L/utils.c $L/fairplay_dummy.c $L/plist.c \
  $L/crypto/bigint.c $L/crypto/aes.c $L/crypto/hmac.c $L/crypto/md5.c $L/crypto/rc4.c $L/crypto/sha1.c $L/alac/alac.c $L/curve25519/curve25519-donna.c \
  $L/ed25519/add_scalar.c $L/ed25519/fe.c $L/ed25519/ge.c $L/ed25519/keypair.c $L/ed25519/sc.c $L/ed25519/seed.c $L/ed25519/sha512.c $L/ed25519/sign.c $L/ed25519/verify.c \
  -o "$out/bin/wavwiz-airplay.exe" -lws2_32 -lwinmm -ladvapi32
cp shairplay/airport.key "$out/bin/airport.key"
git -C shairplay archive --format=tar.gz --prefix=shairplay-$SHAIRPLAY_COMMIT/ -o "$out/source/shairplay-$SHAIRPLAY_COMMIT.tar.gz" HEAD
cp shairplay/LICENSE "$out/source/shairplay-LICENSE.txt"
$CC -O2 -s -static "$here/receivers/wavwiz-hook.c" -o "$out/bin/wavwiz-hook.exe" -lws2_32

[ -d librespot ] || git clone -q https://github.com/librespot-org/librespot.git
git -C librespot fetch -q --tags || true; git -C librespot checkout -q -f "$LIBRESPOT_TAG"; git -C librespot archive --format=tar.gz --prefix=librespot-$LIBRESPOT_TAG/ -o "$out/source/librespot-$LIBRESPOT_TAG.tar.gz" HEAD
export RUSTUP_HOME="${RUSTUP_HOME:-$cache/../rustup}" CARGO_HOME="${CARGO_HOME:-$cache/../cargo}"; export PATH="$CARGO_HOME/bin:$PATH"
export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc
( cd librespot && cargo fetch -q --target x86_64-pc-windows-gnu )
# libmdns (MIT) patched: zeroconf keeps working when one adapter (VPN/virtual) refuses the multicast join (upstream TODO); see receivers/libmdns-join-any.py
src=$(ls -d "$CARGO_HOME"/registry/src/*/libmdns-0.10.1 | head -1); rm -rf libmdns-patched; cp -r "$src" libmdns-patched
python3 "$here/receivers/libmdns-join-any.py" libmdns-patched/src/address_family.rs
python3 "$here/receivers/librespot-zeroconf-nonfatal.py" librespot/discovery/src/lib.rs   # tree is re-checked-out each build
git -C librespot diff > "$out/source/librespot-wavwiz.patch"
( cd librespot && cargo build --release --target x86_64-pc-windows-gnu --no-default-features --features "native-tls,with-libmdns" --config "patch.crates-io.libmdns.path=\"$cache/libmdns-patched\"" )
tar czf "$out/source/libmdns-0.10.1-wavwiz-patched.tar.gz" libmdns-patched
cp librespot/target/x86_64-pc-windows-gnu/release/librespot.exe "$out/bin/librespot.exe"
x86_64-w64-mingw32-strip "$out/bin/librespot.exe" || true
cp librespot/LICENSE "$out/source/librespot-LICENSE.txt"
echo "shairplay $SHAIRPLAY_COMMIT; librespot $LIBRESPOT_TAG" > "$out/VERSIONS.txt"
ls -l "$out/bin"
