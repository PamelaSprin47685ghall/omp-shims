#!/bin/sh
# Rebuild the embedded OMP-compatible Mistral transport after upgrading pi-ai.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PLUGINS=${OMP_PLUGINS_DIR:-"$HOME/.omp/plugins"}
SRC="$PLUGINS/node_modules/@mariozechner/pi-ai/dist/providers/openai-completions.js"
test -f "$SRC" || { echo "pi-ai transport not installed: $SRC" >&2; exit 1; }
bun build "$SRC" --target=bun --format=esm --outfile="$ROOT/vendor/pi-ai-openai-completions.bundle.js"
