#!/bin/sh
# TEST-ONLY stand-in for icacls.exe / taskkill.exe: records the command line, succeeds.
# taskkill /PID n also removes process n from the fake process table ($WAVWIZ_TEST_STATE/procs.txt: name|pid|path|session) unless n is in WAVWIZ_TEST_UNKILLABLE.
echo "tool $(basename "$0") $*" >> "$WAVWIZ_TEST_STATE/calls.log"
if [ "$(basename "$0")" = "taskkill.exe" ] && [ "$1" = "/PID" ] && [ -f "$WAVWIZ_TEST_STATE/procs.txt" ]; then
  case ";$WAVWIZ_TEST_UNKILLABLE;" in *";$2;"*) exit 128;; esac
  grep -v "^[^|]*|$2|" "$WAVWIZ_TEST_STATE/procs.txt" > "$WAVWIZ_TEST_STATE/procs.tmp"; mv "$WAVWIZ_TEST_STATE/procs.tmp" "$WAVWIZ_TEST_STATE/procs.txt"
fi
exit 0
