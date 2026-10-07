using System.Buffers.Binary;
using WavWiz.Core.Clock;
using WavWiz.Core.Playback;
using WavWiz.Core.Protocol;
using WavWiz.Core.Stream;

namespace WavWiz.Sim.Harness;

public sealed class PlayerConfig
{
    public string Name { get; init; } = "player";
    public VirtualClock Clock { get; init; } = new();
    public double CardSkewPpm { get; init; }
    public int OutputRate { get; init; } = 48000;
    public int PeriodFrames { get; init; } = 480;
    /// <summary>What WASAPI would report as the output pipeline latency (the engine knows this).</summary>
    public long ReportedLatencyUs { get; init; } = 20_000;
    /// <summary>Delay inside e.g. a Bluetooth speaker that Windows does NOT report; only calibration can know it.</summary>
    public long HiddenLatencyUs { get; init; }
    /// <summary>The saved per-speaker offset applied by the engine (ms). null = nothing saved yet.</summary>
    public double? SavedLatencyMs { get; init; }
    public int BufferDepthMs { get; init; } = 3000;
    public Link? Down { get; init; }      // server -> player (TCP audio)
    public Link? PingUp { get; init; }    // player -> server (UDP clock)
    public Link? PingDown { get; init; }  // server -> player (UDP clock)
    public long StartAtUs { get; init; }
    public EngineOptions? Engine { get; init; }
    public IAudioProcessor? Processor { get; init; }
    /// <summary>What the processor REALLY adds (the harness knows; the engine only knows Processor.LatencyUs).</summary>
    public long ProcessorTrueLatencyUs { get; init; }
}

public readonly record struct Block(long AudibleTrueUs, double StartPos, double EndPos, bool Clean, int Frames, float FirstValue);

/// <summary>A virtual player: real ClockModel + PlaybackEngine + real wire decoding, with a virtual sound card, clock and network.</summary>
public sealed class SimPlayer : IStreamSubscriber
{
    private readonly SimKernel _k;
    private readonly SimServer _server;
    public PlayerConfig Cfg { get; }
    public ClockModel Clock { get; } = new();
    public PlaybackEngine Engine { get; }
    public List<Block> Log { get; } = new();
    public bool Connected { get; private set; }
    private readonly float[] _out;
    private long _cardStartUs;
    private long _renderIndex;
    private long _pingCount;
    private int _gen;
    private bool _renderStarted;
    public long ProcessorTrueLatencyUs { get; set; }

    public string Id => Cfg.Name;
    public int BufferDepthMs => Cfg.BufferDepthMs;

    public SimPlayer(SimKernel k, SimServer server, PlayerConfig cfg)
    {
        _k = k; _server = server; Cfg = cfg; ProcessorTrueLatencyUs = cfg.ProcessorTrueLatencyUs;
        Engine = new PlaybackEngine(Clock, cfg.Engine ?? new EngineOptions { OutputRate = cfg.OutputRate });
        if (cfg.SavedLatencyMs is double ms) Engine.SetDeviceLatencyMs(ms);
        if (cfg.Processor != null) Engine.SetProcessor(cfg.Processor);
        _out = new float[cfg.PeriodFrames * 2];
        _cardStartUs = cfg.StartAtUs;
        k.At(cfg.StartAtUs, Connect);
    }

    public void Connect()
    {
        Connected = true; _gen++; _pingCount = 0;
        Clock.Reset(keepSkew: true);                 // resume: restart the clock model with fast pings (spec 7.7)
        _server.Stream.Subscribe(this);
        SchedulePing(0, _gen);
        if (!_renderStarted) { _renderStarted = true; ScheduleRender(); }
    }

    /// <summary>Sleep / network loss at the OS level: drop the buffer and stop talking (spec 7.7).</summary>
    public void Disconnect() { Connected = false; _gen++; Engine.Flush(); _server.Stream.Unsubscribe(Id); }

    // ---- network ----
    public void Send(byte[] message)
    {
        if (!Connected) return;
        long arrive = Cfg.Down!.TcpArrival(_k.TrueNowUs);
        _k.At(arrive, () => { if (Connected) Receive(message); });
    }

    private void Receive(byte[] msg)
    {
        if (!Wire.TryReadHeader(msg, out var h, out var err)) throw new InvalidDataException(err);
        var payload = msg.AsSpan(Wire.HeaderSize, (int)h.PayloadLen);
        switch (h.Type)
        {
            case MsgType.Epoch: Wire.TryDecodeEpoch(payload, out var e, out var start); Engine.OnEpoch(e, start); break;
            case MsgType.Audio: if (Wire.TryDecodeAudio(payload, out var f, out _)) Engine.OnAudio(f!); break;
            case MsgType.StopAt: Wire.TryDecodeStopAt(payload, out var se, out var at); Engine.OnStopAt(se, at); break;
        }
    }

    // ---- clock sync (spec 6.2): 4 Hz for 10 s, then 1 Hz ----
    private void SchedulePing(long delayUs, int gen)
    {
        _k.After(delayUs, () =>
        {
            if (!Connected || gen != _gen) return;
            long sendTrue = _k.TrueNowUs;
            long t0 = Cfg.Clock.LocalAt(sendTrue);
            var up = Cfg.PingUp!.UdpArrival(sendTrue);
            if (up is long upAt)
            {
                _k.At(upAt, () =>
                {
                    long t1 = ((IMonotonicClock)_k).NowUs; long t2 = t1;
                    var down = Cfg.PingDown!.UdpArrival(_k.TrueNowUs);
                    if (down is long dn)
                        _k.At(dn, () => { if (Connected) Clock.AddPong(t0, t1, t2, Cfg.Clock.LocalAt(_k.TrueNowUs)); });
                });
            }
            _pingCount++;
            SchedulePing(_pingCount < 40 ? 250_000 : 1_000_000, gen);
        });
    }

    // ---- virtual sound card ----
    private void ScheduleRender()
    {
        double periodTrueUs = Cfg.PeriodFrames * 1e6 / (Cfg.OutputRate * (1 + Cfg.CardSkewPpm * 1e-6));
        long at = _cardStartUs + (long)Math.Round(_renderIndex * periodTrueUs);
        _k.At(at, () =>
        {
            if (!Connected) { _renderIndex++; ScheduleRender(); return; }
            long dacTrue = _k.TrueNowUs + Cfg.ReportedLatencyUs;                // what the driver tells the engine
            long dacLocal = Cfg.Clock.LocalAt(dacTrue);
            Engine.Render(_out, Cfg.PeriodFrames, dacLocal);
            var b = Engine.LastBlock;
            Log.Add(new Block(dacTrue + Cfg.HiddenLatencyUs + ProcessorTrueLatencyUs, b.StartPos, b.EndPos, b.Clean, Cfg.PeriodFrames, _out[0]));
            _renderIndex++;
            ScheduleRender();
        });
    }
}
