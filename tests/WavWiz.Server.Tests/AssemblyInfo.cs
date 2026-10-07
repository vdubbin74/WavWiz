[assembly: Xunit.CollectionBehavior(DisableTestParallelization = true)]   // the E2E sync tests measure sub-millisecond timing; other tests running at the same time make them flaky
