#!/usr/bin/env bash
# Reproducible LGPL-only FFmpeg for WavWiz (Windows x64, shared DLLs).
# NO --enable-gpl / --enable-nonfree. FFmpeg's libcdio demuxer is GPL-gated, so CDDA
# uses a separate LGPL helper (build/cdda-helper) built from libcdio — not linked into FFmpeg.
# 0.0.5: also builds Chromaprint fpcalc (after FFmpeg) for AcoustID.
set -euo pipefail
VER=8.1.3
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${1:-${WAVWIZ_TOOLS_CACHE:-$HERE/../.cache}/ffmpeg-lgpl}
mkdir -p "$WORK"; cd "$WORK"
[ -n "${WAVWIZ_MAKE_DIR:-}" ] && export PATH="$WAVWIZ_MAKE_DIR:$PATH"
command -v make >/dev/null || { echo "GNU make required"; exit 2; }
command -v x86_64-w64-mingw32-gcc >/dev/null || { echo "mingw-w64 gcc required"; exit 2; }
HOST=x86_64-w64-mingw32
TAR=ffmpeg-$VER.tar.xz
[ -f "$TAR" ] || curl -fL --retry 3 -o "$TAR" "https://ffmpeg.org/releases/$TAR"
GOT=$(sha256sum "$TAR" | cut -d' ' -f1)
if [ -f "$HERE/ffmpeg-lgpl.sha256" ]; then WANT=$(cut -d' ' -f1 "$HERE/ffmpeg-lgpl.sha256"); [ "$GOT" = "$WANT" ] || { echo "SHA-256 mismatch for $TAR"; exit 3; }; fi
echo "$GOT  $TAR" > "$WORK/$TAR.sha256"
mkdir -p "$WORK/deps"
export PKG_CONFIG_PATH="$WORK/deps/lib/pkgconfig"
export PKG_CONFIG_LIBDIR="$WORK/deps/lib/pkgconfig"

ZV=1.3.1; ZSHA=9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23; ZTAR=zlib-$ZV.tar.gz
[ -f "$ZTAR" ] || curl -fL --retry 3 -o "$ZTAR" "https://github.com/madler/zlib/releases/download/v$ZV/$ZTAR"
echo "$ZSHA  $ZTAR" | sha256sum -c -
rm -rf zsrc zout; mkdir zsrc zout; tar xzf "$ZTAR" -C zsrc
( cd zsrc/zlib-$ZV && CC=$HOST-gcc AR=$HOST-ar RANLIB=$HOST-ranlib ./configure --static --prefix="$WORK/zout" >/dev/null && make -j"$(nproc)" >/dev/null && make install >/dev/null )
mkdir -p "$WORK/zout/lib/pkgconfig"

# ---- libcdio + paranoia (for standalone CDDA helper ONLY; not linked into FFmpeg) ----
CDIO_V=2.1.0; CDIO_TAR=libcdio-$CDIO_V.tar.bz2
CDIO_SHA=8550e9589dbd594bfac93b81ecf129b1dc9d0d51e90f9696f1b2f9b2af32712b
[ -f "$CDIO_TAR" ] || curl -fL --retry 3 -o "$CDIO_TAR" "https://ftp.gnu.org/gnu/libcdio/$CDIO_TAR"
echo "$CDIO_SHA  $CDIO_TAR" | sha256sum -c -
if [ ! -f "$WORK/deps/lib/pkgconfig/libcdio.pc" ]; then
  rm -rf cdio-src; mkdir cdio-src; tar xjf "$CDIO_TAR" -C cdio-src
  ( cd cdio-src/libcdio-$CDIO_V && ./configure --host=$HOST --prefix="$WORK/deps" --disable-cddb --disable-vcd-info --disable-example-progs --enable-shared --disable-static \
      CC=$HOST-gcc CXX=$HOST-g++ AR=$HOST-ar RANLIB=$HOST-ranlib >/dev/null && make -j"$(nproc)" >/dev/null && make install >/dev/null )
fi
PARA_TAR=libcdio-paranoia-10.2+2.0.1.tar.bz2
[ -f "$PARA_TAR" ] || curl -fL --retry 3 -o "$PARA_TAR" "https://ftp.gnu.org/gnu/libcdio/$PARA_TAR"
sha256sum "$PARA_TAR" | tee "$WORK/$PARA_TAR.sha256"
if [ ! -f "$WORK/deps/lib/pkgconfig/libcdio_paranoia.pc" ]; then
  rm -rf para-src; mkdir para-src; tar xjf "$PARA_TAR" -C para-src
  PARA_DIR=$(echo para-src/libcdio-paranoia-*)
  ( cd $PARA_DIR && ./configure --host=$HOST --prefix="$WORK/deps" --enable-shared --disable-static \
      CC=$HOST-gcc CXX=$HOST-g++ AR=$HOST-ar RANLIB=$HOST-ranlib \
      CPPFLAGS="-I$WORK/deps/include" LDFLAGS="-L$WORK/deps/lib" \
      >/dev/null && make -j"$(nproc)" >/dev/null && make install >/dev/null )
fi

# ---- FFmpeg (LGPL only — deliberately WITHOUT --enable-libcdio) ----
rm -rf src out; mkdir src out
python3 - <<PY
import tarfile; tarfile.open("$TAR").extractall("src")
PY
cd src/ffmpeg-$VER
./configure --prefix="$WORK/out" --enable-cross-compile --cross-prefix=${HOST}- --arch=x86_64 --target-os=mingw32 \
  --enable-shared --disable-static --disable-debug --disable-doc --disable-autodetect --disable-x86asm \
  --disable-programs --enable-ffmpeg --disable-avdevice --enable-network \
  --disable-encoders --enable-encoder=mjpeg,pcm_f32le,pcm_s16le,pcm_s24le,flac,aac \
  --disable-muxers --enable-muxer=image2pipe,mjpeg,pcm_f32le,pcm_s16le,pcm_s24le,wav,null,flac,adts,ipod,mp4 \
  --disable-filters --enable-filter=scale,format,aresample,aformat,anull,null,buffer,buffersink,abuffer,abuffersink,atrim,trim,asetpts,setpts \
  --disable-protocols --enable-protocol=file,pipe,http,https,tcp,tls,crypto,hls,cache,data,subfile,icecast \
  --disable-hwaccels --disable-bsfs --enable-bsf=aac_adtstoasc,null,extract_extradata,mp3_header_decompress,noise,vp9_superframe \
  --enable-schannel --enable-zlib \
  --extra-cflags="-I$WORK/zout/include" --extra-ldflags="-static-libgcc -L$WORK/zout/lib" \
  --extra-version=wavwiz-lgpl 2>&1 | tee "$WORK/configure.log"
grep -q -- '--enable-gpl\|--enable-nonfree\|--enable-libcdio\|--enable-version3' "$WORK/configure.log" && { echo "REFUSING non-LGPL configure"; exit 4; } || true
make -j"$(nproc)" 2>&1 | tee "$WORK/make.log" | tail -8
make install 2>&1 | tail -2
cd "$WORK"
cp src/ffmpeg-$VER/COPYING.LGPLv3 src/ffmpeg-$VER/COPYING.LGPLv2.1 src/ffmpeg-$VER/LICENSE.md out/
mkdir -p out/bin

# ---- standalone CDDA helper (LGPL libcdio; separate from FFmpeg) ----
$HOST-gcc -O2 -Wall -I"$WORK/deps/include" "$HERE/cdda-helper.c" -o out/bin/wavwiz-cdda.exe \
  -L"$WORK/deps/lib" -lcdio_paranoia -lcdio_cdda -lcdio -static-libgcc
for d in "$WORK/deps/bin"/*.dll; do [ -f "$d" ] && cp -n "$d" out/bin/ || true; done

# ---- chromaprint fpcalc (after FFmpeg) ----
CH_V=1.5.1; CH_TAR=chromaprint-$CH_V.tar.gz
[ -f "$CH_TAR" ] || curl -fL --retry 3 -o "$CH_TAR" "https://github.com/acoustid/chromaprint/releases/download/v$CH_V/$CH_TAR"
sha256sum "$CH_TAR" | tee "$WORK/$CH_TAR.sha256"
rm -rf ch-src ch-build; mkdir ch-src ch-build
tar xzf "$CH_TAR" -C ch-src
if command -v cmake >/dev/null; then
  set +e
  cmake -S ch-src/chromaprint-$CH_V -B ch-build \
    -DCMAKE_SYSTEM_NAME=Windows -DCMAKE_C_COMPILER=$HOST-gcc -DCMAKE_CXX_COMPILER=$HOST-g++ \
    -DCMAKE_INSTALL_PREFIX="$WORK/deps" -DBUILD_TOOLS=ON -DBUILD_TESTS=OFF -DFFT_LIB=kissfft \
    -DFFMPEG_ROOT="$WORK/out" \
    -DCMAKE_FIND_ROOT_PATH="$WORK/out;$WORK/deps" \
    -DCMAKE_FIND_ROOT_PATH_MODE_LIBRARY=BOTH -DCMAKE_FIND_ROOT_PATH_MODE_INCLUDE=BOTH \
    -DCMAKE_SHARED_LIBRARY_LINK_C_FLAGS="-static-libgcc" \
    -DCMAKE_SHARED_LIBRARY_LINK_CXX_FLAGS="-static-libgcc -static-libstdc++" \
    > "$WORK/chromaprint-cmake.log" 2>&1
  cmake --build ch-build -j"$(nproc)" > "$WORK/chromaprint-build.log" 2>&1
  cmake --install ch-build >/dev/null 2>&1
  for f in "$WORK/deps/bin"/fpcalc.exe "$WORK/deps/bin"/fpcalc "$WORK/deps/bin"/libchromaprint*.dll; do
    [ -f "$f" ] && cp "$f" out/bin/ || true
  done
  if [ -f out/bin/fpcalc.exe ] || [ -f out/bin/fpcalc ]; then echo "chromaprint fpcalc OK"; else echo "WARN: fpcalc not built"; fi
  set -e
fi

mkdir -p out/deps-lic
cp cdio-src/libcdio-$CDIO_V/COPYING* out/deps-lic/ 2>/dev/null || true
cp para-src/libcdio-paranoia-*/COPYING* out/deps-lic/ 2>/dev/null || true
cp ch-src/chromaprint-$CH_V/LICENSE.md out/deps-lic/CHROMAPRINT-LICENSE.md 2>/dev/null || true
grep -m1 '^#define FFMPEG_CONFIGURATION' src/ffmpeg-$VER/config.h | sed 's/^#define FFMPEG_CONFIGURATION "//; s/"$//; s/\\"/"/g' > out/CONFIGURE-LINE.txt
( cd out/bin && sha256sum *.exe *.dll 2>/dev/null ) > out/FILES.sha256
grep -q -- '--enable-gpl\|--enable-nonfree\|--enable-libcdio\|--enable-version3' out/CONFIGURE-LINE.txt && { echo "REFUSING: non-LGPL ffmpeg"; cat out/CONFIGURE-LINE.txt; exit 4; } || true
test -f out/bin/wavwiz-cdda.exe || { echo "REFUSING: wavwiz-cdda.exe missing"; exit 5; }
cp "$TAR" out/; cp "zlib-$ZV.tar.gz" out/; cp "$CDIO_TAR" out/; cp "$PARA_TAR" out/; cp "$CH_TAR" out/ 2>/dev/null || true
cp "$HERE/cdda-helper.c" out/
echo "done: $WORK/out"
ls out/bin | head -40
cat out/CONFIGURE-LINE.txt

# Official AcoustID Windows fpcalc (static LGPL) if in-tree build against FFmpeg 8 failed
if [ ! -f out/bin/fpcalc.exe ]; then
  FPCALC_ZIP=chromaprint-fpcalc-1.5.1-windows-x86_64.zip
  [ -f "$FPCALC_ZIP" ] || curl -fL --retry 3 -o "$FPCALC_ZIP" "https://github.com/acoustid/chromaprint/releases/download/v1.5.1/$FPCALC_ZIP"
  rm -rf fpcalc-extract; mkdir fpcalc-extract
  python3 -c "import zipfile; zipfile.ZipFile('$FPCALC_ZIP').extractall('fpcalc-extract')"
  find fpcalc-extract -name fpcalc.exe -exec cp {} out/bin/fpcalc.exe \;
  test -f out/bin/fpcalc.exe && echo "fpcalc from AcoustID release OK" || echo "WARN: fpcalc still missing"
fi
