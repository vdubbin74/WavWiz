"""Minimal WavWiz media_player platform: one entity per WavWiz player (master + zones)."""
from __future__ import annotations

from datetime import timedelta
import logging

import voluptuous as vol

from homeassistant.components.media_player import (
    PLATFORM_SCHEMA,
    MediaPlayerEntity,
    MediaPlayerEntityFeature,
    MediaPlayerState,
)
from homeassistant.helpers.aiohttp_client import async_get_clientsession
import homeassistant.helpers.config_validation as cv

_LOGGER = logging.getLogger(__name__)
SCAN_INTERVAL = timedelta(seconds=10)
PLATFORM_SCHEMA = PLATFORM_SCHEMA.extend({vol.Required("host"): cv.url, vol.Required("token"): cv.string})
STATES = {"playing": MediaPlayerState.PLAYING, "paused": MediaPlayerState.PAUSED}
FEATURES = (
    MediaPlayerEntityFeature.PLAY | MediaPlayerEntityFeature.PAUSE | MediaPlayerEntityFeature.STOP
    | MediaPlayerEntityFeature.NEXT_TRACK | MediaPlayerEntityFeature.PREVIOUS_TRACK
    | MediaPlayerEntityFeature.VOLUME_SET | MediaPlayerEntityFeature.VOLUME_MUTE
)


class Api:
    def __init__(self, hass, host: str, token: str):
        self.base = host.rstrip("/") + "/api/v1/ha"
        self.host = host.rstrip("/")
        self.headers = {"Authorization": f"Bearer {token}"}
        self.session = async_get_clientsession(hass)
        self.players: dict[str, dict] = {}

    async def refresh(self):
        async with self.session.get(f"{self.base}/players", headers=self.headers, timeout=10) as r:
            r.raise_for_status()
            self.players = {p["id"]: p for p in (await r.json())["players"]}

    async def cmd(self, pid: str, cmd: str, body: dict | None = None):
        async with self.session.post(f"{self.base}/players/{pid}/{cmd}", headers=self.headers, json=body or {}, timeout=10) as r:
            r.raise_for_status()
            self.players[pid] = await r.json()


async def async_setup_platform(hass, config, async_add_entities, discovery_info=None):
    api = Api(hass, config["host"], config["token"])
    await api.refresh()
    async_add_entities([WavWizPlayer(api, pid) for pid in api.players], True)


class WavWizPlayer(MediaPlayerEntity):
    _attr_supported_features = FEATURES
    _attr_media_image_remotely_accessible = False

    def __init__(self, api: Api, pid: str):
        self.api, self.pid = api, pid
        self._attr_unique_id = f"wavwiz_{pid.replace(':', '_')}"
        self._attr_name = api.players[pid]["name"]

    @property
    def _p(self) -> dict:
        return self.api.players.get(self.pid, {})

    async def async_update(self):
        try:
            await self.api.refresh()
        except Exception as e:  # noqa: BLE001
            _LOGGER.debug("WavWiz refresh failed: %s", e)

    @property
    def available(self): return bool(self._p.get("available"))
    @property
    def state(self):
        s = self._p.get("state")
        return STATES.get(s, MediaPlayerState.IDLE)
    @property
    def volume_level(self): return (self._p.get("volume") or 0) / 100
    @property
    def is_volume_muted(self): return self._p.get("muted")
    @property
    def media_title(self): return (self._p.get("track") or {}).get("title") or self._p.get("liveTitle")
    @property
    def media_artist(self): return (self._p.get("track") or {}).get("artist")
    @property
    def media_album_name(self): return (self._p.get("track") or {}).get("album")
    @property
    def media_duration(self): return (self._p.get("durationMs") or 0) / 1000 or None
    @property
    def media_position(self): return (self._p.get("positionMs") or 0) / 1000

    async def async_get_media_image(self):
        art = (self._p.get("track") or {}).get("artUrl")
        if not art:
            return None, None
        url = art if art.startswith("http") else self.api.host + art
        async with self.api.session.get(url, headers=self.api.headers, timeout=10) as r:
            return (await r.read(), r.headers.get("Content-Type")) if r.status == 200 else (None, None)

    @property
    def media_image_hash(self):
        return (self._p.get("track") or {}).get("artUrl")

    async def async_media_play(self): await self.api.cmd(self.pid, "play")
    async def async_media_pause(self): await self.api.cmd(self.pid, "pause")
    async def async_media_stop(self): await self.api.cmd(self.pid, "stop")
    async def async_media_next_track(self): await self.api.cmd(self.pid, "next")
    async def async_media_previous_track(self): await self.api.cmd(self.pid, "prev")
    async def async_set_volume_level(self, volume): await self.api.cmd(self.pid, "volume", {"volume": round(volume * 100, 1)})
    async def async_mute_volume(self, mute): await self.api.cmd(self.pid, "mute", {"muted": mute})
