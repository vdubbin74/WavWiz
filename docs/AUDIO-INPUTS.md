# Audio inputs: This PC · Speakers (loopback), Aux in, S/PDIF in and microphones (0.7.3)

WavWiz can play **sound from the server PC** in any zone, the same way it plays a radio station. The input everyone asks
about is **This PC · Speakers (what you hear)**. It is a *loopback* input: it records whatever that Windows PC is playing
(YouTube in a browser, Spotify, a game, a TV app) and sends it to the house. The same page also covers Aux in, S/PDIF in and microphones.

This feature is real and ships in WavWiz 0.7.2 and later. It needs no extra drivers, no "Stereo Mix" and no virtual cable for the normal Real time mode.

Contents: [What it is](#what-it-is) · [Requirements](#requirements) · [Set it up](#set-it-up) · [Play it in a zone](#play-it-in-a-zone) ·
[Real time or Sync with WavWiz](#real-time-or-sync-with-wavwiz) · [How it works](#how-it-works) · [Other inputs](#other-inputs) ·
[Troubleshooting](#troubleshooting)

## What it is

- In WavWiz the input is called **This PC · Speakers**. On a phone or another PC it is named after the PC it comes from, for example
  **PCBOXV2 · Speakers** (0.7.3), so you can tell which PC it is. Only a browser on that same PC still says "This PC".
- You can rename it (for example to **Loopback** or **TV sound**). The name shows in the Library, Now Playing and the queue.
- When it plays in a zone, that zone's queue is set aside, like AirPlay. **Stop** brings the queue back, paused.
- It is a live source. There is nothing to seek or skip, and it plays until you stop it or something else takes the zone (a song, AirPlay).

## Requirements

| Need | Why |
| --- | --- |
| **WavWiz Player running on the server PC** (the Windows PC that runs WavWiz Server) | The server is a Windows service and never opens a sound card itself. The Player on that PC does the capture and sends the audio to the server. Inputs on a Player on *another* PC are not offered (0.7.3): the server only lists a Player that connects from this machine (a loopback address or the same PC name). Without it, Library > Inputs says "Open WavWiz Player on the server PC to use its Aux in, S/PDIF in, microphones and this PC's sound." |
| **Windows 10 version 2004 (May 2020 Update, build 19041) or later, recommended** | WavWiz uses Windows' *per-process* loopback: it records every app on the PC **except the WavWiz Player and its child processes**. So WavWiz never records the music it plays itself, and you get no feedback loop, even when WavWiz plays through the same speakers. |
| Older Windows 10 | WavWiz falls back to a *whole-device* loopback of the Windows default speakers. That would also record WavWiz's own sound, so WavWiz **refuses** it while the WavWiz Player on that PC plays through the same speakers: "WavWiz plays through these speakers too, so capturing them would play WavWiz back into itself. Choose another output for this PC in WavWiz, or update Windows (10 version 2004 or later) for echo-free capture." |
| A Windows server | Linux, Raspberry Pi and Docker servers have no audio inputs. There is no Linux Player yet, and a Windows Player on another PC is not the server PC. |

You do **not** need "Stereo Mix". Capture devices named Stereo Mix, What U Hear, Wave Out Mix, What you hear or Loopback are hidden
from the input list on purpose: they record the whole device, WavWiz included, and This PC · Speakers replaces them.

## Set it up

An administrator does this once:

1. Start **WavWiz Player** on the server PC (it pairs by itself there). Leave it running; closing it stops all inputs.
2. Open **Settings > Devices > Audio inputs** (or search "loopback" or "what you hear" in the Settings search box).
3. Find **This PC · Speakers** (its Source line ends in "Speakers (what this PC plays)", or "(what that PC plays)" on another device).
   - Switch it **On**.
   - Optionally type a **Display name**, up to 40 characters, such as *Loopback*. Leave the box empty to go back to the default name.
   - Set **Gain** (-12 to +6 dB, normally 0 dB).
4. Pick **Playback on this PC**: **Real time** (the default) or **Sync with WavWiz**. See [below](#real-time-or-sync-with-wavwiz).

Anyone can see the Audio inputs card, but only an administrator can change it.

## Play it in a zone

Inputs are not "added" to a zone the way a speaker is. You *play* them in a zone, like a station:

1. Pick the zone you want to control (the zone picker on Now Playing / Devices).
2. Open **Library > Inputs**. The tab appears once the server PC has inputs.
3. On the This PC · Speakers tile press **▶ Play** to play it in that zone, or **Everywhere** to play it in every zone at once.
4. Play something on the server PC (a video, Spotify, a game). The tile says **Playing in *zone*** and shows a live level meter.
5. To end it, press **■ Stop**. For this input WavWiz asks first, because the PC's sound goes back to that PC's own speakers:
   - **Pause PC audio & stop** presses the media Play/Pause key on that PC, only if it is making sound, so YouTube or Spotify pauses first.
   - **Stop** just stops.
   - **Don't show again** remembers your choice on that device.

Anyone with Control rights can play and stop inputs. Inputs can't play in the Jukebox zone. Playing a song, AirPlay or another input in
that zone also ends it.

## Real time or Sync with WavWiz

Every room that plays a live source hears it about **1.4 s** after the source: WavWiz holds about 0.8 s of input audio to ride out
Wi-Fi hiccups, plus the house's normal 0.6 s lead that keeps every speaker in step. The two modes only decide what the **server PC itself** does.

**Real time** (default): "this PC plays live, zones follow".
- Windows keeps playing the apps on the PC's own speakers, as usual and without delay. Good for watching a video at that PC.
- The other zones hear it about 1.4 s later.
- If the server PC's own WavWiz speaker is in the zone that plays the input, WavWiz mutes that copy on this PC. Otherwise you would hear an echo 1.4 s later, at twice the level.

**Sync with WavWiz**: "this PC plays in step with every zone".
- While the input plays, the WavWiz Player moves **Windows' default output to a spare output nobody listens to**, and plays WavWiz's synced copy on your real speakers ("Play synced on").
- The PC's speakers are then exactly in step with the other rooms. Everything on that PC sounds about 1.4 s late, so it suits music better than video or games.
- **Why it needs a spare output:** Windows has to send the apps' sound *somewhere*. If it stayed on your speakers you would hear it twice: live, and again 1.4 s later through WavWiz.
  - Per-process loopback follows the apps, not the device, so the apps are still recorded on the spare output. The spare is never heard.
  - The spare defaults to, in order: optical / S/PDIF; HDMI or DisplayPort (a monitor or TV); another unused output; a headphone jack with nothing plugged in.
  - A headset in use is never picked by itself. You can pick any output by hand.
- **No spare output?** WavWiz says "No spare output found. Sync needs a second, unused sound output that is switched on (for example monitor or HDMI audio)." It suggests **VB-Cable**, a free virtual sound output, to use as the spare. Until then the input plays in Real time.
- **Calls:** calls stay on your headset when it is Windows' communications device.
- **Getting your speakers back:** Stop, Exit, signing out, a lost connection to the server and the next Player start after a crash all put Windows' previous outputs back.
  - The Player saves them in a restore file *before* it switches, so a crash or power cut does not lose them.
  - The Player tray menu has **Restore my speakers**.
  - When the speakers are handed back, their Windows volume is lowered (never raised) to the level you heard through WavWiz, so YouTube does not come back at 100%.
  - If the spare output disappears, the Player goes back to Real time by itself and the Audio inputs card shows why.

## How it works

For people who want to know, or who were told it can't work.

1. **Capture (WavWiz Player, Windows, WASAPI via NAudio):**
   - On Windows 10 2004+, the Player opens a process-loopback capture of its own process ID with "exclude target process tree". That records every process *except* the Player and its children, as 48 kHz 32-bit float stereo in shared mode.
   - On older Windows it opens a loopback of the default multimedia speakers, unless WavWiz plays through them (see [Requirements](#requirements)).
   - Capture runs only while the input is playing. This input is never opened just for a meter.
2. **InputResponder (in the Player):**
   - The server tells the Player what to capture (`start` / `stop` / `stop-all`, and for this input `localsync-on/off`, `selfmute-on/off` and `media-pause`). It uses an `INPUT_CMD` message (type 14) on the Player's existing **audio connection (TCP port 47801)**. No extra port is opened.
   - Captured blocks go back on the same connection as `INPUT_AUDIO` messages (type 13). Each message holds the input id, the sample rate, the channel count (1 or 2), a timestamp, and the audio as 24-bit PCM. A message is never more than 100 ms of audio.
   - The timestamp is the time of the first sample on the *server's* clock. The Player knows the server clock from its normal UDP clock sync (port 47802). It is 0 while the clock is not yet locked.
   - A small queue (about 2 s) drops the oldest audio if the link stalls, so a hiccup never builds up delay.
   - If the Player disconnects, all capture stops and Sync mode is undone.
3. **Server (InputService + LiveFeed):**
   - Each input gets its own live feed. The feed converts the audio to WavWiz's house format (48 kHz stereo float, resampled if needed; mono doubled; only the front left/right kept from more channels).
   - The feed applies the input's gain and the shared live limiter, and keeps about 0.8 s buffered. When the PC's sound card clock runs slightly fast or slow, it trims or re-buffers.
   - The zone's house stream then plays the input like any other source, so every speaker in the zone gets it in sync with the shared clock.
   - The 0.7.3 server does not use the timestamp yet; it times the audio from the buffer.

The audio-link messages are only used when both the Player and the server announce the `inputs` capability (0.7.2+), so older Players and servers are unaffected.

## Other inputs

The same card and tiles cover the server PC's other recording devices. WavWiz sorts each one by its Windows form factor and name.

- **Aux in / line in:**
  - It has a live meter in Settings.
  - **Turntable mode** (Aux in only) gives a record-player icon and **Start when the needle drops**: the level stays above -48 dBFS for 2 s. It then plays in the zone where it last played (Everywhere the first time).
  - It stops 25 s after the side ends, below -52 dBFS.
  - It warns "Very quiet - is the turntable plugged in without a phono preamp?" when the music never reaches -30 dBFS.
- **S/PDIF in** (optical / coaxial): like Aux in, without Turntable mode.
- **Microphones and headset mics:**
  - Off by default and **Muted** (for Announce only) until an administrator turns on **Live source**.
  - A mic is opened only while it plays, never for a meter. Gain goes up to +24 dB for quiet headset mics, and the limiter keeps it from clipping.
  - Bluetooth headset mics switch the headset to call quality while they are open.
  - If Windows' microphone privacy setting blocks desktop apps, the input says so, with **Open microphone settings** in the WavWiz Player.
- **Announce** (hold-to-talk) uses a phone's or PC browser's microphone and is separate from these inputs. See [FIRST-RUN.md](FIRST-RUN.md#audio-inputs-server-pc).

## Troubleshooting

**No Inputs tab, or "Open WavWiz Player on the server PC…"**
- The WavWiz Player is not running on the server PC, or it is an old version (before 0.7.2).
- A Player on another PC does not count. Start the Player on the PC that runs WavWiz Server.

**It says Playing but the zone is silent**
- Is something actually playing on the server PC? The meter on the tile stays at the bottom when it is quiet.
- Check that the app is not muted in the app or in the Windows volume mixer.
- Is the input's Gain turned far down?
- On older Windows, read the error on the tile. The echo refusal means WavWiz plays through the same speakers: pick another output for this PC in WavWiz, or update Windows.
- If the tile shows **Problem**, the text under it is the real Windows error.

**I hear an echo or a loop**
- On Windows 10 2004+ WavWiz never records the WavWiz Player itself. But it *does* record any other app on that PC that plays WavWiz, for example a **browser tab on the server PC opened to WavWiz and playing as a speaker**. That tab is a separate process: its sound is sent to the house again and loops. Switch that browser speaker off, or close the tab, while the input plays.
- In Real time, hearing the PC live *and* the house copy 1.4 s later from other rooms nearby is normal. Use **Sync with WavWiz** to put the PC in step with them.

**It is late / out of sync with the picture**
- About 1.4 s is expected in every zone, by design: buffer plus house lead.
- Watch video in **Real time** at the PC. Use Sync when you only listen.
- The per-speaker delay and calibration line speakers up with each other; they can't make a live source early.

**Sync with WavWiz is grayed out or went back to Real time**
- There is no spare output. Plug in or switch on a monitor or TV with HDMI audio, or install VB-Cable and pick it as the **Spare output**.
- If the spare output disappeared while playing, the Player goes back to Real time and the card shows why.
- If Windows was left on the wrong output, use **Restore my speakers** in the WavWiz Player tray menu.

**Firewall**
- Capture needs no firewall rule of its own: the Player and the server are on the same PC, and the audio rides the Player's existing connection.
- The rooms that play it use WavWiz's normal ports (TCP 47801 audio, UDP 47802 clock, HTTP 47800 for browsers). The installer opens them only on a **Private** network.
- If other rooms play nothing at all, music included, fix the network first: Getting started > **Check your network**.

**Microphone input says Windows is blocking it**
- Turn on "Microphone access" and "Let desktop apps access your microphone" in Windows Settings > Privacy & security > Microphone, then press Play again.
- This applies to microphones; This PC · Speakers is not a microphone.

When reporting a problem, copy **Help > Diagnostics** and mention the Windows version (Settings > System > About) of the server PC.
