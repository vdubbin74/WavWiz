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
  qc)
    if [ ! -f "$st" ]; then echo "[SC] OpenService FAILED 1060:"; exit 1060; fi
    acct="NT AUTHORITY\\LocalService"
    if [ -f "$WAVWIZ_TEST_STATE/svc.def" ]; then
      parsed=$(awk '{
        acc=""
        for (i = 1; i <= NF; i++) {
          if ($i == "obj=" || $i ~ /^obj=./) {
            if ($i == "obj=") i++
            else sub(/^obj=/, "", $i)
            acc = $i
            i++
            while (i <= NF && $i !~ /=$/ && $i !~ /=/) { acc = acc " " $i; i++ }
            print acc
            exit
          }
        }
      }' "$WAVWIZ_TEST_STATE/svc.def")
      [ -n "$parsed" ] && acct="$parsed"
    fi
    echo "[SC] QueryServiceConfig SUCCESS"
    echo "SERVICE_NAME: $2"
    echo "        TYPE               : 10  WIN32_OWN_PROCESS"
    echo "        START_TYPE         : 2   AUTO_START"
    echo "        SERVICE_START_NAME : $acct"
    ;;
  start) [ -f "$st" ] || exit 1060; if [ "$WAVWIZ_TEST_SC_NOSTART" = 1 ]; then echo STOPPED > "$st"; exit 1053; fi; echo RUNNING > "$st";;
  stop) [ -f "$st" ] || exit 1060; echo STOPPED > "$st";;
  delete) rm -f "$st" "$WAVWIZ_TEST_STATE/svc.sidtype";;
  sidtype)
    [ -f "$st" ] || exit 1060
    echo "$3" > "$WAVWIZ_TEST_STATE/svc.sidtype"
    echo "[SC] ChangeServiceConfig2 SUCCESS"
    ;;
  qsidtype)
    if [ ! -f "$st" ]; then echo "[SC] OpenService FAILED 1060:"; exit 1060; fi
    typ="NONE"
    if [ -f "$WAVWIZ_TEST_STATE/svc.sidtype" ]; then typ=$(tr a-z A-Z < "$WAVWIZ_TEST_STATE/svc.sidtype"); typ=$(echo "$typ" | tr -d '\r\n'); fi
    echo "[SC] QueryServiceConfig2 SUCCESS"
    echo "NAME: $2"
    echo "SERVICE SID TYPE: $typ"
    ;;
esac
exit 0
