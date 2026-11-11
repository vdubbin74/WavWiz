#!/bin/sh
# Runs the browser-side pure-logic tests with node (>= 18). The web files are copied next to a package.json that marks them as ES modules.
set -e
here="$(cd "$(dirname "$0")" && pwd)"; tmp="$(mktemp -d)"
mkdir -p "$tmp"
cp -r "$here/../../src/WavWiz.Server/wwwroot/js" "$tmp/js"
cp "$here/../../src/WavWiz.Server/wwwroot/"*.css "$tmp/"
cp "$here/../../src/WavWiz.Server/wwwroot/"*.html "$tmp/"   # 0.7.0 item 5c: page tests (e.g. F260 calmic.html) read the HTML next to js/
echo '{"type":"module"}' > "$tmp/js/package.json"
# every shipped script must at least parse as a module (a syntax error in one file blanks the whole page)
for f in "$tmp"/js/*.js; do node --check "$f" 2>/dev/null || { node --input-type=module --check < "$f" || { echo "SYNTAX ERROR in $f"; exit 1; }; }; done
cd "$tmp" && JS_DIR="$tmp/js" node --test "$here"/*.test.mjs
rm -rf "$tmp"
