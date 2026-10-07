using System.Diagnostics;
namespace WavWiz.Core.Clock;

/// <summary>Monotonic microsecond clock (QPC-based in production; virtual in the simulator). Never wall-clock time (spec 7.1).</summary>
public interface IMonotonicClock { long NowUs { get; } }

public sealed class StopwatchClock : IMonotonicClock
{
    public long NowUs => (long)(Stopwatch.GetTimestamp() * 1_000_000.0 / Stopwatch.Frequency);
}
