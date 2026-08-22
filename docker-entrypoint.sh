#!/bin/sh
set -eu

cd /app
mkdir -p player_data game_data cache public/data

metadata_ready=true
for filename in quests.json combat_achievements.json collection_log.json music_tracks.json; do
  if [ ! -s "game_data/$filename" ]; then
    metadata_ready=false
  fi
done

# Refresh on every start, but retain the last validated files during a transient outage.
if ! npm run fetch-game-data; then
  if [ "$metadata_ready" = false ]; then
    echo "Initial game metadata refresh failed and no validated metadata is available." >&2
    exit 1
  fi
  echo "Game metadata refresh failed; continuing with the previously validated files." >&2
fi

if ! find player_data -type f -name '*.json' -print -quit | grep -q .; then
  npm run fetch-data
fi

# Refresh the generated files on every restart. This publishes newly fetched
# metadata immediately and resets the health-check freshness window.
npm run generate

cron
exec node server.js
