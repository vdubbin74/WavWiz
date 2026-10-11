# First run (plain language)

This guide is for people who downloaded a **Windows installer** from [GitHub Releases](https://github.com/vdubbin74/WavWiz/releases). More product background: [wavwiz.com](https://wavwiz.com).

WavWiz is in **public beta**. SmartScreen may warn because the installer is not code-signed yet—only continue if you got the file from the official Releases page.

## 1. Pick Server vs Player

| Component | Install on | What it does |
| --- | --- | --- |
| **WavWiz Server** | One always-on Windows PC that holds (or can reach) your music | Windows service + web UI; library, queue, AirPlay speaker, optional Spotify Connect |
| **WavWiz Player** | Every Windows PC that has speakers you want in the sync (can be the same PC as the server) | Tray app; plays the house stream in sync |

Phones and tablets do **not** need an app: open the server’s web page in the browser on your Wi-Fi.

## 2. Use a Private network profile

On the server PC (and ideally player PCs), Windows should treat your home Wi-Fi/Ethernet as a **Private** network, not Public.

- Private: discovery, firewall rules, and AirPlay / Spotify Connect visibility work as designed.
- Public: Windows may block the ports WavWiz needs; devices may not find each other.

In the installer, keep the suggested **home-network address**. Do **not** bind the server to “all interfaces” unless you know exactly why you need that (unsupported for typical home use).

If the PC’s address changes later (new router, new adapter), open **Settings → Network → Home network**: it shows whether Windows sees the network as Private or Public, can re-detect the address, and switches WavWiz to the new one.

## 3. Set the administrator password

After Server install, open the WavWiz web page (shortcut or the address the wizard shows).

1. Choose a strong **administrator password** when prompted.
2. You will need it for Settings that change the house (library folders, network options, Spotify Connect, and so on).
3. Ordinary listening from phones can use pairing / normal access without giving everyone the admin password.
4. On a paired device you can switch to admin at any time with **File → Sign in as admin…** (no sign-out, no new pairing code); **File → Leave admin mode** switches back. An **Admin** chip shows while it is on. Admin-only items stay visible but read-only for everyone else.

A short **Getting started** guide opens on first run; reopen it any time from **Help → Getting started**.

If you forget the admin password, use the **password reset** path documented for your version (reset on the **server PC only**; your music library files stay put).

## 4. Add music folders

In **File → Settings… → Library → Music folders**:

1. Add the folder(s) where your files live (local disks are simplest).
2. Let WavWiz scan; browse by artist / album / genre / folders.
3. Music on a NAS or another PC that asks for a user name and password: save the login under **Settings → Library → Network share logins (NAS)** first, then add the folder (for example `\\NAS\Music`). The password is encrypted by Windows for the WavWiz service and never shown again.
4. **Volume leveling (ReplayGain)** is set to Automatic by default and uses the ReplayGain or R128 tags in your files; songs without tags play unchanged.

Internet radio and optional CD ripping are separate tools inside the app—they do not replace adding your library folders.

## 5. Pair players and phones

- **Player PCs:** install Player; it usually finds the server. If asked, type the 6-digit code from **Settings → Devices → Pair a phone or a PC player** (or **Devices → Pair a player…**).
- **Phones and browsers:** open the server's address on the same Wi-Fi and complete pairing if prompted. Every browser that opens WavWiz joins as a speaker by itself, with a readable name such as "Chrome on Windows". Sound on iPhone often needs a first tap to unlock audio.
- **Removing a device:** **Settings → Devices → Paired devices & tokens → Revoke** (or **Forget device…** in a device card's settings) removes it from the Devices list on every open page right away; it has to pair again to come back.

## 6. Devices, zones and delay

- **Devices → Devices & zones** opens the expanded Devices view. **Master volume** and **Mute all** sit at the top; every speaker has its own volume, Mute and on/off switch. The volume and Mute on the Now Playing panel control only the device you are using.
- **Zones** are optional groups (for example "Downstairs"): pick one in the zones sidebar to filter the cards, or edit it in place.
- In the **Expanded** Devices view, each device card has a **Settings** button with an arrow. It opens that device's settings right under the card: **Set delay by ear**, **Test sound**, the exact delay, **Sound / EQ…**, its audio output, connection details, **Rename…**, **Set as reference** and **Forget device…**. Click it again or press **Esc** to close. The normal (Standard) Devices list only has name, status, volume, Mute and on/off: tap a device's name there to open the Expanded view with that device's card highlighted.
- Use **per-device delay (0–1000 ms)** if Bluetooth speakers lag behind other rooms. On PCs the delay is kept per audio output.

### Calibrate with your phone

**Devices → Calibrate speakers…** measures each speaker's delay with a phone microphone. The music pauses while it measures and resumes afterwards, and it waits for you to walk to the next speaker.

1. A phone only allows its microphone on a trusted HTTPS page. Once, as admin, open **Settings → Devices → Phone & HTTPS → Set up HTTPS**, then scan the QR code with each phone and follow the steps to install WavWiz's certificate (about two minutes).
2. In Calibrate speakers, use **Use your phone as the microphone**: scan the QR code (or type the short link) on the phone and follow the numbered steps. The line under it shows when the phone is connected. Links expire after 20 minutes.
3. A link made by an administrator also signs the phone in and lets it calibrate every speaker; other users can calibrate only their own device.

## 7. Settings and appearance

Menus do things, Settings sets things:

- **File:** Settings…, Sign in as admin… / Leave admin mode, Sign out
- **Library:** Browse library (opens the Expanded library), Playlists, Queue, Rescan folders, plus admin tools (Tidy up library, Tag & cover fix…, CD ripper…)
- **Playback:** Play / Pause, Next, Previous, Internet radio, Sound / EQ…
- **Devices:** Devices & zones, Scenes, Schedules, Calibrate speakers…, Pair a player…, Away-from-home…
- **Help:** Getting started, Diagnostics, What's new, About WavWiz…

**Settings** has four tabs: **Appearance**, **Devices**, **Library** and **Network**. Appearance has its own sub-pages: **Theme**, **Visualizer**, **EQ**, **Now Playing** and **Display size**. The live previews on Theme, Visualizer, EQ and Now Playing stay pinned at the top while you scroll; Display size has no preview because the whole app changes as you pick. Appearance choices apply to the device you are using.

**Lock EQ:** the Sound (EQ) window and **Appearance → EQ** have a **Lock EQ** checkbox. When it is checked, the EQ sliders ignore the mouse wheel, dragging, clicks and keys, so scrolling the page never changes the sound. Each device remembers it (off by default; unlocked, the wheel fine-tunes a slider in 0.5 dB steps). **Appearance → EQ** shows this speaker's real EQ and always opens locked; uncheck it to make changes, which are saved to the speaker's own preset.

## 8. AirPlay tip (VPN / isolation)

AirPlay discovery uses your **local** network (multicast / mDNS). Many **VPN** clients, “kill switches,” or “network isolation” modes hide LAN devices.

If **WavWiz – Whole House** does not appear on iPhone, iPad, or Mac:

1. Confirm the phone/Mac is on the **same home Wi-Fi** as the server (not guest Wi-Fi).
2. Pause or disconnect the **VPN** (or allow LAN access in the VPN app).
3. Confirm Windows network is **Private** and WavWiz Server is running.
4. Retry AirPlay from Control Center / the app’s AirPlay icon.
5. Still stuck? Open **Help → Diagnostics** and use **Restart AirPlay** (and **Clear orphans** if it lists leftover receiver processes).

AirPlay is built in for this beta; WavWiz is **not** affiliated with Apple. AirPlay is a trademark of Apple Inc.

## 9. Spotify Connect (optional, Premium)

Spotify Connect is **off by default**.

1. Sign in to Spotify on your phone with **Spotify Premium** (required).
2. In WavWiz, as admin, turn on **Spotify Connect** in **Settings → Network → AirPlay & Spotify Connect**.
3. Choose WavWiz in Spotify’s device list; audio should play through the house sync pipeline.

This uses an **unofficial** open-source client. WavWiz does not store your Spotify password. Spotify is a trademark of Spotify AB; WavWiz is not affiliated with Spotify.

## 10. When something goes wrong

Open **Help → Diagnostics** in the app, copy the text, and include it with your version and OS in a [GitHub Issue](https://github.com/vdubbin74/WavWiz/issues). See [SUPPORT.md](../SUPPORT.md).

Security problems: email **vdubbin74@proton.me** only — see [SECURITY.md](../SECURITY.md).
