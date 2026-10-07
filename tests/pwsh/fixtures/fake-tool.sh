#!/bin/sh
# TEST-ONLY stand-in for icacls.exe / taskkill.exe: records the command line, succeeds
echo "tool $(basename "$0") $*" >> "$WAVWIZ_TEST_STATE/calls.log"
exit 0
