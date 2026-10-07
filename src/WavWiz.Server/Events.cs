using System.Collections.Concurrent;
using System.Text.Json;
using System.Threading.Channels;
namespace WavWiz.Server;

/// <summary>Fan-out of state changes to web UI WebSockets. Slow clients are dropped, never waited for.</summary>
public sealed class EventHub
{
    private readonly ConcurrentDictionary<int, Channel<string>> _subs = new(); private int _n;
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.Never };

    public (int Id, ChannelReader<string> Reader) Subscribe()
    {
        var ch = Channel.CreateBounded<string>(new BoundedChannelOptions(256) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });
        int id = Interlocked.Increment(ref _n); _subs[id] = ch; return (id, ch.Reader);
    }
    public void Unsubscribe(int id) { if (_subs.TryRemove(id, out var c)) c.Writer.TryComplete(); }
    public int Count => _subs.Count;

    public void Publish(string type, object? data = null)
    {
        var msg = JsonSerializer.Serialize(new { type, data }, Json);
        foreach (var c in _subs.Values) c.Writer.TryWrite(msg);
    }
}
