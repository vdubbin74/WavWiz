# Third-party software (summary)

WavWiz itself is MIT-licensed ([LICENSE](../LICENSE)). It bundles or ships alongside other components that keep **their own** licenses and copyrights.

The authoritative list for a given build is:

**[THIRD-PARTY-NOTICES.txt](../THIRD-PARTY-NOTICES.txt)**

That file is also installed next to the program (under `licenses/` with full license texts and, where required, corresponding source offers). See also the short [NOTICE](../NOTICE) at the repository root.

## High-level map

| Component | Role | License (summary) | Notes |
| --- | --- | --- | --- |
| **FFmpeg** | Decode (and limited encode for CD rip helpers) | **LGPL** v2.1+ | Project builds an **LGPL-only** shared Windows build (no `--enable-gpl` / nonfree). Replaceable DLLs; source offer / build notes ship with the install. FFmpeg is a trademark of Fabrice Bellard; WavWiz is not endorsed by the FFmpeg project. |
| **shairplay** (+ small WavWiz front end) | AirPlay receiver (`wavwiz-airplay.exe`) | **LGPL** (+ MIT/BSD/zlib parts in shairplay) | Runs as a **separate program**, not linked into the main WavWiz binary. AirPlay is a trademark of Apple Inc.; WavWiz is not affiliated with Apple. |
| **librespot** | Optional Spotify Connect (`librespot.exe`) | **MIT** | Unofficial Spotify Connect client; **not** made or endorsed by Spotify. Requires the listener’s own **Spotify Premium** account. Separate process. Spotify is a trademark of Spotify AB. |
| **TagLib#** | Tags / cover art | **LGPL** v2.1 | Unmodified separate DLL. |
| **NAudio**, **QRCoder**, **.NET** bits, etc. | Playback, pairing, runtime | Mostly **MIT** / Microsoft terms | Listed in `THIRD-PARTY-NOTICES.txt`. |
| **Nunito** | Wordmark / UI font derivation | **SIL OFL 1.1** | See notices. |
| **Debian FFmpeg** (Docker only) | Decode in Linux image | **GPL** (Debian build) | apt package, separate program; differs from the Windows LGPL-only build. |
| **Navidrome / Subsonic / OpenSubsonic** | Remote libraries (client) | n/a – no code bundled | WavWiz speaks the API only. Not affiliated. |
| **Home Assistant** | Automation via REST | n/a – no code bundled | Not affiliated. |

Other optional or helper pieces (for example libcdio for CDDA, Chromaprint/fpcalc) are described in the full notices file when present in that build.

## What this means for you

- You may use WavWiz under the MIT terms in `LICENSE`.
- LGPL components remain under LGPL: you can replace the shared libraries / separate receiver builds with your own, as described in the shipped notices and source offer.
- Do not remove attribution or license files from redistributed builds.
- Trademark names (AirPlay, Spotify, FFmpeg, Navidrome, Subsonic, Home Assistant, Tailscale, and others) belong to their owners; WavWiz claims **no affiliation**.

If `THIRD-PARTY-NOTICES.txt` is missing from a checkout, restore it from the release artifacts or the `licenses/` folder of an official install before redistributing.
