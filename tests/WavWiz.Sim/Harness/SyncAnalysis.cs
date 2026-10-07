namespace WavWiz.Sim.Harness;

/// <summary>Compares what actually came out of the virtual DACs, in true time (spec 18.2). Nothing here is visible to the code under test.</summary>
public static class SyncAnalysis
{
    public sealed record Series(double[] StartPos, Block[] Blocks, double FramePeriodUs);

    public static Series Build(SimPlayer p, long fromTrueUs)
    {
        var blocks = p.Log.Where(b => b.Clean && b.AudibleTrueUs >= fromTrueUs && b.EndPos > b.StartPos).OrderBy(b => b.StartPos).ToArray();
        double period = 1e6 / (p.Cfg.OutputRate * (1 + p.Cfg.CardSkewPpm * 1e-6));
        return new Series(blocks.Select(b => b.StartPos).ToArray(), blocks, period);
    }

    /// <summary>True time (us) at which stream sample <paramref name="s"/> is audible, or null if no clean block covers it.</summary>
    public static double? AudibleAt(Series ser, double s)
    {
        int i = Array.BinarySearch(ser.StartPos, s);
        if (i < 0) i = ~i - 1;
        if (i < 0 || i >= ser.Blocks.Length) return null;
        var b = ser.Blocks[i];
        if (s >= b.EndPos) return null;
        return b.AudibleTrueUs + (s - b.StartPos) / (b.EndPos - b.StartPos) * b.Frames * ser.FramePeriodUs;
    }

    public sealed record PairStats(string A, string B, int Points, double MeanMs, double MaxAbsMs, double P95AbsMs);

    /// <summary>Signed offset (A audible time - B audible time), sampled every <paramref name="stepSamples"/> over the stream window.</summary>
    public static PairStats Compare(SimPlayer a, SimPlayer b, long fromTrueUs, double fromS, double toS, double stepSamples = 48000)
    {
        var sa = Build(a, fromTrueUs); var sb = Build(b, fromTrueUs);
        var d = new List<double>();
        for (double s = fromS; s < toS; s += stepSamples)
        {
            var ta = AudibleAt(sa, s); var tb = AudibleAt(sb, s);
            if (ta is double x && tb is double y) d.Add((x - y) / 1000.0);
        }
        if (d.Count == 0) return new PairStats(a.Id, b.Id, 0, double.NaN, double.NaN, double.NaN);
        var abs = d.Select(Math.Abs).OrderBy(v => v).ToArray();
        return new PairStats(a.Id, b.Id, d.Count, d.Average(), abs[^1], abs[(int)(abs.Length * 0.95)]);
    }
}
