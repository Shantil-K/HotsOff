#!/bin/sh
# Builds the HotsOff IPK into the current directory.
# Run from anywhere: sh development/createPackage.sh [outdir]
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/..}"
chmod 755 "$ROOT"/tools/*.sh "$ROOT"/tools/lib/*.sh
ares-package -o "$OUT" -e "*README.md" -e "*development/*" -e "*tests/*" -e "*.github/*" -e "*.git/*" "$ROOT"
sha256sum "$OUT"/com.hotsoff.patcher_*.ipk
