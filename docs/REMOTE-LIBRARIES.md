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
Library **source tabs** at the top (above search) are **Local | Remote | Radio | Playlists** (F235/F239). Pick **Remote**, then (with two or more servers) the **server chip** on the tools row next to Sort — themed dropdown, never a native `<select>`. One server is selected automatically (chip hidden); zero servers shows an empty state that points to Settings → Library → Remote libraries. Remote categories: **Artists · Albums · Recently added** (Newest). Favorites / Folders stay under Local; Radio and Playlists are their own sources (not category tabs). The filter box searches the selected server (`search3`). Tap a song or ▶ on an album to play; songs stream through ffmpeg like radio but are seekable. Covers come from `getCoverArt` and are cached under the data folder (`artcache/remote`).

Older builds put each remote library on its own top tab (`rs:{id}` named by label). That is gone — sources + server chip replace it.

## Offline
If the server is unreachable the server chip is dimmed and browse shows the error; the local library is never changed or rescanned. Saved queues keep remote songs (`subsonic:{server}:{song}`, no secret) and the stream link is created again at play time.

**Drag to queue (F175):** drag remote albums and songs onto the queue (body or header strip) to drop them at that spot. The queue is WavWiz's own, so local and remote songs (from any server) intermix in one list; Navidrome's play queue is never used. Remote songs can't go into WavWiz playlists yet.

**Queue source pills (F176):** in a mixed queue every row shows a small pill before the title: **Local**, the remote server's name (e.g. **Navidrome**; **Remote** if that server was removed), or **Radio**.

Not included yet: ratings/stars write-back, scrobbling, two-way playlist sync.

---

*Navidrome and Subsonic are trademarks of their owners; thanks to the Navidrome and OpenSubsonic projects. WavWiz is not affiliated with them.*
