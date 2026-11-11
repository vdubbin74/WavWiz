// 0.7.0 Raspberry Pi / linux-arm64 packaging: the build files and docs stay consistent (no hardware here; see docs/RASPBERRY-PI.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
const R = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('0.7.0 Pi: Dockerfile cross-builds amd64 + arm64 from the build CPU; runtime is the multi-arch aspnet:10.0; APT_HTTPS is opt-in', () => {
  const d = R('Dockerfile');
  assert.match(d, /FROM --platform=\$BUILDPLATFORM mcr\.microsoft\.com\/dotnet\/sdk:10\.0 AS build/);
  assert.match(d, /amd64\) RID=linux-x64;; arm64\) RID=linux-arm64;;/);
  assert.match(d, /FROM mcr\.microsoft\.com\/dotnet\/aspnet:10\.0 AS runtime/);
  assert.match(d, /ARG APT_HTTPS=0/);
  assert.match(d, /network_mode|5353\/udp/);
  assert.match(R('src/WavWiz.Server/WavWiz.Server.csproj'), /<RuntimeIdentifiers>[^<]*linux-arm64/);
});

test('0.7.0 Pi: the tarball carries install.sh + the systemd unit; install.sh refuses 32-bit Pi OS and never touches /var/lib/wavwiz data', () => {
  const p = R('build/publish-linux.sh'), i = R('build/linux/install.sh'), u = R('build/linux/wavwiz-server.service');
  assert.match(p, /install -m 0755 build\/linux\/install\.sh "\$dest\/install\.sh"/);
  assert.match(p, /sha256sum/);
  assert.ok(statSync(new URL('../../build/linux/install.sh', import.meta.url)).mode & 0o100, 'install.sh is executable');
  assert.match(i, /32-bit Raspberry Pi OS is not supported/);
  assert.match(i, /b700\) want=aarch64;; 3e00\) want=x86_64;;/);
  assert.match(i, /--uninstall/); assert.doesNotMatch(i, /rm -rf "?\$DATA/);
  assert.match(u, /Environment=WAVWIZ_HEADLESS=1/); assert.match(u, /ReadWritePaths=\/var\/lib\/wavwiz/);
  assert.match(u, /#AmbientCapabilities=CAP_NET_BIND_SERVICE/);
});

test('0.7.0 Pi: docs are honest — unverified on real hardware, not published, 32-bit unsupported; CHANGELOG has 0.7.0', () => {
  const pi = R('docs/RASPBERRY-PI.md');
  assert.match(pi, /not yet verified on real Raspberry Pi hardware/);
  assert.match(pi, /32-bit Raspberry Pi OS is not supported/);
  assert.match(pi, /avahi-daemon/);
  assert.match(R('docs/DOCKER.md'), /not on Docker Hub yet/);
  assert.match(R('docs/LINUX.md'), /RASPBERRY-PI\.md/);
  assert.match(R('CHANGELOG.md'), /## \[0\.7\.0\] - in development[\s\S]*Raspberry Pi[\s\S]*## \[0\.6\.8\]/);
});
