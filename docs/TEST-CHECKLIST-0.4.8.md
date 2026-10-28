# WavWiz 0.4.8 test checklist

Build it yourself from `C:\Users\trevo\WavWiz-src\WavWiz-src-0.4.8.zip` (same steps as 0.4.7), install, then tick these off.

> Tip: turn the **VPN off** on the PC and the iPhone while you test. VPNs can hide LAN devices and block discovery and AirPlay.

## 0.4.8 changes

- [ ] **Version:** the title bar, About and the status bar show **0.4.8**; "What's new" lists the 0.4.8 items.
- [ ] **F48:** the full-screen Queue has its own player bar.
- [ ] **F49:** the mixer button opens Master Volume with each speaker's Delay and Max volume.
- [ ] **F50:** "Up next" never overlaps the pin button.
- [ ] **F51:** the Delay box is compact.
- [ ] **F52:** Devices has a + button and clean dividers.
- [ ] **F53:** expand Devices (Full and Roomy): it runs full height with no player bar or small player, Scenes runs full height and is as wide as the normal Devices panel; collapsing Devices brings Now Playing back.
- [ ] **F54:** no volume slider in the play bars (the standalone mini keeps it); a mixer button is there instead.
- [ ] **F55:** the mini player fits at 200% with small corner icons.
- [ ] **F56:** on the phone, "All sound settings" opens full screen; the button is small but easy to tap.
- [ ] **F57:** CD ripper shows only on the PC running WavWiz.
- [ ] **F58:** Roomy uses the Classic Devices bar.
- [ ] **F59:** the collapsed Devices count is vertical, same color as the Library count.
- [ ] **F60:** "Queue: [zone]" dropdown, "(playing)" next to the playing zone, the zone name shown once.
- [ ] **F61:** zone and speaker cards show the new song right away.
- [ ] **F62:** long titles and artists scroll (phone and mini included).
- [ ] **F63:** open the mixer at 100%, at 200% and at 200% with Display size 67% (the TV): 2 columns, long sliders, nothing overlaps (OFFLINE tags, %, mute and the drawer arrow all clear); on narrow cards each speaker's slider sits under its name. On the phone it is one column.

## AirPlay receive (iPhone → WavWiz)

- [ ] On the PC, open a zone in Devices → **Phone casting** → tick **AirPlay**. *Expected: the line says "· ready" within a few seconds.*
- [ ] On the iPhone, open Control Center → the AirPlay button. *Expected: "WavWiz – Everywhere" and "WavWiz – <zone>" for every zone with AirPlay ticked.*
- [ ] Play a song from the iPhone to **WavWiz – Everywhere**. *Expected: it plays everywhere; the title, artist and cover show in WavWiz; the iPhone volume changes the level; pause and skip work.*
- [ ] **Pick each zone from the iPhone AirPlay menu and confirm only that zone plays.** *Expected: only that zone's speakers (and zones linked to it) play; the other zones stay as they were.*
- [ ] Rename a zone that has AirPlay on, then reopen the iPhone AirPlay menu. *Expected: the new name shows. The old name may linger for a while (see the known issue below); toggle the iPhone's Wi-Fi off and on if it does.*
- [ ] Untick AirPlay on a zone, or delete the zone. *Expected: its name disappears from the iPhone menu (it may linger for a while, see below).*
- [ ] Diagnostics → **Restart AirPlay**. *Expected: the Everywhere speaker comes back on the iPhone within a few seconds.*

> **Known issue (0.4.8):** WavWiz doesn't send an mDNS "goodbye" when an AirPlay name is removed or renamed, so the iPhone can keep showing the old name until its cache expires (up to about 75 minutes). Picking a stale name fails.
