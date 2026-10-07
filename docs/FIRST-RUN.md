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

If you forget the admin password, use the **password reset** path documented for your version (reset on the **server PC only**; your music library files stay put).

## 4. Add music folders

In **Settings → Library** (wording may vary slightly by beta):

1. Add the folder(s) where your files live (local disks are simplest).
2. Let WavWiz scan; browse by artist / album / genre / folders.
3. Music on a NAS or another PC that asks for a user name and password: save the login under **Settings → Library → Network share logins (NAS)** first, then add the folder (for example `\\NAS\Music`). The password is encrypted by Windows for the WavWiz service and never shown again.
4. **Volume leveling (ReplayGain)** is set to Automatic by default and uses the ReplayGain or R128 tags in your files; songs without tags play unchanged.

Internet radio and optional CD ripping are separate tools inside the app—they do not replace adding your library folders.

## 5. Pair players and phones

- **Player PCs:** install Player; it usually finds the server. If asked, enter the pairing code from Settings → pair a phone or PC player.
- **Phones:** open the server URL on the same Wi-Fi; complete pairing if prompted. Sound on iPhone often needs a first tap to unlock audio.

Use **per-device delay (0–1000 ms)** if Bluetooth speakers or TVs lag behind other rooms.

## 6. AirPlay tip (VPN / isolation)

AirPlay discovery uses your **local** network (multicast / mDNS). Many **VPN** clients, “kill switches,” or “network isolation” modes hide LAN devices.

If **WavWiz – Whole House** does not appear on iPhone, iPad, or Mac:

1. Confirm the phone/Mac is on the **same home Wi-Fi** as the server (not guest Wi-Fi).
2. Pause or disconnect the **VPN** (or allow LAN access in the VPN app).
3. Confirm Windows network is **Private** and WavWiz Server is running.
4. Retry AirPlay from Control Center / the app’s AirPlay icon.
5. Still stuck? Open **Diagnostics** and use **Restart AirPlay** (and **Clear orphans** if it lists leftover receiver processes).

AirPlay is built in for this beta; WavWiz is **not** affiliated with Apple. AirPlay is a trademark of Apple Inc.

## 7. Spotify Connect (optional, Premium)

Spotify Connect is **off by default**.

1. Sign in to Spotify on your phone with **Spotify Premium** (required).
2. In WavWiz, as admin, enable Spotify Connect under network / admin settings.
3. Choose WavWiz in Spotify’s device list; audio should play through the house sync pipeline.

This uses an **unofficial** open-source client. WavWiz does not store your Spotify password. Spotify is a trademark of Spotify AB; WavWiz is not affiliated with Spotify.

## 8. When something goes wrong

Open **Diagnostics** in the app, copy the text, and include it with your version and OS in a [GitHub Issue](https://github.com/vdubbin74/WavWiz/issues). See [SUPPORT.md](../SUPPORT.md).

Security problems: email **vdubbin74@proton.me** only — see [SECURITY.md](../SECURITY.md).
