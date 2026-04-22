#!/usr/bin/env bash
# Fallback renderer for the 5 Hyperframes scene HTMLs.
# Uses Puppeteer-style timelapse capture via headless Chrome + ffmpeg,
# bypassing Hyperframes' project-mode detection which wasn't cooperating.
#
# Each scene's HTML already contains its full animation (GSAP + CSS). We just
# need to capture the visible viewport as a sequence of frames and stitch to
# MP4.
#
# Usage: ./render-scenes.sh
set -euo pipefail

SCENES_DIR="$(cd "$(dirname "$0")" && pwd)/compositions"
OUT_DIR="$(cd "$(dirname "$0")" && pwd)/out"
mkdir -p "$OUT_DIR"

# Scene name → duration in seconds
declare -a SCENES=(
  "h1-tagline:20"
  "h2-leaderboard:23"
  "h3-disclosure:10"
  "h4-attestation:12"
  "h5-closing:3"
)

for entry in "${SCENES[@]}"; do
  name="${entry%%:*}"
  duration="${entry##*:}"
  html="$SCENES_DIR/${name}.html"
  out="$OUT_DIR/${name}.mp4"

  if [ ! -f "$html" ]; then
    echo "[$name] SKIP — $html not found"
    continue
  fi

  echo ""
  echo "━━━ Rendering $name (${duration}s) ━━━"

  # Use hyperframes' internal capture via Chrome, but pointed at a single HTML.
  # Temporarily swap index.html so Hyperframes treats this scene as the project entry.
  backup="$(cd "$(dirname "$0")" && pwd)/.index-backup.html"
  cp "$(dirname "$SCENES_DIR")/index.html" "$backup"
  cp "$html" "$(dirname "$SCENES_DIR")/index.html"

  (cd "$(dirname "$SCENES_DIR")" && npx hyperframes render . --output "$out" --quality standard --workers 4 2>&1 | tail -3) || true

  # Restore index.html
  mv "$backup" "$(dirname "$SCENES_DIR")/index.html"

  if [ -f "$out" ]; then
    echo "[$name] ✓ rendered: $(du -h "$out" | cut -f1), $(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$out" 2>/dev/null || echo "?")s"
  else
    echo "[$name] ✗ FAILED — no MP4 produced"
  fi
done

echo ""
echo "━━━ All scenes processed. MP4s in: $OUT_DIR ━━━"
ls -lh "$OUT_DIR"
