# Contributing to WavWiz

Thanks for your interest in improving WavWiz. This guide is for **public contributors** to the open-source repository.

## Ways to help

- Bug reports and clear reproductions ([SUPPORT.md](SUPPORT.md))
- Feature ideas via Issues (check existing issues first)
- Documentation fixes and small, focused pull requests
- Code contributions that match the project’s direction (synced whole-home playback on a local network)

Please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Security issues go to **vdubbin74@proton.me** only — see [SECURITY.md](SECURITY.md).

## Development overview

WavWiz is a .NET solution (`WavWiz.sln`) with a Windows server service, WinForms/WebView2 player, shared core/DSP libraries, web UI under the server project, and an Inno Setup installer.

Typical checks before opening a PR:

```text
dotnet build WavWiz.sln -c Release -warnaserror
dotnet test tests/WavWiz.Core.Tests -c Release
# Prefer also: Dsp, Measure, Server.Tests as relevant to your change
sh tests/js/run.sh                    # if you touch browser/UI logic
```

Installer and FFmpeg rebuilds are heavier; see `docs/` and `build/` in the repository if your change needs them. End-user install steps: [docs/FIRST-RUN.md](docs/FIRST-RUN.md).

## Code style (high level)

- Prefer clear, boring names and small diffs over large refactors in the same PR.
- Match the style of the file you edit (C#, PowerShell, JavaScript/CSS as applicable).
- American English in user-visible strings.
- Do not commit secrets, home network IPs, personal paths, or machine-specific config.
- Keep third-party license obligations intact (LGPL shared builds stay replaceable; see [docs/THIRD-PARTY.md](docs/THIRD-PARTY.md)).
- No claims of affiliation with Apple or Spotify in UI or docs. Spotify Connect remains optional, unofficial, and Premium-gated in messaging.

## Pull requests

1. Fork (or branch), keep changes focused on one topic.
2. Describe **what** changed and **why**; link related Issues.
3. Note how you tested (commands, OS, Server vs Player).
4. Do not include installer binaries or huge binaries in the PR unless maintainers ask.
5. Be ready to iterate on review feedback.

Maintainer merge criteria are ordinary open-source judgment: correctness, clarity, license cleanliness, and fit for a local-network music product.

## Out of scope for this file

Internal scheduling, private assignee workflows, and unpublished release engineering are not documented here. Public contributors only need this file, Issues/Discussions, and the docs linked above.
