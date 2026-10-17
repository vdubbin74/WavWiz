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

### Add WavWiz to your home screen

On an iPhone or iPad, open WavWiz in Safari, tap **Share** and choose **Add to Home Screen**. On Android, open it in Chrome and choose **Add to Home screen** (or **Install app**) from the menu; Chrome may only offer **Install app** over HTTPS. WavWiz then opens full screen with its own icon.

## 6. Devices, zones and delay

- **Devices → Devices & zones** opens the expanded Devices view. **Master volume** and **Mute all** sit at the top; every speaker has its own volume, Mute and on/off switch. The volume and Mute on the Now Playing panel control only the device you are using.
- **Zones** are optional groups (for example "Downstairs"): pick one in the zones sidebar to filter the cards, or edit it in place.
- In the **Expanded** Devices view, each card shows the name with up to two tags (**REF** for the reference speaker, **MUTED**, **NO DELAY**, **OFFLINE**, or a phone's **SPEAKER** role), one status line (playing · output · delay), and the volume with a round **Mute** button on the right. Its chevron button opens the device's settings in a wide center column (Scenes & Schedules folds into a bar and Zones slides left while it is open): **Volume**, **Volume cap**, **Delay** (slider, exact ms and **Calibrate**), **Balance**, **Bass**, **Treble**, the 10-band EQ, the **Output**, **Test sound** and **More** (Rename, Set as reference, Delay history, Forget). Balance is applied by WavWiz Player, so it has no effect on a browser speaker. Controls only an administrator may change stay visible but read-only for everyone else.
- **Click and drag:** click anywhere on a speaker card to open its settings, or anywhere on a zone card to expand it (there is no arrow). The On/Off switch, Mute, volume, delay, pencil and drag handle keep their own actions. Drag cards by the handle to reorder them; the order is remembered on that device. The master row has **All off**, **All on** and a master volume, and the **Now playing** strip shows the current song on zones that are playing (the whole house still shares one queue).
- **Profiles:** the row at the top of the speaker settings saves everything above as a named profile (**Save**, **Save as…**) and loads it on any device. A dot by the name shows unsaved changes. In the scene editor, each device can pick a profile; a scene never changes a max-volume cap.
- Use **per-device delay (0–1000 ms)** if Bluetooth speakers lag behind other devices. On PCs the delay is kept per audio output.

### Calibrate speakers

**Devices → Calibrate speakers…** measures each speaker's delay against the reference speaker. The music stays paused for the whole calibration and only resumes when you choose. Before each measurement WavWiz checks the microphone level at that spot and rates it (good, weak or too quiet) with advice such as moving the mic closer, raising the **Test volume** slider, or checking the Windows input; a live level meter stays visible while it measures. A speaker that stays silent is retried and then named in the result. There are three ways, in this order:

1. **Use this PC's microphone (recommended).** Works on any PC running WavWiz Player 0.2.5 with a mic: a USB mic, a headset or audio-interface mic, or the PC's built-in mic. Pick the PC and the mic (WavWiz remembers it), watch the live level, place the PC (or the mic) at your listening spot and press **Start**. A Bluetooth headset mic works too, but it adds its own delay, so WavWiz warns: a wired or USB mic is better. No mic? The card says so and offers **Check again**.
2. **Use your phone (still in testing on iPhone).** Scan the QR code with the phone. The phone opens a **mic-only page**: it never plays music and never joins as a speaker. The first time, the page walks you through installing WavWiz's certificate (a phone only allows its microphone on a trusted HTTPS page; an admin turns HTTPS on once in **Settings → Devices → Phone & HTTPS**). Tap **Start** and allow the microphone; the PC shows "Phone connected", each step and the results. While a phone is connected, Devices shows a **Calibration mic** line at the top with **Stop using as mic**.
3. **By ear.** No microphone at all: play two speakers together and move a slider until they sound like one.

A link made by an administrator lets the phone calibrate every speaker; other users can calibrate only their own device. Links expire after 20 minutes.

**Phone role.** When you open WavWiz on a phone, it asks once: **Play music here** (the phone becomes a speaker) or **Use as a calibration mic**. Change it any time in **Devices → Phone role…**.

## 7. Settings and appearance

Menus do things, Settings sets things:

- **File:** Settings, **New** (zone, scene, alarm, schedule; Ctrl+Shift+Z / S / A / H, and some browsers reserve a few of these), **Run** (starts a scene, schedule or alarm), Import settings…, Restore backup…, Export settings, Back up now, Sign in as admin… / Leave admin mode, Sign out
- **Library:** Browse library (opens the Expanded library), Playlists, Queue (always opens the playlist expanded), Rescan folders, plus admin tools (Tidy up library, Tag & cover fix…, CD ripper…)
- **Playback:** Play / Pause, Next, Previous, Internet radio, Sound / EQ…, Start Jukebox… (admin)
- **Devices:** Devices & zones, Devices / Zones / Scenes (hover to list them and jump straight to one), Schedules & alarms, Calibrate speakers…, Phone role… (on a phone), Use as remote only, Pair a player…, Away-from-home…
- **Help:** Getting started, Diagnostics, What's new, About WavWiz…

**Hover menus:** menu items that open a list of choices show it beside the item when you hover (for example **Playback → Sleep timer** lists 15, 30, 45 and 60 minutes, End of song and Off), so one click picks one. **Pulse:** when a menu item or button points at something already on screen (the EQ, the playlist, a Settings tab), that spot pulses briefly in your accent color; it respects reduce-motion.

**Shortcuts:** Space plays or pauses, Ctrl+Right / Left is next / previous, M mutes, Alt+M shows or hides the mini player, Alt+H goes Home, Alt+E opens Sound / EQ, Alt+Q the Queue and Ctrl+, Settings (also under Help → Keyboard shortcuts). Media keys work with WavWiz Player on Windows. Pin up to five shortcuts next to Home with the pin icon on a title bar.

**Playlist columns:** the playlist title bar has a checklist icon (or right-click the header) to show or hide Title, Artist, Album, Year, Genre, Time and Track #, with **Reset columns**. Drag a column edge to resize, drag a header to reorder, click a header to sort (click again to reverse), and use the lock icon to freeze the layout. The narrow playlist beside an expanded Library shows fewer columns by default.

**EQ:** the LED bars behind the EQ follow the real level of each band's frequency, on all three EQ looks.

**Settings** has seven tabs: **General** (including Backup), **Appearance**, **Playback** (crossfade), **Devices** (sub-tabs **Players & access** and **Calibration**), **Library**, **Network** and **Jukebox**. Use the search box in the header to jump to an option. Changes save right away (a **Saved ✓** appears next to them); every section has **Reset this section**. Appearance has its own sub-tabs, in a row right under the main tabs: **Theme** (which includes **Display size**), **Visualizer**, **EQ** and **Now Playing**. Settings and every other window have the same fixed width as the center panel; content scrolls inside. The live previews on Theme, Visualizer, EQ and Now Playing stay pinned at the top while you scroll. Appearance choices apply to the device you are using.

**Lock EQ:** the Sound (EQ) window and **Appearance → EQ** have a **Lock EQ** checkbox. When it is checked, the EQ sliders ignore the mouse wheel, dragging, clicks and keys, so scrolling the page never changes the sound. Each device remembers it (off by default; unlocked, the wheel fine-tunes a slider in 0.5 dB steps). **Appearance → EQ** shows this speaker's real EQ and always opens locked; uncheck it to make changes, which are saved to the speaker's own preset.

### Mini player

Want just the playback controls in a small window? Choose **Devices → Mini player** or **Mini player** in the WavWiz Player tray menu. It shows the cover, title, a seek bar, previous / play / next, mute and volume. Drag it anywhere (drop it near the top edge and it parks there), pin it to keep it on top of other windows, make it slim, or go back to the full window. It remembers where you left it. Remote mode is gone: a phone or PC that should only control the music simply doesn't turn on its speaker.

### Max-volume lock

An admin can give any device a **max volume** in its Settings and lock it. While it is locked, nothing raises that device above the cap: not the master volume, a zone, a scene, schedule or alarm, the mini player or the API. Turning it down always works. Setting a cap locks it. A capped bar shows a marker at the limit and stops there.

### Jukebox (beta)

**Playback → Start Jukebox…** (admin) asks for a host PIN (4–8 digits) and opens the locked big screen. Guests scan the QR code to add songs. Leave with the PIN: hold the WavWiz logo in the corner or press **Ctrl+Shift+J**. The Jukebox screen blocks Esc, Alt+Tab and right-click inside WavWiz, but Windows keys such as Ctrl+Alt+Del still work. For a public PC that must stay locked, set it up with **Windows Assigned Access** (kiosk mode) and run WavWiz Player as the kiosk app. Running the Jukebox big screen in a smart-TV browser is still in testing.

### Alarms, sleep timer and crossfade

**Devices → Scenes & Schedules…** opens Expanded Devices, where the Scenes & Schedules column holds scenes, schedules and alarms (beta); create and edit them right there. The **Sleep** button is in Now Playing. Crossfade is in **Settings → Playback** (0–12 s, off by default).

### Backup

**File → Back up now** saves a backup on the server (the last 10 are kept); **File → Restore backup…** picks one, shows a summary of what will change, then restores it, and an **Undo restore** button is offered right after. **File → Export settings** downloads a .wavwizbackup file and **File → Import settings…** reads one, with the same summary first. **Settings → General → Backup** (admin) exports and imports a file with a preview. Passwords, certificates and private keys are never included; set those again after restoring on a new PC.

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
