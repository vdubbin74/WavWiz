# F250 P0 — correctness overlap gate CLOSED

Wiz independently passed the amended F246/F248 candidate on 2026-11-05 (CST).
Private baseline: 86183ed6a90460af0953cc18c96b537cf10d06eb.
Public baseline: 6b7a0147f49b83fc1fbbbbf7d8be8542373e1cd8.

All six original F246/F248 R1–R3 blockers were closed in the independent
focused review (29/29 focused + 11/11 actual-DOM in each tree, plus four
reviewer variations). This is code/focused-test PASS only, not iPhone proof.
The corrected main.hide/applyMode lifecycle and F248 ingest/art/clock remain
protected. This commit changes documentation only; no visual changes.

Existing responsive full-page phone boundary stays <=900px; 760px detail
rules and desktop >=901px remain unchanged. Role banners dock before the
existing nowc.mini/tabbar. Phone Radio/Playlists source adapters remain a
known P2 task; direct routes exist, but the Library source tabs lack extras.

Proceed only with separately reviewable P1 shared phone chrome. P2 Library,
P3 Queue/F249 and P4 are not implemented by this note. F247 actual Safari /
Tailscale Home Screen icon proof and physical lock-screen/phone checks remain
OPEN; passing tests do not close them.

CODE ONLY / DEPLOY HOLD: no pile, compile/build, version bump, push/tag,
Hub/site, hotpatch, install/deploy, certificate/CA or CloudAgent operation.
Unrelated docs/DOCKER.md, PlayerCore packages.lock.json and scratch preserved.
