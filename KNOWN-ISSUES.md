# Known issues

WavWiz is in public beta. These are the open issues we know about in the current release (0.7.2). Please report anything else via [GitHub Issues](https://github.com/vdubbin74/WavWiz/issues).

- **Docker Desktop on Windows (bridge mode):** on an iPhone, the Sign in page may just reload after you tap **Pair** or **Administrator**. Use the Windows app server for now (a fix is planned).
- **No Linux Player app yet:** Linux and Raspberry Pi run the WavWiz server only. To hear music, pair a Windows Player, a phone or browser, or Cast / AirPlay speakers (a Linux Player is planned for 0.8.0).
- **Capturing a PC's sound or mic** (Real time / Sync with WavWiz) needs the WavWiz Player on Windows 10 version 2004 or later.
- **Phone-mic calibration on an iPhone** is still in testing; calibrating with the PC's microphone is recommended.
- **Raspberry Pi (arm64):** the Docker image and tarball are not yet verified on real Raspberry Pi hardware, including playback through the Pi's own headphone jack, HDMI or USB DAC.
- **Smart-TV browsers** are still in testing, and older LG webOS sets don't finish loading yet; for now use a PC or laptop connected to the TV.

The Windows installer is not code-signed yet, so SmartScreen may warn on first run (see the [README](README.md)).
