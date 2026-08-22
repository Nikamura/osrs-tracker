import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const CACHE_DIR = "cache";
export const CACHE_VERSION = 3;

function atomicWrite(filePath, contents) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, contents);
  renameSync(temporaryPath, filePath);
}

/**
 * Load cache index and validate version
 */
export function loadCacheIndex() {
  const indexPath = path.join(CACHE_DIR, "index.json");
  try {
    const data = JSON.parse(readFileSync(indexPath, "utf-8"));
    if (data.version !== CACHE_VERSION) {
      console.log(`Cache version mismatch (got ${data.version}, expected ${CACHE_VERSION}), rebuilding...`);
      return { version: CACHE_VERSION, players: {} };
    }
    return data;
  } catch {
    return { version: CACHE_VERSION, players: {} };
  }
}

/**
 * Save cache index to disk
 */
export function saveCacheIndex(index) {
  ensureCacheDir();
  const indexPath = path.join(CACHE_DIR, "index.json");
  atomicWrite(indexPath, JSON.stringify(index, null, 2));
}

/**
 * Load cached data from a specific cache file
 */
export function loadCacheData(filename) {
  const filePath = path.join(CACHE_DIR, filename);
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Save data to a cache file
 */
export function saveCacheData(filename, data) {
  ensureCacheDir();
  const filePath = path.join(CACHE_DIR, filename);
  atomicWrite(filePath, JSON.stringify(data));
}

/**
 * Ensure cache directory exists
 */
function ensureCacheDir() {
  mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Get the latest file for a player from their data directory
 */
export function getLatestFileForPlayer(player) {
  const playerDir = path.join("player_data", player);
  try {
    const files = readdirSync(playerDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) return null;
    return files.sort().pop();
  } catch {
    return null;
  }
}

/**
 * Check if a player's cache is still valid (latest file hasn't changed)
 */
export function isPlayerCacheValid(cacheIndex, player) {
  const latestFile = getLatestFileForPlayer(player);
  if (!latestFile) {
    return false;
  }

  const cachedLatest = cacheIndex.players[player]?.latestFile;
  return cachedLatest === latestFile;
}

/**
 * Get all player directories
 */
export function getPlayerList() {
  try {
    return readdirSync("player_data", { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name);
  } catch {
    return [];
  }
}

/**
 * Load ALL player snapshots into memory (bulk load)
 * Returns: { player: { latestFile, latestData, allFiles: [{ filename, data }] } }
 */
export function loadAllPlayerData(players) {
  const result = {};

  for (const player of players) {
    const playerDir = path.join("player_data", player);
    const files = readdirSync(playerDir).filter(f => f.endsWith('.json')).sort();

    if (files.length === 0) {
      continue;
    }

    const latestFile = files[files.length - 1];
    const latestPath = path.join(playerDir, latestFile);
    const latestData = JSON.parse(readFileSync(latestPath, "utf-8"));

    // For comparison functions, we only need latest data
    // For charts/achievements, we load all files lazily
    result[player] = {
      latestFile,
      latestData,
      allFiles: files,
      playerDir
    };
  }

  return result;
}

/**
 * Load all snapshot data for a player (for chart/achievement processing)
 */
export function* loadAllSnapshotsForPlayer(playerInfo) {
  const { playerDir, allFiles } = playerInfo;
  for (const file of allFiles) {
    const filePath = path.join(playerDir, file);
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    yield { filename: file, data };
  }
}

/**
 * Get files that are newer than the cached latest file
 */
export function getNewFilesForPlayer(playerInfo, cachedLatestFile) {
  const { allFiles } = playerInfo;

  if (!cachedLatestFile) {
    return allFiles;
  }

  const cachedIndex = allFiles.indexOf(cachedLatestFile);
  if (cachedIndex === -1) {
    // Cached file not found, process all
    return allFiles;
  }

  // Return files after the cached one
  return allFiles.slice(cachedIndex);
}

/**
 * Load only new snapshot files for a player (after cachedLatestFile)
 */
export function* loadNewSnapshotsForPlayer(playerInfo, cachedLatestFile) {
  const { playerDir } = playerInfo;
  const newFiles = getNewFilesForPlayer(playerInfo, cachedLatestFile);

  // Skip the first file if it's the cached one (already processed)
  const filesToLoad = cachedLatestFile && newFiles[0] === cachedLatestFile
    ? newFiles.slice(1)
    : newFiles;

  for (const file of filesToLoad) {
    const filePath = path.join(playerDir, file);
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    yield { filename: file, data };
  }
}

function readGameDataArray(filename, minimumItems) {
  const filePath = path.join("game_data", filename);
  const data = JSON.parse(readFileSync(filePath, "utf-8"));
  if (!Array.isArray(data) || data.length < minimumItems) {
    throw new Error(`${filePath} contains ${Array.isArray(data) ? data.length : 'invalid'} items; expected at least ${minimumItems}`);
  }
  return data;
}

/**
 * Load game metadata (quests, combat achievements, collection log, music tracks)
 */
export function loadGameData() {
  const gameData = {
    quests: null,
    questMetaByName: {},
    knownQuestNames: null,
    questCapeRequiredNames: null,
    combatAchievements: {},
    collectionLog: {},
    musicTracks: {}
  };

  try {
    const quests = readGameDataArray("quests.json", 200);
    gameData.quests = quests;
    gameData.questMetaByName = quests.reduce((acc, quest) => {
      acc[quest.name] = quest;
      return acc;
    }, {});
    gameData.knownQuestNames = new Set(quests.map(quest => quest.name));
    gameData.questCapeRequiredNames = new Set(quests.filter(quest => !quest.isMiniquest).map(quest => quest.name));

    const combatAchievements = readGameDataArray("combat_achievements.json", 600);
    combatAchievements.forEach(achievement => {
      gameData.combatAchievements[achievement.taskId] = achievement;
    });

    const collectionLogItems = readGameDataArray("collection_log.json", 1_600);
    collectionLogItems.forEach(item => {
      gameData.collectionLog[item.itemId] = item;
    });

    const tracks = readGameDataArray("music_tracks.json", 800);
    tracks.forEach(track => {
      gameData.musicTracks[track.name] = track;
    });
  } catch (error) {
    throw new Error(`Game metadata is missing or invalid. Run \"npm run fetch-game-data\" first. ${error.message}`, {
      cause: error
    });
  }

  return gameData;
}
