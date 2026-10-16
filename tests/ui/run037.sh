#!/bin/bash
# usage: run036.sh <engine> [parts...]  -> builds ui037.mjs from base + parts + tail
cd "$(dirname "$0")"; E=${1:-chromium}; shift
cat ui037.base > /tmp/ui037.run.mjs; for p in "$@"; do cat ui037.$p.part >> /tmp/ui037.run.mjs; done
cat ui037.tail >> /tmp/ui037.run.mjs; cp /tmp/ui037.run.mjs ./ui037.run.mjs; node ui037.run.mjs $E
