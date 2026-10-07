#!/bin/sh
# TEST-ONLY sc.exe with state ($WAVWIZ_TEST_STATE/svc.state = STOPPED|RUNNING). Failure injection: WAVWIZ_TEST_SC_FAIL=<verb>, WAVWIZ_TEST_SC_NOSTART=1.
echo "tool sc.exe $*" >> "$WAVWIZ_TEST_STATE/calls.log"
st="$WAVWIZ_TEST_STATE/svc.state"; verb="$1"
[ "$2" = "UnisonServer" ] && st="$WAVWIZ_TEST_STATE/legacy-svc.state"       # the pre-0.0.3 service has its own state file
if [ "$WAVWIZ_TEST_SC_FAIL" = "$verb" ]; then echo "[SC] $verb FAILED 5:"; echo "Access is denied."; exit 5; fi
case "$verb" in
  query) if [ -f "$st" ]; then s=$(cat "$st"); if [ "$s" = RUNNING ]; then n=4; else n=1; fi; echo "SERVICE_NAME: $2"; echo "        STATE              : $n  $s"; exit 0; else echo "[SC] EnumQueryServicesStatus:OpenService FAILED 1060:"; exit 1060; fi;;
  create) echo STOPPED > "$st"; echo "$@" > "$WAVWIZ_TEST_STATE/svc.def"; echo "[SC] CreateService SUCCESS";;
  config) [ -f "$st" ] || exit 1060; echo "$@" > "$WAVWIZ_TEST_STATE/svc.def"; echo "[SC] ChangeServiceConfig SUCCESS";;
  start) [ -f "$st" ] || exit 1060; if [ "$WAVWIZ_TEST_SC_NOSTART" = 1 ]; then echo STOPPED > "$st"; exit 1053; fi; echo RUNNING > "$st";;
  stop) [ -f "$st" ] || exit 1060; echo STOPPED > "$st";;
  delete) rm -f "$st";;
esac
exit 0
