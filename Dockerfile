# F166/F167: WavWiz server (headless) for Linux. Multi-arch: linux/amd64, linux/arm64.
#   docker build -t docker.io/vdubbin74/wavwiz-server:0.6.6 .
#   docker buildx build --platform linux/amd64,linux/arm64 -t docker.io/vdubbin74/wavwiz-server:0.6.6 .
# See docs/DOCKER.md. Server only (no Player audio in the container).

# ---- build (runs on the build machine's own arch; cross-publishes for the target) ----
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG TARGETARCH
WORKDIR /src
COPY global.json Directory.Build.props ./
COPY src/WavWiz.Core/ src/WavWiz.Core/
COPY src/WavWiz.Dsp/ src/WavWiz.Dsp/
COPY src/WavWiz.Measure/ src/WavWiz.Measure/
COPY src/WavWiz.Server/ src/WavWiz.Server/
RUN case "$TARGETARCH" in amd64) RID=linux-x64;; arm64) RID=linux-arm64;; *) echo "unsupported arch $TARGETARCH"; exit 1;; esac \
 && dotnet publish src/WavWiz.Server/WavWiz.Server.csproj -c Release -r $RID --self-contained false \
      -p:DebugType=none -o /app

# ---- runtime ----
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 wavwiz \
 && useradd --system --uid 10001 --gid wavwiz --home-dir /data --shell /usr/sbin/nologin wavwiz \
 && mkdir -p /data /music && chown wavwiz:wavwiz /data
COPY --from=build /app /opt/wavwiz-server
ENV WAVWIZ_DATA=/data \
    WAVWIZ_BIND=0.0.0.0 \
    WAVWIZ_ALLOW_ALL_INTERFACES=1 \
    WAVWIZ_HEADLESS=1 \
    WAVWIZ_FFMPEG=/usr/bin/ffmpeg \
    WAVWIZ_HTTP_PORT=47800 \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1
VOLUME ["/data"]
# HTTP 47800, HTTPS 47443, audio 47801, clock 47802/udp, discovery 47803/udp, AirPlay 47804, Spotify 47805, mDNS 5353/udp
EXPOSE 47800/tcp 47443/tcp 47801/tcp 47802/udp 47803/udp 47804/tcp 47805/tcp 5353/udp
USER wavwiz
WORKDIR /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${WAVWIZ_HTTP_PORT}/api/v1/discover" >/dev/null || exit 1
LABEL org.opencontainers.image.title="WavWiz server" \
      org.opencontainers.image.source="https://github.com/vdubbin74/WavWiz" \
      org.opencontainers.image.version="0.6.6" \
      org.opencontainers.image.licenses="MIT"
ENTRYPOINT ["dotnet", "/opt/wavwiz-server/wavwiz-server.dll"]
