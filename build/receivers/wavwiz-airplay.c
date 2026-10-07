/* wavwiz-airplay: AirPlay (RAOP / AirPlay 1) audio receiver for WavWiz, built on the unmodified shairplay library
   (https://github.com/juhovh/shairplay, LGPL-2.1+; ALAC MIT, crypto BSD). This file: MIT, part of WavWiz.
   Runs as a separate process started by wavwiz-server. Audio: raw PCM s16le stereo 44100 Hz on stdout.
   Events: one text line each on stderr ("READY <port>", "INIT", "FLUSH", "STOP", "VOL <dB>", "META <base64 DMAP>", "ART <base64>", "PROG <start> <cur> <end>", "DACP <id> <active-remote>", "LOG <msg>").
   Advertising (mDNS _raop._tcp) is done by wavwiz-server's own responder; no Bonjour needed.
   usage: wavwiz-airplay --port 5000 --hwaddr AA:BB:CC:DD:EE:FF --key airport.key */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <winsock2.h>
#include <windows.h>
#include <io.h>
#include <fcntl.h>
static CRITICAL_SECTION lk; static void lk_init(void){InitializeCriticalSection(&lk);} static void lk_on(void){EnterCriticalSection(&lk);} static void lk_off(void){LeaveCriticalSection(&lk);}
static void sleep_ms(int ms){Sleep(ms);}
#else
#include <pthread.h>
#include <unistd.h>
static pthread_mutex_t lk = PTHREAD_MUTEX_INITIALIZER; static void lk_init(void){} static void lk_on(void){pthread_mutex_lock(&lk);} static void lk_off(void){pthread_mutex_unlock(&lk);}
static void sleep_ms(int ms){usleep(ms*1000);}
#endif
#include <shairplay/raop.h>

static void *current = NULL;
static const char b64t[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
static void emit_b64(const char *tag, const unsigned char *p, int n) {
	int i; lk_on(); fputs(tag, stderr); fputc(' ', stderr);
	for (i = 0; i < n; i += 3) {
		unsigned v = p[i] << 16 | (i + 1 < n ? p[i + 1] << 8 : 0) | (i + 2 < n ? p[i + 2] : 0);
		fputc(b64t[v >> 18 & 63], stderr); fputc(b64t[v >> 12 & 63], stderr);
		fputc(i + 1 < n ? b64t[v >> 6 & 63] : '=', stderr); fputc(i + 2 < n ? b64t[v & 63] : '=', stderr);
	}
	fputc('\n', stderr); fflush(stderr); lk_off();
}
static void emit(const char *fmt, const char *a, double d) { lk_on(); if (a) fprintf(stderr, fmt, a); else fprintf(stderr, fmt, d); fflush(stderr); lk_off(); }

static void *audio_init(void *cls, int bits, int channels, int samplerate) {
	static int n = 0; void *s = (void *)(size_t)(++n);
	lk_on(); current = s; fprintf(stderr, "INIT %d %d %d\n", bits, channels, samplerate); fflush(stderr); lk_off();
	return s;
}
static void audio_process(void *cls, void *session, const void *buf, int len) {
	if (session != current) return;                 /* the newest sender wins */
	lk_on(); fwrite(buf, 1, len, stdout); fflush(stdout); lk_off();
}
static void audio_destroy(void *cls, void *session) { if (session == current) { emit("STOP\n", "", 0); current = NULL; } }
static void audio_flush(void *cls, void *session) { if (session == current) emit("FLUSH\n", "", 0); }
static void audio_set_volume(void *cls, void *session, float v) { if (session == current) emit("VOL %.2f\n", NULL, v); }
static void audio_set_metadata(void *cls, void *session, const void *b, int n) { if (session == current) emit_b64("META", b, n); }
static void audio_set_coverart(void *cls, void *session, const void *b, int n) { if (session == current) emit_b64("ART", b, n); }
static void audio_set_progress(void *cls, void *session, unsigned int s, unsigned int c, unsigned int e) {
	if (session != current) return; lk_on(); fprintf(stderr, "PROG %u %u %u\n", s, c, e); fflush(stderr); lk_off();
}
static void remote_id(void *cls, const char *id, const char *ar) { lk_on(); fprintf(stderr, "DACP %s %s\n", id ? id : "-", ar ? ar : "-"); fflush(stderr); lk_off(); }
static void log_cb(void *cls, int level, const char *msg) { if (level <= RAOP_LOG_WARNING) emit("LOG %s\n", msg, 0); }

int main(int argc, char **argv) {
	unsigned short port = 5000; char hw[6] = { 0x02, 0x57, 0x57, 0x01, 0x01, 0x01 }; const char *key = "airport.key"; int i, err = 0;
	raop_callbacks_t cb; raop_t *raop;
	for (i = 1; i + 1 < argc; i++) {
		if (!strcmp(argv[i], "--port")) port = (unsigned short)atoi(argv[++i]);
		else if (!strcmp(argv[i], "--key")) key = argv[++i];
		else if (!strcmp(argv[i], "--hwaddr")) { const char *h = argv[++i]; int k; for (k = 0; k < 6 && strlen(h) >= (size_t)(k * 3 + 2); k++) hw[k] = (char)strtol(h + k * 3, NULL, 16); }
	}
#ifdef _WIN32
	_setmode(_fileno(stdout), _O_BINARY);
	{ WSADATA w; WSAStartup(MAKEWORD(2, 2), &w); }
#endif
	lk_init();
	memset(&cb, 0, sizeof(cb));
	cb.audio_init = audio_init; cb.audio_process = audio_process; cb.audio_destroy = audio_destroy; cb.audio_flush = audio_flush;
	cb.audio_set_volume = audio_set_volume; cb.audio_set_metadata = audio_set_metadata; cb.audio_set_coverart = audio_set_coverart;
	cb.audio_set_progress = audio_set_progress; cb.audio_remote_control_id = remote_id;
	raop = raop_init_from_keyfile(4, &cb, key, &err);
	if (!raop) { fprintf(stderr, "LOG cannot initialize the receiver (key file %s, error %d)\n", key, err); return 2; }
	raop_set_log_callback(raop, log_cb, NULL); raop_set_log_level(raop, RAOP_LOG_WARNING);
	if (raop_start(raop, &port, hw, 6, NULL) < 0) { fprintf(stderr, "LOG cannot listen on TCP port %u\n", port); raop_destroy(raop); return 3; }
	fprintf(stderr, "READY %u\n", port); fflush(stderr);
	/* run until the parent closes our stdin (wavwiz-server stops or restarts us) */
	while (fgetc(stdin) != EOF) { }
	raop_stop(raop); raop_destroy(raop);
	return 0;
}
