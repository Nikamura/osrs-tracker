# OSRS Tracker

> **Disclaimer**: This project is being vibe coded ✨ Good vibes only! 🌟

## Overview

A comprehensive tool to track Old School RuneScape (OSRS) progress for a group of friends. This project fetches player data from the RuneLite API and provides a rich web interface to compare and visualize various game metrics including quests, skills, achievement diaries, music tracks, and recent achievements.

## Features

### Data Collection
- **Automated Data Fetching**: Retrieves comprehensive player data from the [RuneLite API](https://sync.runescape.wiki/) including:
  - Quest completion status
  - Skill levels
  - Achievement diary progress
  - Music track unlocks
  - Combat achievements
  - Collection log progress
  - Sailing levels and WikiSync sea-charting task IDs
- **Data Storage**: Stores timestamped JSON files for historical tracking
- **Data Cleanup**: Removes consecutive per-player snapshots when only timestamps or hiscore ranks changed, while preserving actual progress
- **Daily Aggregation for Charts**: Time-series graphs (Quests, Total Level, Skill Level, Total XP) now keep only the latest sample per player per day (Europe/Vilnius). This reduces visual noise while preserving daily progress. Tables remain unaggregated.

### Web Interface
- **Interactive Dashboard**: Windows 98-style UI with draggable, minimizable, and closable windows
- **Loading Screen**: Smooth loading experience with spinner animation that prevents content flashing
- **Configuration Window**: Centralized control panel for:
  - Player selection/deselection with visual indicators
  - Window visibility toggles to show/hide specific data windows
  - Persistent settings that save across browser sessions
- **Window Controls**: Each window (except Configuration) features:
  - Minimize button to collapse/expand the window content
  - Close button to hide the window (can be reopened via Configuration panel)
- **Player Overview**: Compact per-player cards for total level, total XP, quests, collection log, combat achievements, Sailing level, and snapshot time
- **Sailing Progress**: Lightweight per-player Sailing and Captain's log progress bars
- **Sea Charting Explorer**: A separate, independently closable window for detailed chart tasks, seas, oceans, and filters
- **Progress Charts**: Line charts showing progression over time:
  - Quest completion progress
  - Total level progression
  - Individual skill level progression (with skill selector dropdown)
  - Total XP progression with a toggleable logarithmic/linear Y-axis (button in the Total XP window)
- **Comparison Tables**: Side-by-side comparison of:
  - Quest completion status
  - Skill levels with color-coded ranges and rankings
  - Achievement diary progress
  - Combat achievements with tier icons and completion status
  - Music track unlocks
  - Quest names now link to OSRS Wiki pages; music tracks link to their Wiki pages too
  - Collection log progress with item icons and completion percentages
- **Recent Achievements**: Timeline of recent progress with player-specific colors, including individual collection log items with icons
- **Player Selection**: Filter views by selected players with persistent preferences
- **Window Management**: Configure which windows are shown/hidden with persistent preferences
- **State Synchronization**: Window positions and states sync across browser tabs

## Project Structure

```
osrs-quest-tracker/
├── config.js               # Shared configuration for players, names, and colors
├── data_fetcher.js         # Fetches player data from RuneLite API
├── fetch_collection_log.js # Fetches collection log data from OSRS Wiki
├── fetch_combat_achievements.js # Fetches combat achievements data from OSRS Wiki
├── fetch_sea_charting.js # Fetches and validates sea-charting task metadata
├── generate_static.js      # Generates static HTML with all data and features
├── server.js               # Express server to serve the web interface
├── cleanup_player_data.js  # Removes duplicate consecutive data files
├── game_data/              # Stores static game data
├── player_data/            # Directory storing timestamped JSON files per player
├── public/                 # Frontend assets and generated dashboard/data
├── test/                   # Parser, data-normalization, and generation regression tests
├── package.json            # Project metadata and npm scripts
├── jsconfig.json          # JavaScript language service configuration
└── README.md              # This documentation
```

## Configuration

The project uses a centralized configuration system in `config.js` that defines:

- **Player List**: Array of player usernames to track
- **Display Names**: Mapping of usernames to friendly display names
- **Player Colors**: Color scheme for charts and visual elements
- **Ironman Players**: List of players who use ironman highscores

To add or modify players, edit the `PLAYER_CONFIG` object in `config.js`:

```javascript
export const PLAYER_CONFIG = {
  players: ["username1", "username2"],
  displayNames: {
    "username1": "Friendly Name 1",
    "username2": "Friendly Name 2"
  },
  colors: {
    "username1": "#FF6384",
    "username2": "#36A2EB"
  },
  ironmanPlayers: ["username1"]
};
```

## Requirements

- **Node.js**: v24.15.0 through v24.x, or v26+
- **Docker**: optional; the image uses Node 24 and bootstraps missing data automatically

## Setup and Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd osrs-quest-tracker
   ```

2. Install dependencies:
   ```bash
   npm ci
   ```

3. Configure players:
   Edit the `PLAYER_CONFIG` object in `config.js` to add/remove players and customize their display names and colors.

4. Fetch the required game metadata before the first generation:
   ```bash
   npm run fetch-game-data
   ```

## Usage

### Data Collection

Fetch current data for all configured players:
```bash
npm run fetch-data
```

Clean up duplicate data files:
```bash
npm run cleanup
```

Preview what cleanup would remove:
```bash
npm run cleanup:dry-run
```

### Web Interface

1. Fetch player data and generate the static interface:
   ```bash
   npm run fetch-data
   npm run generate
   ```

2. Start the web server:
   ```bash
   npm start
   ```

3. Open your browser and navigate to `http://localhost:3000`

### NPM Scripts

- `npm run fetch-data` - Fetch latest player data
- `npm run generate` - Generate static HTML interface
- `npm start` - Start the web server
- `npm run cleanup` - Remove duplicate data files
- `npm run cleanup:dry-run` - Report duplicate files without deleting them
- `npm run cron` - Fetch players, clean duplicates, and publish a new dashboard generation
- `npm run fetch-game-data` - Refresh and validate all OSRS Wiki metadata (each file is replaced atomically)
- `npm test` - Run the regression suite
- `npm run fetch-combat-achievements` - Fetch latest combat achievements data from the OSRS Wiki
- `npm run fetch-collection-log` - Fetch latest collection log data from the OSRS Wiki
- `npm run fetch-sea-charting` - Fetch and validate sea-charting task metadata from the OSRS Wiki
- `npm run fetch-music-tracks` - Fetch latest music tracks metadata from the OSRS Wiki
- `npm run fetch-quests` - Fetch latest quests and miniquests from the OSRS Wiki into a unified list

### Docker

```bash
docker compose up --build -d
```

The container validates/refetches game metadata and regenerates the dashboard at startup, bootstraps player data when no snapshots exist, refreshes player data every 15 minutes, and refreshes game metadata daily. Overlapping cron runs are skipped with a lock. `GET /healthz` reports whether a complete dashboard exists and was generated recently.

## Combat Achievements Feature

The combat achievements comparison table displays all combat achievements that players have completed, organized by tier difficulty. Key features include:

- **Tier Organization**: Achievements grouped by difficulty (Easy, Medium, Hard, Elite, Master, Grandmaster)
- **Tier Icons**: Visual tier indicators showing achievement difficulty level
- **Achievement Information**: Achievement names with links to their respective wiki pages and tooltips showing descriptions
- **Player Progress**: Visual indicators showing which players have completed each achievement
- **Total Count**: Sticky bottom row showing total achievements completed with top 3 rankings
- **Responsive Filtering**: Dynamically updates when players are selected/deselected, hiding achievements no selected player has completed
- **Rich Metadata**: Achievement details sourced from the comprehensive combat achievements database

The system uses the complete combat achievements metadata from `game_data/combat_achievements.json` to provide detailed information about each achievement including descriptions, types, and difficulty tiers.

## Collection Log Feature

The collection log comparison table displays all items that players have obtained in their collection logs, similar to the [OSRS Wiki Collection Log Table](https://oldschool.runescape.wiki/w/Collection_log/Table). Key features include:

- **Item Icons**: High-quality item icons sourced from the OSRS Wiki
- **Item Information**: Item names with links to their respective wiki pages
- **Player Progress**: Visual indicators showing which players have obtained each item
- **Completion Percentages**: Real-time calculation of what percentage of selected players have each item
- **Responsive Filtering**: Dynamically updates when players are selected/deselected

## Player Overview and Sailing

### Player Overview

The Player Overview window provides a quick status card for every selected player. Each card shows the latest snapshot time together with total level, total XP, completed quests, collection log total, completed combat achievements, and Sailing level. The cards follow the global player selection instead of adding another independent filter.

### Sailing Progress and Sea Charting Explorer

Sailing is split into two independently closable windows so the detailed data does not have to remain open beside the quick comparison:

- **Sailing Progress**: Shows each selected player's Sailing level, completed chart count, total known charts, and an accessible progress bar
- **Sea Charting Explorer**: Switches player, chart area, and status (`Missing`, `Completed`, or `All`); groups tasks into collapsible completion-area and sea summaries; and shows required Sailing level, chart type, bonus-chart status, hazard, task description, and relevant OSRS Wiki sea link
- **Metadata Drift Handling**: Sailing Progress reports newer WikiSync task IDs that are not present in the current metadata instead of silently treating them as known charts

On mobile, overview and Sailing summaries use cards rather than wide comparison tables. Explorer controls stack vertically, and completion areas and seas use nested native `details`/`summary` accordions so the task list remains scannable without a 358-row page.

### Sea-Charting Metadata Pipeline

`npm run fetch-sea-charting` queries the OSRS Wiki's structured `seachart` data, normalizes the task ID, description, required level, type, sea, ocean, locations, and hazard, then writes `game_data/sea_charting.json`. The fetch validates unique non-negative IDs, complete task metadata, valid Sailing levels, and a minimum of 358 tasks before replacing the previous file atomically. An unexpected item-count decrease is rejected unless it has been explicitly reviewed.

The script is included in `npm run fetch-game-data`, so Docker startup and the daily metadata refresh keep sea-charting metadata on the same lifecycle as quests, music tracks, combat achievements, and collection log data.

## Data Sources

- **Primary API**: [RuneLite Player Data API](https://sync.runescape.wiki/runelite/player/{username}/STANDARD)
- **Skills, XP, and activities**: [official OSRS hiscores](https://services.runescape.com/m=hiscore_oldschool/index_lite.json)
- **Item Icons**: [OSRS Wiki](https://oldschool.runescape.wiki/)
- **Music Tracks**: [OSRS Wiki Music page](https://oldschool.runescape.wiki/w/Music)
- **Quests**: [OSRS Wiki Quests/List](https://oldschool.runescape.wiki/w/Quests/List)
- **Sea-charting metadata**: [OSRS Wiki Sea charting page](https://oldschool.runescape.wiki/w/Sea_charting) and its structured `seachart` data
- **Data Types Collected**:
  - Quests (not started: 0, in progress: 1, completed: 2)
  - Skill levels (1-99+)
  - Achievement diaries (Easy, Medium, Hard, Elite completion status)
  - Music tracks (unlocked/locked boolean)
  - Combat achievements (task IDs array with detailed achievement metadata)
  - Collection log items (item IDs array with detailed item information)
  - Sea-charting task IDs and derived totals

WikiSync's response timestamp is the tracker request/detection time, not proof of the player's last RuneLite upload. A `sea_charting` ID means that the corresponding Captain's log task was completed in the player's latest WikiSync snapshot; it does **not** prove that the player visited, docked at, or unlocked an island. Individual chart descriptions, seas, oceans, and requirements come from OSRS Wiki metadata and may briefly lag behind newly released WikiSync IDs. The standard profile does not provide historical League-profile tracking.

## Player Configuration

Current tracked players (configured in `config.js`):
- clintonhill (Karolis)
- anime irl (Martynas) 
- swamp party (Petras)
- juozulis (Minvydas)
- serasvasalas (Mangirdas)
- scarycorpse (Darius)
- dedspirit (Egle)
- justlikemoon (Justas)
- Silainis13 (Silainis)

Display names and player colors are mapped in `config.js`.

## Technical Details

- **Frontend**: Vanilla JavaScript with Chart.js for visualizations
- **Styling**: 98.css for retro Windows 98 aesthetic + custom CSS in `public/styles.css`
- **Data Format**: JSON files with ISO timestamp naming convention
- **State Management**: localStorage for UI preferences and window states
- **Responsive Design**: Flexible desktop windows plus mobile-first cards, stacked controls, and collapsible sea-charting accordions
- **CSS Architecture**: Separated inline styles into external CSS file for better maintainability

## Changelog

### Latest Changes
- **August 2026 maintenance**: Updated live Wiki parsers for wrapped quest headings and the current music-table schema; added validation, honest request identification, retries/timeouts, atomic writes, and failure propagation.
- **Player Overview**: Added a compact, filter-aware card view of each player's headline progress and latest snapshot time.
- **Sailing-era support**: Added Sailing progress cards, the Sea Charting Explorer, and a validated OSRS Wiki metadata pipeline while keeping WikiSync completion limits explicit.
- **Correct collection totals**: Uses the official `Collections Logged` hiscore instead of WikiSync's unreliable raw varp count, and normalizes Prospector recolour IDs.
- **Safer operations**: Added per-player progress deduplication, cache-version enforcement, bounded first-run chart processing, Docker bootstrap/daily metadata refresh, a health endpoint, CSP, escaped upstream content, dependency updates, and regression tests.
- Quest comparison table: added sticky totals row and clickable quest names linking to the OSRS Wiki using metadata from `game_data/quests.json`.
- Achievement diaries table: added sticky totals row.
- Music tracks comparison: clickable track names using metadata from `game_data/music_tracks.json` and sticky totals row.
- Recent Achievements & Progress: includes collection items when previous counts were null, and adds music unlock achievements.
- **Total XP Scale Toggle Button**: The toggle is now a button inside the Total XP window (label: "Log scale: On/Off"). Preference persists in localStorage and applies immediately.
- **CSS Refactoring**: Extracted all inline CSS from `generate_static.js` into a separate `public/styles.css` file for better maintainability and code organization. The HTML template now references the external stylesheet.
- **Daily Graph Aggregation**: Charts show at most one point per day per player, using the latest snapshot for that day in Europe/Vilnius timezone. Interactive tables are unaffected and still show full detail.
- **Fixed Recent Achievements Table Styling**: Resolved inconsistent text styling where some rows appeared bold and others didn't. All rows now have consistent styling with a subtle left border indicator for achievements within the last 24 hours.
- **Music Tracks Totals Row**: Added a sticky totals row to the Music Tracks comparison showing the number of unlocked tracks per player, with top 3 rankings. Totals and rankings dynamically update with player selection filters.
 - **Level 99 Milestone Highlight**: Recent Achievements now marks hitting level 99 in any skill with a golden star and "99" badge for extra visibility.

### Previous Features
- Interactive dashboard with Windows 98-style UI
- Comprehensive player progress tracking
- Real-time data filtering and comparison tables
- Persistent user preferences and window management
