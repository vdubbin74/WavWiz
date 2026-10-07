#!/bin/sh
# TEST-ONLY netsh: keeps a rule list ($WAVWIZ_TEST_STATE/rules.txt) so tests can prove "delete then add" never duplicates
echo "tool netsh.exe $*" >> "$WAVWIZ_TEST_STATE/calls.log"
rules="$WAVWIZ_TEST_STATE/rules.txt"; touch "$rules"
name=""; for a in "$@"; do case "$a" in name=*) name="${a#name=}";; esac; done
case "$3" in
  add) echo "$name | $*" >> "$rules";;
  delete) grep -v "^$name |" "$rules" > "$rules.tmp"; mv "$rules.tmp" "$rules";;
esac
exit 0
