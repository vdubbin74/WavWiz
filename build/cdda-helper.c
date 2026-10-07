/* wavwiz-cdda — LGPL helper: extract one audio-CD track to a WAV file via libcdio/paranoia.
 * Kept OUTSIDE FFmpeg because FFmpeg's libcdio demuxer is GPL-gated; WavWiz's FFmpeg stays LGPL.
 * Usage: wavwiz-cdda.exe <drive> <track1based> <out.wav>
 *        wavwiz-cdda.exe --count <drive>     prints track count to stdout
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <cdio/cdio.h>
#include <cdio/paranoia/paranoia.h>

static int write_wav_header(FILE *f, unsigned long data_bytes) {
  unsigned char h[44];
  unsigned long sr = 44100, byte_rate = sr * 4;
  unsigned short ch = 2, bps = 16, ba = 4;
  memcpy(h, "RIFF", 4);
  unsigned long chunk = 36 + data_bytes;
  h[4]=chunk; h[5]=chunk>>8; h[6]=chunk>>16; h[7]=chunk>>24;
  memcpy(h+8, "WAVEfmt ", 8);
  h[16]=16; h[17]=h[18]=h[19]=0; /* PCM fmt chunk size */
  h[20]=1; h[21]=0; /* PCM */
  h[22]=ch; h[23]=0;
  h[24]=sr; h[25]=sr>>8; h[26]=sr>>16; h[27]=sr>>24;
  h[28]=byte_rate; h[29]=byte_rate>>8; h[30]=byte_rate>>16; h[31]=byte_rate>>24;
  h[32]=ba; h[33]=0; h[34]=bps; h[35]=0;
  memcpy(h+36, "data", 4);
  h[40]=data_bytes; h[41]=data_bytes>>8; h[42]=data_bytes>>16; h[43]=data_bytes>>24;
  return fwrite(h, 1, 44, f) == 44;
}

static int count_tracks(const char *drive) {
  CdIo_t *cdio = cdio_open(drive, DRIVER_DEVICE);
  if (!cdio) { fprintf(stderr, "cannot open %s\n", drive); return -1; }
  track_t first = cdio_get_first_track_num(cdio);
  track_t last = cdio_get_last_track_num(cdio);
  int n = 0;
  for (track_t t = first; t <= last; t++)
    if (cdio_get_track_format(cdio, t) == TRACK_FORMAT_AUDIO) n++;
  cdio_destroy(cdio);
  return n;
}

static int rip_track(const char *drive, int track1, const char *outpath) {
  CdIo_t *cdio = cdio_open(drive, DRIVER_DEVICE);
  if (!cdio) { fprintf(stderr, "cannot open %s\n", drive); return 2; }
  track_t first = cdio_get_first_track_num(cdio);
  track_t last = cdio_get_last_track_num(cdio);
  track_t target = 0; int seen = 0;
  for (track_t t = first; t <= last; t++) {
    if (cdio_get_track_format(cdio, t) != TRACK_FORMAT_AUDIO) continue;
    seen++;
    if (seen == track1) { target = t; break; }
  }
  if (!target) { fprintf(stderr, "track %d not found\n", track1); cdio_destroy(cdio); return 3; }

  cdrom_drive_t *d = cdio_cddap_identify_cdio(cdio, 1, NULL);
  if (!d) { fprintf(stderr, "paranoia identify failed\n"); cdio_destroy(cdio); return 4; }
  if (cdio_cddap_open(d) != 0) { fprintf(stderr, "paranoia open failed\n"); cdio_cddap_close(d); return 5; }
  cdrom_paranoia_t *p = cdio_paranoia_init(d);
  if (!p) { fprintf(stderr, "paranoia init failed\n"); cdio_cddap_close(d); return 6; }

  lsn_t start = cdio_cddap_track_firstsector(d, target);
  lsn_t end = cdio_cddap_track_lastsector(d, target);
  FILE *out = fopen(outpath, "wb");
  if (!out) { perror(outpath); cdio_paranoia_free(p); cdio_cddap_close(d); return 7; }
  /* placeholder header; rewrite at end */
  unsigned long data_bytes = 0;
  write_wav_header(out, 0);
  cdio_paranoia_seek(p, start, SEEK_SET);
  for (lsn_t s = start; s <= end; s++) {
    int16_t *buf = cdio_paranoia_read_limited(p, NULL, 3);
    if (!buf) { fprintf(stderr, "read failed at sector %ld\n", (long)s); break; }
    /* CDDA sector = 2352 bytes = 1176 int16 samples */
    if (fwrite(buf, 1, CDIO_CD_FRAMESIZE_RAW, out) != CDIO_CD_FRAMESIZE_RAW) { perror("write"); break; }
    data_bytes += CDIO_CD_FRAMESIZE_RAW;
  }
  fseek(out, 0, SEEK_SET);
  write_wav_header(out, data_bytes);
  fclose(out);
  cdio_paranoia_free(p);
  cdio_cddap_close(d);
  /* cdio ownership transferred to drive; closed above */
  fprintf(stderr, "ripped track %d -> %s (%lu bytes)\n", track1, outpath, data_bytes);
  return data_bytes ? 0 : 8;
}

int main(int argc, char **argv) {
  if (argc == 3 && strcmp(argv[1], "--count") == 0) {
    int n = count_tracks(argv[2]);
    if (n < 0) return 1;
    printf("%d\n", n);
    return 0;
  }
  if (argc != 4) {
    fprintf(stderr, "Usage: %s <drive> <track> <out.wav>\n       %s --count <drive>\n", argv[0], argv[0]);
    return 1;
  }
  return rip_track(argv[1], atoi(argv[2]), argv[3]);
}
