using System.Net.Http.Json;
using System.Text.Json;
using WavWiz.Server.Api;
namespace WavWiz.Server.Features;

/// <summary>B6: Radio Browser API search/browse + podcast RSS. Direct stream URLs only (no Spotify/Apple/Pandora/iHeart custom).</summary>
public sealed class RadioFinderService
{
    private readonly Db _db;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(12) };
    private static readonly string[] Hosts = { "de1.api.radio-browser.info", "nl1.api.radio-browser.info", "at1.api.radio-browser.info" };
    public RadioFinderService(Db db) { _db = db; _http.DefaultRequestHeaders.UserAgent.ParseAdd("WavWiz/0.0.7 (home LAN radio finder)"); }

    public async Task<object> SearchAsync(string? name, string? tag, string? country, int limit = 40)
    {
        limit = Math.Clamp(limit, 1, 100);
        var q = new List<string> { "hidebroken=true", "order=clickcount", "reverse=true", $"limit={limit}" };
        if (!string.IsNullOrWhiteSpace(name)) q.Add("name=" + Uri.EscapeDataString(name));
        if (!string.IsNullOrWhiteSpace(tag)) q.Add("tag=" + Uri.EscapeDataString(tag));
        if (!string.IsNullOrWhiteSpace(country)) q.Add("countrycode=" + Uri.EscapeDataString(country.Trim().ToUpperInvariant()));
        var path = "/json/stations/search?" + string.Join('&', q);
        var rows = await GetAsync<List<JsonElement>>(path) ?? new();
        return rows.Select(MapStation).ToList();
    }

    public async Task<object> ByTagAsync(string tag, int limit = 40) => await SearchAsync(null, tag, null, limit);
    public async Task<object> CountriesAsync()
    {
        var rows = await GetAsync<List<JsonElement>>("/json/countries") ?? new();
        return rows.Select(r => new { name = r.Str("name"), code = r.Str("iso_3166_1"), count = r.Long("stationcount") }).Where(x => x.code != null).OrderBy(x => x.name).ToList();
    }
    public async Task<object> TagsAsync(int limit = 80)
    {
        var rows = await GetAsync<List<JsonElement>>("/json/tags?order=stationcount&reverse=true&limit=" + Math.Clamp(limit, 1, 200)) ?? new();
        return rows.Select(r => new { name = r.Str("name"), count = r.Long("stationcount") }).Where(x => !string.IsNullOrWhiteSpace(x.name)).ToList();
    }

    public object Favorites() => _db.Query("SELECT stationuuid,name,url,favicon,tags,country,added_at FROM radio_finder_fav ORDER BY name COLLATE NOCASE",
        r => new { stationuuid = r.GetString(0), name = r.GetString(1), url = r.GetString(2), favicon = r.IsDBNull(3) ? null : r.GetString(3), tags = r.IsDBNull(4) ? null : r.GetString(4), country = r.IsDBNull(5) ? null : r.GetString(5), addedAt = r.GetString(6) });

    public string? AddFavorite(JsonElement b)
    {
        var uuid = b.Str("stationuuid") ?? b.Str("id") ?? Guid.NewGuid().ToString("N");
        var name = (b.Str("name") ?? "").Trim(); var url = (b.Str("url") ?? b.Str("url_resolved") ?? "").Trim();
        if (name.Length == 0 || !Uri.TryCreate(url, UriKind.Absolute, out var u) || u.Scheme is not ("http" or "https")) return "name and http(s) stream url required";
        _db.Exec("INSERT INTO radio_finder_fav(stationuuid,name,url,favicon,tags,country,added_at) VALUES($i,$n,$u,$f,$t,$c,$a) ON CONFLICT(stationuuid) DO UPDATE SET name=$n,url=$u,favicon=$f,tags=$t,country=$c",
            ("$i", uuid), ("$n", name), ("$u", url), ("$f", b.Str("favicon")), ("$t", b.Str("tags")), ("$c", b.Str("country")), ("$a", DateTimeOffset.UtcNow.ToString("O")));
        return null;
    }
    public void RemoveFavorite(string uuid) => _db.Exec("DELETE FROM radio_finder_fav WHERE stationuuid=$i", ("$i", uuid));

    /// <summary>Add a Radio Browser / finder station into the local radio_station table and return its id.</summary>
    public long SaveToLibrary(JsonElement b)
    {
        var name = (b.Str("name") ?? "Station").Trim(); var url = (b.Str("url") ?? b.Str("url_resolved") ?? "").Trim();
        var genre = b.Str("tags") ?? b.Str("genre");
        var logo = b.Str("favicon") ?? b.Str("logo_url") ?? b.Str("logoUrl");
        var existing = _db.Scalar("SELECT id FROM radio_station WHERE url=$u", ("$u", url)) as long?;
        if (existing != null)
        {
            if (!string.IsNullOrWhiteSpace(logo)) _db.Exec("UPDATE radio_station SET logo_url=$l WHERE id=$i AND (logo_url IS NULL OR logo_url='')", ("$l", logo), ("$i", existing.Value));
            return existing.Value;
        }
        return _db.Insert("INSERT INTO radio_station(name,url,genre,favorite,logo_url) VALUES($n,$u,$g,1,$l)", ("$n", name), ("$u", url), ("$g", genre), ("$l", logo));
    }

    public object Podcasts() => _db.Query("SELECT id,title,url,added_at FROM podcast_feed ORDER BY title COLLATE NOCASE",
        r => new { id = r.GetInt64(0), title = r.GetString(1), url = r.GetString(2), addedAt = r.GetString(3) });

    public async Task<(long Id, string? Err)> AddPodcastAsync(string? url)
    {
        url = (url ?? "").Trim(); if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || u.Scheme is not ("http" or "https")) return (0, "podcast RSS url must be http(s)");
        string title = u.Host;
        try
        {
            var xml = await _http.GetStringAsync(u);
            var m = System.Text.RegularExpressions.Regex.Match(xml, @"<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>", System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.Singleline);
            if (m.Success) title = System.Net.WebUtility.HtmlDecode(m.Groups[1].Value.Trim());
            if (title.Length > 120) title = title[..120];
        }
        catch (Exception e) { return (0, "could not fetch podcast feed: " + e.Message); }
        var id = _db.Insert("INSERT INTO podcast_feed(title,url,added_at) VALUES($t,$u,$a)", ("$t", title), ("$u", url), ("$a", DateTimeOffset.UtcNow.ToString("O")));
        return (id, null);
    }
    public void RemovePodcast(long id) => _db.Exec("DELETE FROM podcast_feed WHERE id=$i", ("$i", id));

    public async Task<object?> PodcastEpisodesAsync(long id, int limit = 30)
    {
        var url = _db.Scalar("SELECT url FROM podcast_feed WHERE id=$i", ("$i", id)) as string; if (url == null) return null;
        var xml = await _http.GetStringAsync(url);
        var items = System.Text.RegularExpressions.Regex.Matches(xml, @"<item\b[\s\S]*?</item>", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        var list = new List<object>();
        foreach (System.Text.RegularExpressions.Match it in items)
        {
            if (list.Count >= limit) break;
            var block = it.Value;
            string? T(string tag) { var m = System.Text.RegularExpressions.Regex.Match(block, $@"<{tag}[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</{tag}>", System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.Singleline); return m.Success ? System.Net.WebUtility.HtmlDecode(m.Groups[1].Value.Trim()) : null; }
            var enc = System.Text.RegularExpressions.Regex.Match(block, @"url=""(https?://[^""]+)""", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            if (!enc.Success) continue;
            list.Add(new { title = T("title") ?? "Episode", url = enc.Groups[1].Value, pubDate = T("pubDate"), duration = T("itunes:duration") });
        }
        return list;
    }

    private static object MapStation(JsonElement r) => new {
        stationuuid = r.Str("stationuuid"), name = r.Str("name"), url = r.Str("url_resolved") ?? r.Str("url"),
        favicon = r.Str("favicon"), tags = r.Str("tags"), country = r.Str("country"), countrycode = r.Str("countrycode"),
        bitrate = r.Long("bitrate"), codec = r.Str("codec"), homepage = r.Str("homepage")
    };

    private async Task<T?> GetAsync<T>(string path)
    {
        Exception? last = null;
        foreach (var host in Hosts)
        {
            try
            {
                using var resp = await _http.GetAsync($"https://{host}{path}");
                if (!resp.IsSuccessStatusCode) { last = new Exception($"{host} HTTP {(int)resp.StatusCode}"); continue; }
                return await resp.Content.ReadFromJsonAsync<T>();
            }
            catch (Exception e) { last = e; }
        }
        throw new InvalidOperationException("Radio Browser is unreachable from this PC right now. " + (last?.Message ?? ""));
    }
}
