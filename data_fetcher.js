import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLAYER_CONFIG } from './config.js';
import { fetchJson } from './http.js';

const WIKISYNC_BASE_URL = 'https://sync.runescape.wiki/runelite/player';
const HISCORES_BASE_URL = 'https://services.runescape.com';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyFiniteNumbers(record, predicate = () => true) {
  return Object.values(record).every(value => Number.isFinite(value) && predicate(value));
}

function hasUniqueNamedRows(rows) {
  const names = rows.map(row => row?.name);
  return names.every(name => typeof name === 'string' && name.length > 0)
    && new Set(names).size === names.length;
}

export function validateWikiSyncData(data, player) {
  if (!isObject(data)) {
    throw new Error(`WikiSync returned a non-object payload for ${player}`);
  }
  if (data.error) {
    throw new Error(`WikiSync error for ${player}: ${data.error}`);
  }
  if (!isObject(data.quests) || !isObject(data.levels) || !isObject(data.music_tracks)) {
    throw new Error(`WikiSync payload for ${player} is missing quests, levels, or music tracks`);
  }
  if (Object.keys(data.quests).length < 200
      || !hasOnlyFiniteNumbers(data.quests, status => Number.isInteger(status) && status >= 0 && status <= 2)) {
    throw new Error(`WikiSync payload for ${player} contains incomplete or invalid quest data`);
  }
  if (Object.keys(data.levels).length < 24
      || !Object.hasOwn(data.levels, 'Sailing')
      || !hasOnlyFiniteNumbers(data.levels, level => Number.isInteger(level) && level >= 1 && level <= 99)) {
    throw new Error(`WikiSync payload for ${player} contains incomplete or invalid skill levels`);
  }
  if (Object.keys(data.music_tracks).length < 800
      || !Object.values(data.music_tracks).every(value => typeof value === 'boolean')) {
    throw new Error(`WikiSync payload for ${player} contains incomplete or invalid music data`);
  }
  const idArraysAreValid = ['combat_achievements', 'collection_log'].every(field =>
    Array.isArray(data[field]) && data[field].every(value => Number.isInteger(value))
  );
  const seaChartingIsValid = Object.hasOwn(data, 'sea_charting')
    && (data.sea_charting === null
      || (Array.isArray(data.sea_charting) && data.sea_charting.every(value => Number.isInteger(value))));
  if (!idArraysAreValid || !seaChartingIsValid) {
    throw new Error(`WikiSync payload for ${player} contains incomplete or invalid progress ID arrays`);
  }
  return data;
}

export function validateHighscoreData(data, player) {
  if (!isObject(data) || !Array.isArray(data.skills) || !Array.isArray(data.activities)) {
    throw new Error(`Highscores payload for ${player} is missing skills or activities`);
  }
  if (!data.skills.some(skill => skill?.name === 'Overall')) {
    throw new Error(`Highscores payload for ${player} is missing the Overall skill`);
  }
  if (data.skills.length < 25
      || !data.skills.some(skill => skill?.name === 'Sailing')
      || !hasUniqueNamedRows(data.skills)
      || !data.skills.every(skill => Number.isFinite(skill.level) && Number.isFinite(skill.xp))) {
    throw new Error(`Highscores payload for ${player} contains incomplete or invalid skills`);
  }
  if (data.activities.length < 91
      || !data.activities.some(activity => activity?.name === 'Collections Logged')
      || !hasUniqueNamedRows(data.activities)
      || !data.activities.every(activity => Number.isFinite(activity.score))) {
    throw new Error(`Highscores payload for ${player} contains incomplete or invalid activities`);
  }
  return data;
}

export async function getPlayerData(player) {
  const encodedPlayer = encodeURIComponent(player);
  const data = await fetchJson(`${WIKISYNC_BASE_URL}/${encodedPlayer}/STANDARD`);
  return validateWikiSyncData(data, player);
}

export async function getHighscoreData(player) {
  const endpoint = PLAYER_CONFIG.ironmanPlayers.includes(player)
    ? 'hiscore_oldschool_ironman'
    : 'hiscore_oldschool';
  const url = `${HISCORES_BASE_URL}/m=${endpoint}/index_lite.json?player=${encodeURIComponent(player)}`;
  const data = await fetchJson(url);
  return validateHighscoreData(data, player);
}

export async function fetchPlayerSnapshot(player) {
  const [wikiSyncData, highscoreData] = await Promise.all([
    getPlayerData(player),
    getHighscoreData(player)
  ]);

  return {
    ...wikiSyncData,
    skills: highscoreData.skills,
    activities: highscoreData.activities
  };
}

function saveSnapshot(player, timestamp, data) {
  const playerDirectory = path.join('player_data', player);
  mkdirSync(playerDirectory, { recursive: true });

  const filename = `${player}_${timestamp}.json`;
  const filePath = path.join(playerDirectory, filename);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(temporaryPath, filePath);
  return filePath;
}

export async function fetchAndSavePlayerData(players = PLAYER_CONFIG.players) {
  const timestamp = new Date().toISOString();

  // Validate the complete batch before writing any snapshots. A transient error for
  // one player must not create a misleading partial point in the shared timeline.
  const snapshots = await Promise.all(players.map(async player => {
    try {
      return { player, data: await fetchPlayerSnapshot(player) };
    } catch (error) {
      throw new Error(`Failed to fetch ${player}: ${error.message}`, { cause: error });
    }
  }));

  mkdirSync('player_data', { recursive: true });
  const savedFiles = snapshots.map(({ player, data }) => saveSnapshot(player, timestamp, data));
  console.log(`Saved ${savedFiles.length} complete player snapshots at ${timestamp}`);
  return savedFiles;
}

const isMainModule = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  fetchAndSavePlayerData().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
