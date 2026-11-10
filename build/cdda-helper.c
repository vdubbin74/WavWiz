/* wavwiz-cdda — LGPL helper: extract one audio-CD track to a WAV file.
 * Usage: wavwiz-cdda.exe <drive> <track1based> <out.wav>
 *        wavwiz-cdda.exe --count <drive>     prints track count to stdout
 *        wavwiz-cdda.exe --toc <drive>       prints TOC (LSN) for MusicBrainz disc IDs
 *        wavwiz-cdda.exe --cdtext <drive>    prints CD-Text when the disc has it
 *
 * On Windows this talks to the CD-ROM class driver with GENERIC_READ only:
 *   IOCTL_CDROM_READ_TOC_EX (TOC, session, CD-Text) and IOCTL_CDROM_RAW_READ (CDDA).
 * Those IOCTLs are FILE_READ_ACCESS (ntddcdrm.h). SCSI pass-through (SPTI) is
 * not used: IOCTL_SCSI_PASS_THROUGH_DIRECT is FILE_READ_ACCESS|FILE_WRITE_ACCESS
 * (ntddscsi.h), and Microsoft requires read/write access to the device for it.
 * libcdio's win32 ioctl layer opens GENERIC_READ|GENERIC_WRITE and prefers MMC
 * via SPTI, so NT AUTHORITY\LocalService can open the drive but then wait out
 * an empty TOC. Keep this helper's FFmpeg-side build LGPL; libcdio is used on
 * non-Windows only.
 *
 * Rip path: batched 75, then 26, then 1 with retries.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifndef _WIN32
#include <cdio/cdio.h>
#include <cdio/cdtext.h>
#endif
#ifdef _WIN32
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0601
#endif
#include <windows.h>
#include <ntddcdrm.h>
#define NAP_MS(ms) Sleep(ms)
#else
#include <unistd.h>
#define NAP_MS(ms) usleep((unsigned)(ms) * 1000)
#endif

#ifndef CDIO_CD_FRAMESIZE_RAW
#define CDIO_CD_FRAMESIZE_RAW 2352
#endif
#ifndef CDIO_CD_FRAMES_PER_SEC
#define CDIO_CD_FRAMES_PER_SEC 75
#endif
#ifndef CDIO_INVALID_LSN
#define CDIO_INVALID_LSN ((long)-1)
#endif
#ifndef CDIO_INVALID_TRACK
#define CDIO_INVALID_TRACK ((int)0xFF)
#endif

#define RIP_BATCH     75  /* 1 second of audio */
#define RIP_BATCH_MID 26  /* ~1/3 s, a common ATAPI transfer */
#define RIP_RETRIES   4
#define OUT_BUF_BYTES (256 * 1024)
#define MAX_TOC_TRACKS 100
#define COOKED_SECTOR 2048  /* RAW_READ_INFO.DiskOffset unit; see Microsoft docs */

typedef struct {
  int num;
  long lsn;
  int audio;
} TocTrack;

typedef struct {
  int first, last;
  int n;
  TocTrack tr[MAX_TOC_TRACKS];
  long leadout;
} TocInfo;

#ifdef _WIN32
typedef struct {
  HANDLE h;
  char path[64];
} WinDrive;
#else
typedef struct CdIo CdIo_t;
#endif

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

#ifndef _WIN32
static int already(char names[][64], int n, const char *s) {
  for (int i = 0; i < n; i++) if (strcmp(names[i], s) == 0) return 1;
  return 0;
}

static int collect_names(const char *drive, char names[][64], int maxn) {
  int n = 0;
  if (drive && drive[0] && n < maxn) {
    snprintf(names[n++], 64, "%s", drive);
  }
  return n;
}

#endif

#ifdef _WIN32
static void win_err(const char *what, const char *path, DWORD err) {
  char msg[256];
  DWORD n = FormatMessageA(FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
                           NULL, err, 0, msg, (DWORD)sizeof msg, NULL);
  while (n && (msg[n - 1] == '\r' || msg[n - 1] == '\n' || msg[n - 1] == ' ')) msg[--n] = 0;
  if (!n) snprintf(msg, sizeof msg, "unknown error");
  if (path && path[0])
    fprintf(stderr, "%s on %s failed winerr=%lu (%s)\n", what, path, (unsigned long)err, msg);
  else
    fprintf(stderr, "%s failed winerr=%lu (%s)\n", what, (unsigned long)err, msg);
}

static int win_retryable(DWORD err) {
  switch (err) {
    case ERROR_NOT_READY:          /* 21 */
    case ERROR_BUSY:               /* 170 */
    case ERROR_SHARING_VIOLATION:  /* 32 */
    case ERROR_CRC:                /* 23 */
    case ERROR_IO_DEVICE:          /* 1117 */
    case ERROR_NO_MEDIA_IN_DRIVE:  /* 1112 */
    case ERROR_MEDIA_CHANGED:      /* 1110 */
    case ERROR_UNRECOGNIZED_MEDIA: /* 1785 */
      return 1;
    default:
      return 0;
  }
}

static int win_device_path(const char *drive, char *out, size_t cap) {
  char letter = 0;
  const char *p = drive ? drive : "";
  if (p[0] && p[1] == ':') letter = p[0];
  else if (p[0] == '\\' && p[1] == '\\' && p[2] == '.' && p[3] == '\\' && p[4] && p[5] == ':') letter = p[4];
  else if (p[0] && p[1] == '\0') letter = p[0];
  if (!letter) return -1;
  snprintf(out, cap, "\\\\.\\%c:", letter);
  return 0;
}

/* GENERIC_READ + FILE_SHARE_READ|WRITE. Do not add GENERIC_WRITE: that is what
 * SPTI needs, and LocalService is often denied write on the CD-ROM device. */
static int win_open(const char *drive, WinDrive *d) {
  memset(d, 0, sizeof *d);
  d->h = INVALID_HANDLE_VALUE;
  if (win_device_path(drive, d->path, sizeof d->path) != 0) {
    fprintf(stderr, "cannot parse drive name %s\n", drive ? drive : "(null)");
    return -1;
  }
  d->h = CreateFileA(d->path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                     NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
  if (d->h == INVALID_HANDLE_VALUE) {
    win_err("open GENERIC_READ", d->path, GetLastError());
    return -1;
  }
  return 0;
}

static void win_close(WinDrive *d) {
  if (d && d->h && d->h != INVALID_HANDLE_VALUE) {
    CloseHandle(d->h);
    d->h = INVALID_HANDLE_VALUE;
  }
}

static long be_lba(const UCHAR a[4]) {
  return ((long)a[0] << 24) | ((long)a[1] << 16) | ((long)a[2] << 8) | (long)a[3];
}

static long msf_to_lba(unsigned m, unsigned s, unsigned f) {
  return ((long)m * 60 + (long)s) * 75 + (long)f - 150;
}

static int toc_from_cdrom_toc(const CDROM_TOC *cdtoc, int is_msf, TocInfo *toc) {
  int first = (int)cdtoc->FirstTrack;
  int last = (int)cdtoc->LastTrack;
  if (first < 1 || last < first || last > 99) return -1;
  memset(toc, 0, sizeof *toc);
  toc->first = first;
  toc->last = last;
  toc->leadout = CDIO_INVALID_LSN;
  toc->n = 0;
  int max_entries = last - first + 2; /* tracks + lead-out */
  if (max_entries > MAXIMUM_NUMBER_TRACKS) max_entries = MAXIMUM_NUMBER_TRACKS;
  for (int i = 0; i < max_entries; i++) {
    int num = (int)cdtoc->TrackData[i].TrackNumber;
    long lsn;
    if (is_msf)
      lsn = msf_to_lba(cdtoc->TrackData[i].Address[1], cdtoc->TrackData[i].Address[2], cdtoc->TrackData[i].Address[3]);
    else
      lsn = be_lba(cdtoc->TrackData[i].Address);
    if (num == 0xAA) {
      toc->leadout = lsn;
      continue;
    }
    if (num < first || num > last) continue;
    if (toc->n >= MAX_TOC_TRACKS) break;
    toc->tr[toc->n].num = num;
    toc->tr[toc->n].lsn = lsn;
    toc->tr[toc->n].audio = (cdtoc->TrackData[i].Control & AUDIO_DATA_TRACK) ? 0 : 1;
    toc->n++;
  }
  if (toc->n == 0 || toc->leadout == CDIO_INVALID_LSN) return -1;
  return 0;
}

static int win_ioctl_toc_ex(WinDrive *d, UCHAR msf, CDROM_TOC *cdtoc, DWORD *err_out) {
  CDROM_READ_TOC_EX req;
  DWORD got = 0;
  memset(&req, 0, sizeof req);
  memset(cdtoc, 0, sizeof *cdtoc);
  req.Format = CDROM_READ_TOC_EX_FORMAT_TOC;
  req.Msf = msf;
  req.SessionTrack = 1;
  if (DeviceIoControl(d->h, IOCTL_CDROM_READ_TOC_EX, &req, sizeof req,
                      cdtoc, sizeof *cdtoc, &got, NULL))
    return 0;
  if (err_out) *err_out = GetLastError();
  return -1;
}

static int win_ioctl_toc(WinDrive *d, CDROM_TOC *cdtoc, DWORD *err_out) {
  DWORD got = 0;
  memset(cdtoc, 0, sizeof *cdtoc);
  if (DeviceIoControl(d->h, IOCTL_CDROM_READ_TOC, NULL, 0,
                      cdtoc, sizeof *cdtoc, &got, NULL))
    return 0;
  if (err_out) *err_out = GetLastError();
  return -1;
}

static int win_read_toc_once(WinDrive *d, TocInfo *toc, DWORD *err_out) {
  CDROM_TOC cdtoc;
  DWORD err = 0;
  if (win_ioctl_toc_ex(d, 0, &cdtoc, &err) == 0 && toc_from_cdrom_toc(&cdtoc, 0, toc) == 0)
    return 0;
  if (win_ioctl_toc_ex(d, 1, &cdtoc, &err) == 0 && toc_from_cdrom_toc(&cdtoc, 1, toc) == 0)
    return 0;
  if (win_ioctl_toc(d, &cdtoc, &err) == 0 && toc_from_cdrom_toc(&cdtoc, 1, toc) == 0)
    return 0;
  if (err_out) *err_out = err ? err : (DWORD)ERROR_INVALID_DATA;
  return -1;
}

/* USB / laptop drives often report not-ready until the disc has spun up.
 * Permanent errors (access denied, invalid function) fail immediately so we
 * do not hide an account/ACL problem behind a 10 s "no TOC" wait. */
static int win_read_toc(WinDrive *d, TocInfo *toc) {
  static const int delays_ms[] = { 0, 200, 500, 1000, 2000, 3000, 4000 };
  const int rounds = (int)(sizeof delays_ms / sizeof delays_ms[0]);
  DWORD err = 0;
  for (int i = 0; i < rounds; i++) {
    if (delays_ms[i]) NAP_MS(delays_ms[i]);
    if (win_read_toc_once(d, toc, &err) == 0) return 0;
    if (!win_retryable(err)) {
      win_err("IOCTL_CDROM_READ_TOC_EX", d->path, err);
      return -1;
    }
  }
  win_err("IOCTL_CDROM_READ_TOC_EX", d->path, err);
  return -1;
}

static void win_set_speed(WinDrive *d) {
  CDROM_SET_SPEED req;
  DWORD got = 0;
  memset(&req, 0, sizeof req);
  req.RequestType = CdromSetSpeed;
  req.ReadSpeed = 0xFFFF; /* let the drive pick its maximum */
  req.WriteSpeed = 0;
  req.RotationControl = CdromDefaultRotation;
  (void)DeviceIoControl(d->h, IOCTL_CDROM_SET_SPEED, &req, sizeof req, NULL, 0, &got, NULL);
}

/* DiskOffset is starting LBA * 2048, not * 2352.
 * https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntddcdrm/ns-ntddcdrm-__raw_read_info */
static int win_read_audio(WinDrive *d, long lsn, unsigned n, unsigned char *buf) {
  RAW_READ_INFO info;
  DWORD got = 0;
  memset(&info, 0, sizeof info);
  info.DiskOffset.QuadPart = (LONGLONG)lsn * (LONGLONG)COOKED_SECTOR;
  info.SectorCount = n;
  info.TrackMode = CDDA;
  if (DeviceIoControl(d->h, IOCTL_CDROM_RAW_READ, &info, sizeof info,
                      buf, n * CDIO_CD_FRAMESIZE_RAW, &got, NULL))
    return 0;
  DWORD err = GetLastError();
  char what[80];
  snprintf(what, sizeof what, "IOCTL_CDROM_RAW_READ lsn=%ld n=%u", lsn, n);
  win_err(what, d->path, err);
  return -1;
}

static void put_field(const char *key, const char *val) {
  if (val && val[0]) printf("%s %s\n", key, val);
}

/* Concatenate CD-Text pack payloads of one type and split on NUL. Slot 0 is
 * the album, slot i is track i. Missing or empty CD-Text is not an error. */
static void emit_cdtext_type(const unsigned char *bytes, int nbytes, int pack_type, const char *album_key, const char *track_key) {
  char acc[4096];
  int acc_n = 0;
  acc[0] = 0;
  int packs = nbytes / (int)sizeof(CDROM_TOC_CD_TEXT_DATA_BLOCK);
  const CDROM_TOC_CD_TEXT_DATA_BLOCK *blocks = (const CDROM_TOC_CD_TEXT_DATA_BLOCK *)bytes;
  for (int i = 0; i < packs; i++) {
    if (blocks[i].PackType != (UCHAR)pack_type) continue;
    if (blocks[i].ExtensionFlag || blocks[i].BlockNumber != 0) continue;
    if (blocks[i].Unicode) continue; /* album/track names in Unicode are uncommon; skip rather than mojibake */
    int room = (int)sizeof(acc) - acc_n - 1;
    int take = 12;
    if (take > room) take = room;
    if (take <= 0) break;
    memcpy(acc + acc_n, blocks[i].Text, (size_t)take);
    acc_n += take;
    acc[acc_n] = 0;
  }
  if (acc_n == 0) return;
  int slot = 0;
  char *p = acc;
  char *end = acc + acc_n;
  while (p < end) {
    char *nul = memchr(p, 0, (size_t)(end - p));
    char *term = nul ? nul : end;
    if (term > p) {
      char saved = *term;
      *term = 0;
      if (slot == 0) put_field(album_key, p);
      else if (track_key) printf("%s %d %s\n", track_key, slot, p);
      *term = saved;
    }
    if (!nul) break;
    p = nul + 1;
    slot++;
  }
}

static int win_print_cdtext(WinDrive *d) {
  unsigned char buf[16 * 1024];
  CDROM_READ_TOC_EX req;
  DWORD got = 0;
  memset(&req, 0, sizeof req);
  memset(buf, 0, sizeof buf);
  req.Format = CDROM_READ_TOC_EX_FORMAT_CDTEXT;
  req.Msf = 0;
  req.SessionTrack = 0;
  if (!DeviceIoControl(d->h, IOCTL_CDROM_READ_TOC_EX, &req, sizeof req,
                       buf, sizeof buf, &got, NULL)) {
    DWORD err = GetLastError();
    if (err == ERROR_INVALID_FUNCTION || err == ERROR_NOT_SUPPORTED ||
        err == ERROR_INVALID_PARAMETER || err == ERROR_IO_DEVICE) {
      /* Disc or drive has no CD-Text — not a failure. */
      return 0;
    }
    if (!win_retryable(err)) {
      win_err("IOCTL_CDROM_READ_TOC_EX CDTEXT", d->path, err);
      /* Still not fatal for --cdtext: the disc may simply lack it. */
      return 0;
    }
    win_err("IOCTL_CDROM_READ_TOC_EX CDTEXT", d->path, err);
    return 0;
  }
  if (got < 4) return 0;
  unsigned data_len = ((unsigned)buf[0] << 8) | (unsigned)buf[1];
  /* Length is the number of following bytes (MMC). Descriptors start at offset 4. */
  int desc = (int)got - 4;
  if ((int)data_len - 2 < desc && (int)data_len >= 2) desc = (int)data_len - 2;
  if (desc <= 0) return 0;
  emit_cdtext_type(buf + 4, desc, CDROM_CD_TEXT_PACK_ALBUM_NAME, "ALBUM", "TRACK");
  emit_cdtext_type(buf + 4, desc, CDROM_CD_TEXT_PACK_PERFORMER, "ALBUMARTIST", "TRACKARTIST");
  return 0;
}
#endif /* _WIN32 */

#ifndef _WIN32
static CdIo_t *try_open(const char *name) {
  CdIo_t *cdio;
  if (!name || !name[0]) return NULL;
  cdio = cdio_open(name, DRIVER_DEVICE);
  if (cdio) return cdio;
  cdio = cdio_open(name, DRIVER_UNKNOWN);
  if (cdio) return cdio;
  return cdio_open_cd(name);
}

static CdIo_t *open_drive(const char *drive) {
  char names[6][64];
  int n = collect_names(drive, names, 6);
  for (int i = 0; i < n; i++) {
    CdIo_t *cdio = try_open(names[i]);
    if (cdio) return cdio;
  }
  return NULL;
}

/* USB / laptop drives often report an invalid TOC until the disc has spun up. */
static int wait_for_toc(CdIo_t *cdio, track_t *first, track_t *last) {
  static const int delays_ms[] = { 0, 200, 500, 1000, 2000, 3000, 4000 };
  const int rounds = (int)(sizeof delays_ms / sizeof delays_ms[0]);
  for (int i = 0; i < rounds; i++) {
    if (delays_ms[i]) NAP_MS(delays_ms[i]);
    (void)cdio_get_disc_last_lsn(cdio); /* kick a TOC reread on some Windows drivers */
    *first = cdio_get_first_track_num(cdio);
    *last = cdio_get_last_track_num(cdio);
    if (*first != CDIO_INVALID_TRACK && *last != CDIO_INVALID_TRACK && *last >= *first)
      return 0;
  }
  return -1;
}

static void try_set_speed(CdIo_t *cdio) {
  /* Units are CD-ROM speed (1×, 4×, …), not KB/s. A value that is too large
   * asks the drive for its maximum, which is what we want on a USB BD drive. */
  if (cdio_set_speed(cdio, 48) != DRIVER_OP_SUCCESS)
    (void)cdio_set_speed(cdio, 16);
}

static int toc_from_cdio(CdIo_t *cdio, TocInfo *toc) {
  track_t first, last;
  if (wait_for_toc(cdio, &first, &last) != 0) return -1;
  memset(toc, 0, sizeof *toc);
  toc->first = (int)first;
  toc->last = (int)last;
  toc->n = 0;
  for (track_t t = first; t <= last; t++) {
    if (toc->n >= MAX_TOC_TRACKS) break;
    lsn_t lsn = cdio_get_track_lsn(cdio, t);
    toc->tr[toc->n].num = (int)t;
    toc->tr[toc->n].lsn = (long)lsn;
    toc->tr[toc->n].audio = cdio_get_track_format(cdio, t) == TRACK_FORMAT_AUDIO;
    toc->n++;
  }
  lsn_t lead = cdio_get_track_lsn(cdio, CDIO_CDROM_LEADOUT_TRACK);
  if (lead == CDIO_INVALID_LSN) lead = cdio_get_disc_last_lsn(cdio);
  toc->leadout = (long)lead;
  return toc->n > 0 && toc->leadout != (long)CDIO_INVALID_LSN ? 0 : -1;
}

static int read_sectors_raw(CdIo_t *cdio, lsn_t lsn, uint32_t n, unsigned char *buf) {
  driver_return_code_t rc = cdio_read_audio_sectors(cdio, buf, lsn, n);
  return rc == DRIVER_OP_SUCCESS ? 0 : -1;
}

static void put_field(const char *key, const char *val) {
  if (val && val[0]) printf("%s %s\n", key, val);
}
#endif /* !_WIN32 */

static void apply_mixed_mode_leadout(TocInfo *toc) {
  int first_audio = 0, last_audio = 0;
  long first_data_after_audio = CDIO_INVALID_LSN;
  for (int i = 0; i < toc->n; i++) {
    if (toc->tr[i].audio) {
      if (!first_audio) first_audio = toc->tr[i].num;
      last_audio = toc->tr[i].num;
    } else if (last_audio && first_data_after_audio == CDIO_INVALID_LSN) {
      first_data_after_audio = toc->tr[i].lsn;
    }
  }
  /* MusicBrainz: for a data session after audio, subtract the 11400-frame gap. */
  if (first_data_after_audio != CDIO_INVALID_LSN)
    toc->leadout = first_data_after_audio - 11400;
}

static void print_toc_info(const TocInfo *toc) {
  int first_audio = 0, last_audio = 0;
  printf("FIRST %d\n", toc->first);
  printf("LAST %d\n", toc->last);
  for (int i = 0; i < toc->n; i++) {
    printf("TRACK %d %ld %s\n", toc->tr[i].num, toc->tr[i].lsn, toc->tr[i].audio ? "AUDIO" : "DATA");
    if (toc->tr[i].audio) {
      if (!first_audio) first_audio = toc->tr[i].num;
      last_audio = toc->tr[i].num;
    }
  }
  printf("LEADOUT %ld\n", toc->leadout);
  printf("AUDIO_FIRST %d\n", first_audio);
  printf("AUDIO_LAST %d\n", last_audio);
}

static int count_audio(const TocInfo *toc) {
  int n = 0;
  for (int i = 0; i < toc->n; i++) if (toc->tr[i].audio) n++;
  return n;
}

static const TocTrack *nth_audio(const TocInfo *toc, int track1) {
  int seen = 0;
  for (int i = 0; i < toc->n; i++) {
    if (!toc->tr[i].audio) continue;
    seen++;
    if (seen == track1) return &toc->tr[i];
  }
  return NULL;
}

static long track_end_lsn(const TocInfo *toc, const TocTrack *t) {
  int found = 0;
  for (int i = 0; i < toc->n; i++) {
    if (&toc->tr[i] == t) { found = 1; continue; }
    if (found) return toc->tr[i].lsn - 1;
  }
  return toc->leadout != CDIO_INVALID_LSN ? toc->leadout - 1 : CDIO_INVALID_LSN;
}

#ifdef _WIN32
static int count_tracks(const char *drive) {
  WinDrive d;
  TocInfo toc;
  if (win_open(drive, &d) != 0) return -1;
  if (win_read_toc(&d, &toc) != 0) { win_close(&d); return -1; }
  int n = count_audio(&toc);
  win_close(&d);
  return n;
}

static int print_toc(const char *drive) {
  WinDrive d;
  TocInfo toc;
  if (win_open(drive, &d) != 0) return 1;
  if (win_read_toc(&d, &toc) != 0) { win_close(&d); return 2; }
  apply_mixed_mode_leadout(&toc);
  print_toc_info(&toc);
  int n = count_audio(&toc);
  win_close(&d);
  return n ? 0 : 3;
}

static int print_cdtext(const char *drive) {
  WinDrive d;
  if (win_open(drive, &d) != 0) return 1;
  /* A TOC wait lets a just-inserted disc spin up before CD-Text is queried. */
  TocInfo toc;
  (void)win_read_toc(&d, &toc);
  int rc = win_print_cdtext(&d);
  win_close(&d);
  return rc;
}

static int read_one_retry(WinDrive *d, long lsn, unsigned char *buf) {
  for (int t = 0; t < RIP_RETRIES; t++) {
    if (t) NAP_MS(40 * t);
    if (win_read_audio(d, lsn, 1, buf) == 0) return 0;
  }
  return -1;
}

static int rip_track(const char *drive, int track1, const char *outpath) {
  WinDrive d;
  TocInfo toc;
  if (win_open(drive, &d) != 0) return 2;
  if (win_read_toc(&d, &toc) != 0) { win_close(&d); return 3; }
  win_set_speed(&d);
  const TocTrack *target = nth_audio(&toc, track1);
  if (!target) { fprintf(stderr, "track %d not found\n", track1); win_close(&d); return 3; }
  long start = target->lsn;
  long end = track_end_lsn(&toc, target);
  if (start < 0 || end < start) {
    fprintf(stderr, "bad LSN range for track %d\n", track1);
    win_close(&d); return 3;
  }

  FILE *out = fopen(outpath, "wb");
  if (!out) { perror(outpath); win_close(&d); return 7; }
  char *filebuf = (char *)malloc(OUT_BUF_BYTES);
  if (filebuf) setvbuf(out, filebuf, _IOFBF, OUT_BUF_BYTES);
  unsigned long data_bytes = 0;
  write_wav_header(out, 0);

  long total = end - start + 1;
  unsigned char *buf = (unsigned char *)malloc((size_t)RIP_BATCH * CDIO_CD_FRAMESIZE_RAW);
  if (!buf) { fprintf(stderr, "out of memory\n"); fclose(out); free(filebuf); win_close(&d); return 8; }

  fprintf(stderr, "PROGRESS 0 %ld\n", total);
  fflush(stderr);

  unsigned batch = RIP_BATCH;
  long s = start;
  long last_prog = -75;
  while (s <= end) {
    unsigned n = (unsigned)(end - s + 1);
    if (n > batch) n = batch;
    int ok = 0;
    if (n > 1) {
      if (win_read_audio(&d, s, n, buf) == 0) ok = 1;
      else if (batch > RIP_BATCH_MID) { batch = RIP_BATCH_MID; continue; }
      else if (batch > 1) { batch = 1; continue; }
    }
    if (!ok) {
      if (read_one_retry(&d, s, buf) == 0) { n = 1; ok = 1; }
    }
    if (!ok) {
      fprintf(stderr, "read failed at sector %ld\n", s);
      break;
    }
    if (fwrite(buf, 1, (size_t)n * CDIO_CD_FRAMESIZE_RAW, out) != (size_t)n * CDIO_CD_FRAMESIZE_RAW) {
      perror("write"); break;
    }
    data_bytes += (unsigned long)n * CDIO_CD_FRAMESIZE_RAW;
    s += n;
    if ((s - start) - last_prog >= CDIO_CD_FRAMES_PER_SEC || s > end) {
      last_prog = s - start;
      fprintf(stderr, "PROGRESS %ld %ld\n", s - start, total);
      fflush(stderr);
    }
  }

  fseek(out, 0, SEEK_SET);
  write_wav_header(out, data_bytes);
  fclose(out);
  free(buf);
  free(filebuf);
  win_close(&d);
  fprintf(stderr, "ripped track %d -> %s (%lu bytes)\n", track1, outpath, data_bytes);
  return data_bytes && s > end ? 0 : 8;
}
#else
static int count_tracks(const char *drive) {
  CdIo_t *cdio = open_drive(drive);
  if (!cdio) { fprintf(stderr, "cannot open %s\n", drive); return -1; }
  TocInfo toc;
  if (toc_from_cdio(cdio, &toc) != 0) {
    fprintf(stderr, "no TOC on %s\n", drive); cdio_destroy(cdio); return -1;
  }
  int n = count_audio(&toc);
  cdio_destroy(cdio);
  return n;
}

static int print_toc(const char *drive) {
  CdIo_t *cdio = open_drive(drive);
  if (!cdio) { fprintf(stderr, "cannot open %s\n", drive); return 1; }
  TocInfo toc;
  if (toc_from_cdio(cdio, &toc) != 0) {
    fprintf(stderr, "no TOC on %s\n", drive); cdio_destroy(cdio); return 2;
  }
  apply_mixed_mode_leadout(&toc);
  print_toc_info(&toc);
  int n = count_audio(&toc);
  cdio_destroy(cdio);
  return n ? 0 : 3;
}

static int print_cdtext(const char *drive) {
  CdIo_t *cdio = open_drive(drive);
  if (!cdio) { fprintf(stderr, "cannot open %s\n", drive); return 1; }
  track_t first, last;
  (void)wait_for_toc(cdio, &first, &last);
  cdtext_t *ct = cdio_get_cdtext(cdio);
  if (!ct) { cdio_destroy(cdio); return 0; }
  put_field("ALBUM", cdtext_get_const(ct, CDTEXT_FIELD_TITLE, 0));
  put_field("ALBUMARTIST", cdtext_get_const(ct, CDTEXT_FIELD_PERFORMER, 0));
  if (first == CDIO_INVALID_TRACK || last == CDIO_INVALID_TRACK) {
    cdio_destroy(cdio); return 0;
  }
  for (track_t t = first; t <= last; t++) {
    const char *title = cdtext_get_const(ct, CDTEXT_FIELD_TITLE, t);
    const char *perf = cdtext_get_const(ct, CDTEXT_FIELD_PERFORMER, t);
    if (title) printf("TRACK %d %s\n", (int)t, title);
    if (perf) printf("TRACKARTIST %d %s\n", (int)t, perf);
  }
  cdio_destroy(cdio);
  return 0;
}

static int read_one_retry(CdIo_t *cdio, lsn_t lsn, unsigned char *buf) {
  for (int t = 0; t < RIP_RETRIES; t++) {
    if (t) NAP_MS(40 * t);
    if (read_sectors_raw(cdio, lsn, 1, buf) == 0) return 0;
  }
  return -1;
}

static int rip_track(const char *drive, int track1, const char *outpath) {
  CdIo_t *cdio = open_drive(drive);
  if (!cdio) { fprintf(stderr, "cannot open %s\n", drive); return 2; }
  TocInfo toc;
  if (toc_from_cdio(cdio, &toc) != 0) {
    fprintf(stderr, "no TOC on %s\n", drive); cdio_destroy(cdio); return 3;
  }
  try_set_speed(cdio);
  const TocTrack *target = nth_audio(&toc, track1);
  if (!target) { fprintf(stderr, "track %d not found\n", track1); cdio_destroy(cdio); return 3; }

  lsn_t start = (lsn_t)target->lsn;
  lsn_t end = (lsn_t)track_end_lsn(&toc, target);
  if (start == CDIO_INVALID_LSN || end == CDIO_INVALID_LSN || end < start) {
    fprintf(stderr, "bad LSN range for track %d\n", track1);
    cdio_destroy(cdio); return 3;
  }

  FILE *out = fopen(outpath, "wb");
  if (!out) { perror(outpath); cdio_destroy(cdio); return 7; }
  char *filebuf = (char *)malloc(OUT_BUF_BYTES);
  if (filebuf) setvbuf(out, filebuf, _IOFBF, OUT_BUF_BYTES);
  unsigned long data_bytes = 0;
  write_wav_header(out, 0);

  lsn_t total = end - start + 1;
  unsigned char *buf = (unsigned char *)malloc((size_t)RIP_BATCH * CDIO_CD_FRAMESIZE_RAW);
  if (!buf) { fprintf(stderr, "out of memory\n"); fclose(out); free(filebuf); cdio_destroy(cdio); return 8; }

  fprintf(stderr, "PROGRESS 0 %ld\n", (long)total);
  fflush(stderr);

  uint32_t batch = RIP_BATCH;
  lsn_t s = start;
  lsn_t last_prog = -75;
  while (s <= end) {
    uint32_t n = (uint32_t)(end - s + 1);
    if (n > batch) n = batch;
    int ok = 0;
    if (n > 1) {
      if (read_sectors_raw(cdio, s, n, buf) == 0) ok = 1;
      else if (batch > RIP_BATCH_MID) { batch = RIP_BATCH_MID; continue; }
      else if (batch > 1) { batch = 1; continue; }
    }
    if (!ok) {
      if (read_one_retry(cdio, s, buf) == 0) { n = 1; ok = 1; }
    }
    if (!ok) {
      fprintf(stderr, "read failed at sector %ld\n", (long)s);
      break;
    }
    if (fwrite(buf, 1, (size_t)n * CDIO_CD_FRAMESIZE_RAW, out) != (size_t)n * CDIO_CD_FRAMESIZE_RAW) {
      perror("write"); break;
    }
    data_bytes += (unsigned long)n * CDIO_CD_FRAMESIZE_RAW;
    s += n;
    if ((s - start) - last_prog >= CDIO_CD_FRAMES_PER_SEC || s > end) {
      last_prog = s - start;
      fprintf(stderr, "PROGRESS %ld %ld\n", (long)(s - start), (long)total);
      fflush(stderr);
    }
  }

  fseek(out, 0, SEEK_SET);
  write_wav_header(out, data_bytes);
  fclose(out);
  free(buf);
  free(filebuf);
  cdio_destroy(cdio);
  fprintf(stderr, "ripped track %d -> %s (%lu bytes)\n", track1, outpath, data_bytes);
  return data_bytes && s > end ? 0 : 8;
}
#endif

int main(int argc, char **argv) {
  if (argc == 3 && strcmp(argv[1], "--count") == 0) {
    int n = count_tracks(argv[2]);
    if (n < 0) return 1;
    printf("%d\n", n);
    return 0;
  }
  if (argc == 3 && strcmp(argv[1], "--toc") == 0)
    return print_toc(argv[2]);
  if (argc == 3 && strcmp(argv[1], "--cdtext") == 0)
    return print_cdtext(argv[2]);
  if (argc != 4) {
    fprintf(stderr, "Usage: %s <drive> <track> <out.wav>\n       %s --count|--toc|--cdtext <drive>\n", argv[0], argv[0]);
    return 1;
  }
  return rip_track(argv[1], atoi(argv[2]), argv[3]);
}
