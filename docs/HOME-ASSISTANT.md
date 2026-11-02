# Home Assistant (F165)

WavWiz exposes a small, stable REST surface so Home Assistant (or any script) can drive it.
REST + token only; no MQTT, no announce/duck, not a Music Assistant provider, not a Cast bridge.

## 1. Create the token
Settings → **Paired devices & tokens** → **Home Assistant token…** → Create.
Copy the token (shown once). It is a **Control** token: it can play/pause/skip, change volume and mute,
and read what is playing — not admin settings. **Revoke** it in the same list at any time (HA stops at once).

Every call sends `Authorization: Bearer <token>`. Base URL is your server, e.g. `http://wavwiz-pc:PORT` (the address you open WavWiz at).

## 2. Players (how HA maps)
One HA `media_player` per WavWiz player:
| id | what |
|---|---|
| `master` | the whole house ("WavWiz"): house queue, master volume, mute all |
| `g:<zone id>` | one per zone in the Speakers tree: its own queue, zone volume, zone mute |

Volume is 0–100 (HA uses 0–1; divide/multiply by 100).

## 3. Endpoints (`/api/v1`)
| method | path | body | role |
|---|---|---|---|
| GET | `/ha` | – | view — `{api:1, server, version}` |
| GET | `/ha/players` | – | view — `{players:[…]}` |
| GET | `/ha/players/{id}` | – | view |
| POST | `/ha/players/{id}/play` | – | control (resume if paused, else start queue position) |
| POST | `/ha/players/{id}/pause` · `/stop` · `/next` · `/prev` | – | control |
| POST | `/ha/players/{id}/volume` | `{"volume": 0-100}` | control |
| POST | `/ha/players/{id}/mute` | `{"muted": true}` | control |

Commands return the updated player. Player JSON:
```json
{ "id":"g:3","name":"Kitchen","available":true,"state":"playing","volume":42,"muted":false,
  "positionMs":61000,"durationMs":215000,"liveTitle":null,"shuffle":false,"repeat":"off",
  "track":{"title":"…","artist":"…","album":"…","kind":"track","durationMs":215000,"artUrl":"/api/v1/art/track/123?size=512"},
  "queue":{"count":12,"index":3,"next":[{"title":"…","artist":"…"}]} }
```
`artUrl` is relative to the server and needs the same Bearer header. `state` is the player state (`playing`, `paused`, `stopped`, `idle`).
Unknown player → 404 (a stale automation never silences the whole house).

## 4. Quick test
```sh
curl -H "Authorization: Bearer $TOKEN" http://wavwiz-pc:PORT/api/v1/ha/players
curl -X POST -H "Authorization: Bearer $TOKEN" http://wavwiz-pc:PORT/api/v1/ha/players/master/pause
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"volume":30}' http://wavwiz-pc:PORT/api/v1/ha/players/g:3/volume
```

## 5a. Plain YAML (no custom code)
```yaml
rest_command:
  wavwiz:
    url: "http://wavwiz-pc:PORT/api/v1/ha/players/{{ player }}/{{ cmd }}"
    method: POST
    headers: { Authorization: !secret wavwiz_bearer }   # "Bearer <token>"
    content_type: application/json
    payload: "{{ body | default('{}') }}"
```
Call `rest_command.wavwiz` with `player: master`, `cmd: pause` (or `volume` + `body: '{"volume":30}'`).

## 5b. Optional custom component (media_player entities)
Copy `integrations/ha/custom_components/wavwiz` into HA's `config/custom_components/`, restart, then:
```yaml
media_player:
  - platform: wavwiz
    host: http://wavwiz-pc:PORT
    token: !secret wavwiz_token
```
It polls `/ha/players` every 10 s and creates one entity per player (play, pause, stop, next, previous, volume, mute, art, now playing).
Minimal by design; it lives in this repo (not HACS yet).
