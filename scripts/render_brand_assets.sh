#!/bin/sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$PROJECT_ROOT"

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick 7 is required to render brand assets." >&2
  exit 1
fi

mkdir -p public/icons public/og

if [ -f /System/Library/Fonts/Helvetica.ttc ]; then
  BRAND_FONT=/System/Library/Fonts/Helvetica.ttc
elif [ -f /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf ]; then
  BRAND_FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
else
  echo "Helvetica or DejaVu Sans is required to render the social card." >&2
  exit 1
fi

magick -density 72 -background none public/favicon.svg -resize 48x48 -alpha off -depth 8 -strip -define png:compression-level=9 public/favicon-48x48.png
magick -density 270 -background none public/favicon.svg -resize 180x180 -alpha off -depth 8 -strip -define png:compression-level=9 public/apple-touch-icon.png
magick -density 288 -background none public/favicon.svg -resize 192x192 -alpha off -depth 8 -strip -define png:compression-level=9 public/icons/icon-192.png
magick -density 768 -background none public/favicon.svg -resize 512x512 -alpha off -depth 8 -strip -define png:compression-level=9 public/icons/icon-512.png
magick -density 72 -background none public/favicon.svg -define icon:auto-resize=48,32,16 public/favicon.ico
magick -font "$BRAND_FONT" -background none assets/brand/osrs-tracker-card-v1.svg -resize 1200x630 -alpha off -depth 8 -strip -define png:compression-level=9 public/og/osrs-tracker-card-v1.png

echo "Rendered favicon, app icons, and social card."
