using System.Text.Json;
using WavWiz.Server.Media;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Api;

public static class PlaybackApi
{
    private static object QueueDto(Services s)
    {
        var q = s.Conductor.Queue(); var now = s.Conductor.Now();
        return new { items = q.Select((x, i) => new { id = x.Id, index = i, kind = x.Kind, title = x.Title, artist = x.Artist, album = x.Album, genre = x.Genre, year = x.Year, durationMs = x.DurationMs, refId = x.RefId, artUrl = x.ArtUrl }), index = now.Index };
    }

    private static List<QueueItem> ResolveItems(Services s, JsonElement b, out string? error)
    {
        error = null; var kind = b.Str("kind") ?? "tracks";
        switch (kind)
        {
            case "tracks":
                {
                    var ids = b.Prop("ids") is JsonElement a && a.ValueKind == JsonValueKind.Array ? a.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.Number).Select(x => x.GetInt64()).Take(5000).ToList() : new();
                    if (ids.Count == 0) { error = "no tracks given"; return new(); }
                    return s.Conductor.TracksToItems(ids);
                }
            case "node":
                {
                    var node = b.Str("node") ?? ""; List<Library.TrackRow> rows;
                    if (node.StartsWith("album:")) { var p = node[6..].Split('\u001f'); rows = p.Length == 2 ? s.Library.ByAlbum(p[0], p[1]) : new(); }
                    else if (node.StartsWith("artist:")) rows = s.Library.ByArtist(node[7..]);
                    else if (node.StartsWith("genre:")) rows = s.Library.ByGenre(node[6..]);
                    else if (node.StartsWith("year:") && int.TryParse(node[5..], out var yr)) rows = s.Library.ByYear(yr);
                    else if (node.StartsWith("folder:")) rows = s.Library.TracksInFolderTree(node[7..]);
                    else if (node == "recent") rows = s.Library.Recent(); else { error = "unknown node"; return new(); }
                    return s.Conductor.TracksToItems(rows.Select(r => r.Id));
                }
            case "radio":
                {
                    var id = b.Long("id"); var it = id == null ? null : s.Conductor.StationToItem(id.Value);
                    if (it == null) { error = "station not found"; return new(); }
                    return new() { it };
                }
            case "url":
                {
                    var url = b.Str("url") ?? "";
                    if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || u.Scheme is not ("http" or "https")) { error = "the address must start with http:// or https://"; return new(); }
                    return new() { Conductor.UrlItem(url, b.Str("name") ?? "") };
                }
            case "playlist":
                {
                    var id = b.Long("id") ?? 0; return PlaylistItems(s, id);
                }
        }
        error = "unknown kind"; return new();
    }

    public static List<QueueItem> PlaylistItems(Services s, long id)
    {
        var rows = s.Db.Query("SELECT track_id,radio_id FROM playlist_item WHERE playlist_id=$p ORDER BY position", r => (T: r.IsDBNull(0) ? (long?)null : r.GetInt64(0), R: r.IsDBNull(1) ? (long?)null : r.GetInt64(1)), ("$p", id));
        var res = new List<QueueItem>();
        foreach (var r in rows)
        {
            if (r.T != null) res.AddRange(s.Conductor.TracksToItems(new[] { r.T.Value }));
            else if (r.R != null && s.Conductor.StationToItem(r.R.Value) is { } st) res.Add(st);
        }
        return res;
    }

    public static void Map(RouteGroupBuilder g, Services s)
    {
        g.MapGet("/stream", () => Results.Json(new { now = s.Conductor.Now(), queue = QueueDto(s), leadMs = s.Conductor.LeadMs })).Req(Role.View);
        g.MapGet("/queue", () => Results.Json(QueueDto(s))).Req(Role.View);

        g.MapPost("/stream/play", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); var items = ResolveItems(s, b, out var err);
            if (err != null) return Ext.Bad(err); if (items.Count == 0) return Ext.Bad("nothing to play");
            int index = (int)(b.Long("index") ?? 0); long start = b.Long("startMs") ?? 0;
            if (b.Bool("enqueue") == true) { s.Conductor.Add(items, b.Bool("next") == true); return Results.Json(new { ok = true, added = items.Count }); }
            s.Conductor.PlayItems(items, index, start); return Results.Json(new { ok = true });
        }).Req(Role.Control);

        g.MapPost("/queue/add", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); var items = ResolveItems(s, b, out var err); if (err != null) return Ext.Bad(err);
            s.Conductor.Add(items, b.Bool("next") == true); return Results.Json(new { ok = true, added = items.Count });
        }).Req(Role.Control);

        g.MapDelete("/queue/{index:int}", (int index) => s.Conductor.Remove(index) ? Results.Json(new { ok = true }) : Ext.Bad("no such queue position", 404)).Req(Role.Control);
        g.MapPost("/queue/move", async (HttpContext c) => { var b = await c.Request.Body(); return s.Conductor.Move((int)(b.Long("from") ?? -1), (int)(b.Long("to") ?? -1)) ? Results.Json(new { ok = true }) : Ext.Bad("bad positions"); }).Req(Role.Control);
        g.MapPost("/queue/clear", () => { s.Conductor.Clear(); return Results.Json(new { ok = true }); }).Req(Role.Control);

        g.MapPost("/stream/pause", () => { s.Conductor.Pause(); return Results.Json(new { ok = true }); }).Req(Role.Control);
        g.MapPost("/stream/resume", () => { s.Conductor.Resume(); return Results.Json(new { ok = true }); }).Req(Role.Control);
        g.MapPost("/stream/stop", () => { s.Conductor.Stop(); return Results.Json(new { ok = true }); }).Req(Role.Control);
        g.MapPost("/stream/next", () => { s.Conductor.Next(); return Results.Json(new { ok = true }); }).Req(Role.Control);
        g.MapPost("/stream/prev", () => { s.Conductor.Prev(); return Results.Json(new { ok = true }); }).Req(Role.Control);
        g.MapPost("/stream/jump", async (HttpContext c) => { var b = await c.Request.Body(); s.Conductor.Jump((int)(b.Long("index") ?? -1)); return Results.Json(new { ok = true }); }).Req(Role.Control);
        g.MapPost("/stream/seek", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); var ms = b.Long("ms"); if (ms == null) return Ext.Bad("ms is required");
            return s.Conductor.Seek(ms.Value) ? Results.Json(new { ok = true }) : Ext.Bad("this item cannot be seeked (live radio or nothing playing)", 409);
        }).Req(Role.Control);
        g.MapPost("/stream/shuffle", async (HttpContext c) => { var b = await c.Request.Body(); s.Conductor.SetShuffle(b.Bool("on") ?? !s.Conductor.Shuffle); return Results.Json(new { ok = true }); }).Req(Role.Control);
        g.MapPost("/stream/repeat", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); var m = b.Str("mode");
            if (!Enum.TryParse<RepeatMode>(m, true, out var mode)) return Ext.Bad("mode must be off, all or one");
            s.Conductor.SetRepeat(mode); return Results.Json(new { ok = true });
        }).Req(Role.Control);

        // ---- playlists ----
        g.MapGet("/playlists", () => Results.Json(s.Db.Query("SELECT p.id,p.name,p.updated_at,(SELECT COUNT(*) FROM playlist_item WHERE playlist_id=p.id) FROM playlist p ORDER BY p.name COLLATE NOCASE",
            r => new { id = r.GetInt64(0), name = r.GetString(1), updatedAt = r.GetString(2), count = r.GetInt32(3) }))).Req(Role.View);

        g.MapGet("/playlists/{id:long}", (long id) =>
        {
            var p = s.Db.Query("SELECT id,name FROM playlist WHERE id=$i", r => (Id: r.GetInt64(0), Name: r.GetString(1)), ("$i", id)).FirstOrDefault();
            if (p == default) return Ext.Bad("not found", 404);
            var items = PlaylistItems(s, id);
            return Results.Json(new { id = p.Id, name = p.Name, items = items.Select((x, i) => new { index = i, kind = x.Kind, title = x.Title, artist = x.Artist, album = x.Album, durationMs = x.DurationMs, refId = x.RefId }) });
        }).Req(Role.View);

        g.MapPost("/playlists", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); var name = (b.Str("name") ?? "").Trim(); if (name.Length is 0 or > 80) return Ext.Bad("name must be 1-80 characters");
            var now = DateTimeOffset.UtcNow.ToString("O"); var id = s.Db.Insert("INSERT INTO playlist(name,created_at,updated_at) VALUES($n,$t,$t)", ("$n", name), ("$t", now));
            if (b.Bool("fromQueue") == true) SaveItems(s, id, s.Conductor.Queue());
            else if (b.Prop("trackIds") is JsonElement a && a.ValueKind == JsonValueKind.Array) SaveItems(s, id, s.Conductor.TracksToItems(a.EnumerateArray().Select(x => x.GetInt64())));
            return Results.Json(new { id });
        }).Req(Role.Control);

        g.MapPut("/playlists/{id:long}", async (long id, HttpContext c) =>
        {
            var b = await c.Request.Body();
            if (Convert.ToInt32(s.Db.Scalar("SELECT COUNT(*) FROM playlist WHERE id=$i", ("$i", id))) == 0) return Ext.Bad("not found", 404);
            if (b.Str("name") is string n) { n = n.Trim(); if (n.Length is 0 or > 80) return Ext.Bad("name must be 1-80 characters"); s.Db.Exec("UPDATE playlist SET name=$n WHERE id=$i", ("$n", n), ("$i", id)); }
            if (b.Prop("trackIds") is JsonElement a && a.ValueKind == JsonValueKind.Array) SaveItems(s, id, s.Conductor.TracksToItems(a.EnumerateArray().Select(x => x.GetInt64())));
            if (b.Bool("fromQueue") == true) SaveItems(s, id, s.Conductor.Queue());
            s.Db.Exec("UPDATE playlist SET updated_at=$t WHERE id=$i", ("$t", DateTimeOffset.UtcNow.ToString("O")), ("$i", id)); return Results.Json(new { ok = true });
        }).Req(Role.Control);

        // append (or insert at "position") whatever the queue endpoints understand: tracks, an album/artist/genre/year/folder node, a playlist, a station
        g.MapPost("/playlists/{id:long}/items", async (long id, HttpContext c) =>
        {
            if (Convert.ToInt32(s.Db.Scalar("SELECT COUNT(*) FROM playlist WHERE id=$i", ("$i", id))) == 0) return Ext.Bad("not found", 404);
            var b = await c.Request.Body(); var add = ResolveItems(s, b, out var err); if (err != null) return Ext.Bad(err); if (add.Count == 0) return Ext.Bad("nothing to add");
            var cur = PlaylistRefs(s, id); int pos = (int)Math.Clamp(b.Long("position") ?? cur.Count, 0, cur.Count);
            cur.InsertRange(pos, add.Select(x => (x.Kind, x.RefId)));
            SaveRefs(s, id, cur); return Results.Json(new { ok = true, added = add.Count, count = cur.Count });
        }).Req(Role.Control);

        // replace the order/content: items = [{kind:"track"|"radio", refId}] (used for drag-to-reorder and removing songs)
        g.MapPut("/playlists/{id:long}/items", async (long id, HttpContext c) =>
        {
            if (Convert.ToInt32(s.Db.Scalar("SELECT COUNT(*) FROM playlist WHERE id=$i", ("$i", id))) == 0) return Ext.Bad("not found", 404);
            var b = await c.Request.Body(); if (b.Prop("items") is not JsonElement arr || arr.ValueKind != JsonValueKind.Array) return Ext.Bad("items must be a list");
            var list = new List<(string, long?)>();
            foreach (var e in arr.EnumerateArray()) { var k = e.Str("kind") ?? "track"; var r = e.Long("refId"); if (r == null || k is not ("track" or "radio")) return Ext.Bad("each item needs kind (track or radio) and refId"); list.Add((k, r)); }
            SaveRefs(s, id, list); return Results.Json(new { ok = true, count = list.Count });
        }).Req(Role.Control);

        g.MapDelete("/playlists/{id:long}/items/{index:int}", (long id, int index) =>
        {
            var cur = PlaylistRefs(s, id); if (index < 0 || index >= cur.Count) return Ext.Bad("no such position", 404);
            cur.RemoveAt(index); SaveRefs(s, id, cur); return Results.Json(new { ok = true, count = cur.Count });
        }).Req(Role.Control);

        g.MapDelete("/playlists/{id:long}", (long id) =>
        {
            s.Db.Exec("DELETE FROM playlist_item WHERE playlist_id=$i", ("$i", id)); s.Db.Exec("DELETE FROM playlist WHERE id=$i", ("$i", id)); return Results.Json(new { ok = true });
        }).Req(Role.Control);

        // import M3U/PLS text: entries are matched to library tracks by path (or file name), unmatched stream URLs become radio items
        g.MapPost("/playlists/import", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); var text = b.Str("text") ?? ""; var name = (b.Str("name") ?? "Imported playlist").Trim();
            if (text.Length is 0 or > 2_000_000) return Ext.Bad("playlist text is empty or too large");
            var entries = PlaylistParser.Parse(text, null);
            var now = DateTimeOffset.UtcNow.ToString("O"); var id = s.Db.Insert("INSERT INTO playlist(name,created_at,updated_at) VALUES($n,$t,$t)", ("$n", name.Length == 0 ? "Imported playlist" : name), ("$t", now));
            int pos = 0, matched = 0, missing = 0;
            foreach (var (loc, title) in entries)
            {
                long? tid = s.Db.Scalar("SELECT id FROM track WHERE missing=0 AND path=$p", ("$p", loc)) as long?;
                if (tid == null) { var file = Path.GetFileName(loc.Replace('\\', '/')); tid = s.Db.Scalar("SELECT id FROM track WHERE missing=0 AND (path LIKE $a ESCAPE '\\' OR path LIKE $b ESCAPE '\\') LIMIT 1", ("$a", "%/" + Esc(file)), ("$b", "%\\" + Esc(file))) as long?; }
                if (tid != null) { s.Db.Exec("INSERT INTO playlist_item(playlist_id,position,track_id) VALUES($p,$o,$t)", ("$p", id), ("$o", pos++), ("$t", tid)); matched++; }
                else if (loc.StartsWith("http://") || loc.StartsWith("https://"))
                {
                    var rid = s.Db.Insert("INSERT INTO radio_station(name,url) VALUES($n,$u)", ("$n", title ?? loc), ("$u", loc));
                    s.Db.Exec("INSERT INTO playlist_item(playlist_id,position,radio_id) VALUES($p,$o,$r)", ("$p", id), ("$o", pos++), ("$r", rid)); matched++;
                }
                else missing++;
            }
            return Results.Json(new { id, matched, missing, note = missing > 0 ? $"{missing} entries were not found in your library and were skipped." : null });
        }).Req(Role.Control);

        // ---- radio ----
        g.MapGet("/radio", () => Results.Json(s.Db.Query("SELECT id,name,url,genre,favorite,logo_url FROM radio_station ORDER BY favorite DESC, name COLLATE NOCASE",
            r => new { id = r.GetInt64(0), name = r.GetString(1), url = r.GetString(2), genre = r.IsDBNull(3) ? null : r.GetString(3), favorite = r.GetInt32(4) != 0, logoUrl = r.IsDBNull(5) ? null : r.GetString(5) }))).Req(Role.View);

        g.MapPost("/radio", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); var name = (b.Str("name") ?? "").Trim(); var url = (b.Str("url") ?? "").Trim();
            if (name.Length is 0 or > 80) return Ext.Bad("name must be 1-80 characters");
            if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || u.Scheme is not ("http" or "https")) return Ext.Bad("the stream address must start with http:// or https://");
            return Results.Json(new { id = s.Db.Insert("INSERT INTO radio_station(name,url,genre,favorite) VALUES($n,$u,$g,$f)", ("$n", name), ("$u", url), ("$g", b.Str("genre")), ("$f", b.Bool("favorite") == true ? 1 : 0)) });
        }).Req(Role.Control);

        g.MapPut("/radio/{id:long}", async (long id, HttpContext c) =>
        {
            var b = await c.Request.Body();
            if (b.Str("name") is string n) s.Db.Exec("UPDATE radio_station SET name=$n WHERE id=$i", ("$n", n.Trim()), ("$i", id));
            if (b.Str("url") is string url) { if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || u.Scheme is not ("http" or "https")) return Ext.Bad("the stream address must start with http:// or https://"); s.Db.Exec("UPDATE radio_station SET url=$u WHERE id=$i", ("$u", url), ("$i", id)); }
            if (b.Bool("favorite") is bool f) s.Db.Exec("UPDATE radio_station SET favorite=$f WHERE id=$i", ("$f", f ? 1 : 0), ("$i", id));
            return Results.Json(new { ok = true });
        }).Req(Role.Control);

        g.MapDelete("/radio/{id:long}", (long id) => { s.Db.Exec("DELETE FROM playlist_item WHERE radio_id=$i", ("$i", id)); s.Db.Exec("DELETE FROM radio_station WHERE id=$i", ("$i", id)); return Results.Json(new { ok = true }); }).Req(Role.Control);
    }

    private static List<(string Kind, long? Ref)> PlaylistRefs(Services s, long id) => s.Db.Query("SELECT track_id,radio_id FROM playlist_item WHERE playlist_id=$p ORDER BY position",
        r => r.IsDBNull(0) ? ("radio", (long?)r.GetInt64(1)) : ("track", (long?)r.GetInt64(0)), ("$p", id));

    private static void SaveRefs(Services s, long id, List<(string Kind, long? Ref)> refs)
    {
        using var c = s.Db.Open(); using var tx = c.BeginTransaction();
        Db.Exec(c, "DELETE FROM playlist_item WHERE playlist_id=$p", tx, ("$p", id)); int pos = 0;
        foreach (var (k, r) in refs) Db.Exec(c, "INSERT INTO playlist_item(playlist_id,position,track_id,radio_id) VALUES($p,$o,$t,$r)", tx, ("$p", id), ("$o", pos++), ("$t", k == "track" ? r : null), ("$r", k == "radio" ? r : null));
        Db.Exec(c, "UPDATE playlist SET updated_at=$t WHERE id=$i", tx, ("$t", DateTimeOffset.UtcNow.ToString("O")), ("$i", id));
        tx.Commit();
    }

    private static string Esc(string x) => x.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    private static void SaveItems(Services s, long playlistId, IEnumerable<QueueItem> items)
    {
        s.Db.Exec("DELETE FROM playlist_item WHERE playlist_id=$p", ("$p", playlistId)); int pos = 0;
        foreach (var it in items)
            s.Db.Exec("INSERT INTO playlist_item(playlist_id,position,track_id,radio_id) VALUES($p,$o,$t,$r)", ("$p", playlistId), ("$o", pos++), ("$t", it.Kind == "track" ? it.RefId : null), ("$r", it.Kind == "radio" ? it.RefId : null));
    }
}
