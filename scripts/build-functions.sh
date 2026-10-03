#!/usr/bin/env bash
# Bundles each Edge Function into one file under dist-functions/ (for deploy through the Supabase dashboard, CLI or connector).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist-functions
for f in flyer-extract fp-job link-fetch; do
  npx esbuild "supabase/functions/$f/index.ts" --bundle --format=esm --platform=neutral --target=es2022 \
    --external:npm:postgres@3 --minify-whitespace --outfile="dist-functions/$f.js" --log-level=warning
  echo "$f: $(wc -c < dist-functions/$f.js) bytes"
done
