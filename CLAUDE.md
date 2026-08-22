# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OSRS Quest Tracker is a tool that tracks Old School RuneScape progress for a group of players. It fetches player data from the RuneLite API, stores timestamped snapshots, and generates a static HTML dashboard with a Windows 98-style UI for comparing progress.

## Commands

```bash
# Fetch latest player data from RuneLite API
npm run fetch-data

# Remove duplicate consecutive data files
npm run cleanup
npm run cleanup:dry-run

# Generate static HTML dashboard
npm run generate

# Start Express server on port 3000
npm start

# Complete cron workflow (fetch + cleanup + generate)
npm run cron

# Fetch game metadata from OSRS Wiki
npm run fetch-game-data  # runs all fetch scripts below
npm run fetch-combat-achievements
npm run fetch-collection-log
npm run fetch-music-tracks
npm run fetch-quests

# Regression suite
npm test
```

## Architecture

### Data Flow
1. `data_fetcher.js` fetches and validates a complete batch from WikiSync and official OSRS hiscores before atomically saving timestamped snapshots
2. `cleanup_player_data.js` removes per-player consecutive snapshots when tracked progress is unchanged (timestamp and rank churn are ignored)
3. `generate_static.js` validates game metadata, incrementally reads player snapshots, and atomically generates `public/index.html` plus JSON data files

### Key Files
- `config.js` - Central configuration: player list, display names, colors, ironman players
- `generate_static.js` - Main generator (~3500 lines), builds complete HTML with embedded JS for the dashboard
- `game_data/` - Static game metadata (quests.json, music_tracks.json, combat_achievements.json, collection_log.json)
- `player_data/` - Timestamped player snapshots organized by username
- `public/styles.css` - External CSS for the dashboard (98.css retro theme + custom styles)

### Data Sources
- RuneLite API: `https://sync.runescape.wiki/runelite/player/{username}/STANDARD`
- OSRS Highscores: `https://services.runescape.com/m=hiscore_oldschool/index_lite.json`
- Game metadata scraped from OSRS Wiki pages

### Configuration
Edit `PLAYER_CONFIG` in `config.js` to add/remove players. Required fields:
- `players` - array of OSRS usernames
- `displayNames` - map usernames to friendly names
- `colors` - hex colors for charts
- `ironmanPlayers` - players using ironman highscores

### Chart Data Aggregation
Time-series charts use daily aggregation (Europe/Vilnius timezone) - only the latest snapshot per player per day is shown. Comparison tables use full detail.

## Tech Stack
- Node.js 24.15-24.x or 26+ with ES modules (`"type": "module"`)
- Express 5.x for static file serving
- Chart.js for visualizations (embedded in generated HTML)
- 98.css for Windows 98 aesthetic
- JSDOM for HTML parsing in fetch scripts
