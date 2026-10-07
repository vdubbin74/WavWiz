/* wavwiz-hook: librespot --onevent forwarder for WavWiz (MIT). librespot runs it once per player event with the event in environment
   variables; it sends them as KEY=VALUE lines in one UDP datagram to wavwiz-server on 127.0.0.1:<port>, prefixed by a per-run token.
   usage: wavwiz-hook.exe <port> <token> */
#include <winsock2.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static const char *keys[] = { "PLAYER_EVENT", "TRACK_ID", "URI", "NAME", "ARTISTS", "ALBUM", "ALBUM_ARTISTS", "COVERS", "DURATION_MS", "POSITION_MS", "VOLUME", "ITEM_TYPE", "SHOW_NAME", "USER_NAME", "SINK_STATUS", "CLIENT_NAME", NULL };
int main(int argc, char **argv) {
	static char buf[60000]; size_t n = 0; int i; WSADATA w; SOCKET s; struct sockaddr_in a;
	if (argc < 3) return 1;
	n += (size_t)snprintf(buf, sizeof(buf), "WAVWIZ %s\n", argv[2]);
	for (i = 0; keys[i]; i++) {
		const char *v = getenv(keys[i]); if (!v) continue;
		if (n + strlen(keys[i]) + strlen(v) + 4 >= sizeof(buf)) break;
		n += (size_t)snprintf(buf + n, sizeof(buf) - n, "%s=", keys[i]);
		for (; *v; v++) buf[n++] = (*v == '\n' || *v == '\r') ? '\t' : *v;   /* multi-line values (COVERS, ARTISTS) become tab-separated */
		buf[n++] = '\n';
	}
	if (WSAStartup(MAKEWORD(2, 2), &w)) return 2;
	s = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP); if (s == INVALID_SOCKET) return 3;
	memset(&a, 0, sizeof(a)); a.sin_family = AF_INET; a.sin_port = htons((unsigned short)atoi(argv[1])); a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
	sendto(s, buf, (int)n, 0, (struct sockaddr *)&a, sizeof(a)); closesocket(s); WSACleanup();
	return 0;
}
