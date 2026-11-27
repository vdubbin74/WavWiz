# Known issues

WavWiz is in public beta. These are the open issues we know about in the current release (0.7.3). Please report anything else via [GitHub Issues](https://github.com/vdubbin74/WavWiz/issues).

- **iPhone sign-in on the Docker server** (the Sign in page reloaded after **Pair** or **Administrator**) is fixed in 0.7.3 (the sign-in cookie is SameSite=Lax now; see [docs/DOCKER.md](docs/DOCKER.md)). It has not been re-checked on a real iPhone against a Docker server yet; please report it if it still happens.
- **No Linux Player app yet:** Linux and Raspberry Pi run the WavWiz server only. To hear music, pair a Windows Player, a phone or browser, or Cast / AirPlay speakers (a Linux Player is planned for 0.8.0).
- **Audio inputs** (This PC · Speakers, Aux in, S/PDIF in, microphones) come only from the WavWiz Player running on the Windows server PC; a Player on another PC, and Linux / Docker servers, have none yet. Echo-free capture of the PC's sound needs Windows 10 version 2004 or later; older Windows records the whole speaker device and refuses while WavWiz plays through those speakers. Every zone hears a live input about 1.4 s after the source. See [docs/AUDIO-INPUTS.md](docs/AUDIO-INPUTS.md).
- **Phone-mic calibration on an iPhone** is still in testing; calibrating with the PC's microphone is recommended.
- **Raspberry Pi (arm64):** the Docker image and tarball are not yet verified on real Raspberry Pi hardware, including playback through the Pi's own headphone jack, HDMI or USB DAC.
- **Smart-TV browsers** are still in testing, and older LG webOS sets don't finish loading yet; for now use a PC or laptop connected to the TV.

The Windows installer is not code-signed yet, so SmartScreen may warn on first run (see the [README](README.md)).
