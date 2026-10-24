namespace WavWiz.Server.Tests;

/// <summary>0.4.4 H2/H3: timing-sensitive end-to-end tests run on their own, never in parallel with the rest of the suite.</summary>
[CollectionDefinition("serial", DisableParallelization = true)]
public class SerialCollection { }
