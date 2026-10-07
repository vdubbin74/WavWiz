# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| Latest public beta release | Yes |
| Older beta / pre-release builds | No — please upgrade |

WavWiz is in **public beta**. Security fixes ship in the newest beta release on [GitHub Releases](https://github.com/vdubbin74/WavWiz/releases).

## Reporting a vulnerability

**Do not open a public GitHub Issue for security problems.**

Please report vulnerabilities privately by email to:

**vdubbin74@proton.me**

Include as much of the following as you can:

- WavWiz version (Help → About, or the installer filename such as `WavWiz-Setup-<version>.exe`)
- Windows version and whether the report involves Server, Player, web UI, AirPlay, or Spotify Connect
- A clear description of the issue and its impact
- Steps to reproduce, or a proof of concept if you have one
- Whether you are okay with being credited if a fix is published

You should receive an acknowledgment when the mailbox is monitored. Please allow reasonable time for investigation before any public disclosure.

## Scope notes

- WavWiz is designed for a **home / private network**. Binding the server to all interfaces or exposing it to the public internet is unsupported and increases risk.
- Optional **Spotify Connect** uses an unofficial open-source client; Spotify account credentials are not stored by WavWiz (you sign in on your own Spotify client). Report WavWiz-side issues here; Spotify account compromise belongs with Spotify’s own support channels.
- Please do not include passwords, library paths that reveal personal data you are unwilling to share, or unrelated malware samples in the initial report without warning.
