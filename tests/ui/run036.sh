#!/bin/bash
# usage: run036.sh <engine> [parts...]  -> builds ui036.mjs from base + parts + tail
cd "$(dirname "$0")"; E=${1:-chromium}; shift
cat ui036.base > /tmp/ui036.run.mjs; for p in "$@"; do cat ui036.$p.part >> /tmp/ui036.run.mjs; done
cat ui036.tail >> /tmp/ui036.run.mjs; cp /tmp/ui036.run.mjs ./ui036.run.mjs; node ui036.run.mjs $E
