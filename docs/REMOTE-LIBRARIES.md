# Remote libraries (Subsonic / OpenSubsonic)

WavWiz can play music from a **Subsonic-compatible server** such as **Navidrome** (primary target), Airsonic-Advanced, Gonic or Funkwhale.

**WavWiz is the client, not a Subsonic server.** It browses the server and streams songs to your speakers; other Subsonic apps cannot connect to WavWiz.

## Add a server (admin)
1. Settings → Library → **Remote libraries**.
2. Address: e.g. `http://192.168.1.20:4533` (Navidrome's default port is 4533; a trailing `/rest` is fine).
3. User name and password of your Navidrome account; optional label (e.g. "NAS").
4. **Connect & save** — WavWiz pings the server first and only saves a working login.

The password is encrypted with Windows DPAPI for the WavWiz service on this PC (same as NAS share logins) and is never returned by the API. Login uses the Subsonic token (`t = md5(password + salt)`, fresh salt per request); servers that refuse tokens fall back to the legacy hex password automatically.

## Browse and play
Library → **Remote** (in the ⋯ menu): Albums A–Z, Newest, Artists, and the filter box searches the server (`search3`). Tap a song or ▶ on an album to play; songs stream through ffmpeg like radio but are seekable. Covers come from `getCoverArt` and are cached under the data folder (`artcache/remote`).

## Offline
If the server is unreachable its row is dimmed with the reason; the local library is never changed or rescanned. Saved queues keep remote songs (`subsonic:{server}:{song}`, no secret) and the stream link is created again at play time.

Not included yet: ratings/stars write-back, scrobbling, two-way playlist sync.
