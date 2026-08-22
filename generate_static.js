import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PLAYER_CONFIG, CHART_COLORS } from "./config.js";
import {
  CACHE_VERSION,
  loadCacheIndex,
  saveCacheIndex,
  loadCacheData,
  saveCacheData,
  getPlayerList,
  loadAllPlayerData,
  loadAllSnapshotsForPlayer,
  loadNewSnapshotsForPlayer,
  getNewFilesForPlayer,
  loadGameData
} from "./cache.js";

export const SITE_METADATA = Object.freeze({
  name: 'OSRS Tracker',
  title: 'OSRS Tracker — Group Progress, Sailing & Collection Logs',
  description: 'Compare Old School RuneScape group progress across skills, quests, collection logs, combat achievements and Sailing sea charting.',
  canonicalUrl: 'https://osrs-tracker.cn.lt/',
  locale: 'en_GB',
  socialImageUrl: 'https://osrs-tracker.cn.lt/og/osrs-tracker-card-v1.png',
  socialImageAlt: 'A Windows 98-style OSRS Tracker dashboard with player progress and Sailing windows.'
});

const SITE_STRUCTURED_DATA = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${SITE_METADATA.canonicalUrl}#website`,
  url: SITE_METADATA.canonicalUrl,
  name: SITE_METADATA.name,
  alternateName: 'OSRS Group Tracker',
  description: SITE_METADATA.description,
  inLanguage: 'en'
});

// Parse command line flags
const USE_CACHE = !process.argv.includes('--no-cache');
if (!USE_CACHE) {
  console.log('Cache disabled via --no-cache flag');
}

// Map alternate quest names from various data sources to canonical wiki names
const QUEST_NAME_ALIASES = {
  // Temporary WikiSync upstream mismatch (the API currently exposes this quest as ".").
  ".": "Fallen From Grace",
  "Recipe for Disaster - Another Cook's Quest": "Recipe for Disaster/Another Cook's Quest",
  "Recipe for Disaster - Culinaromancer": "Recipe for Disaster/Defeating the Culinaromancer",
  "Recipe for Disaster - Evil Dave": "Recipe for Disaster/Freeing Evil Dave",
  "Recipe for Disaster - King Awowogei": "Recipe for Disaster/Freeing King Awowogei",
  "Recipe for Disaster - Lumbridge Guide": "Recipe for Disaster/Freeing the Lumbridge Guide",
  "Recipe for Disaster - Mountain Dwarf": "Recipe for Disaster/Freeing the Mountain Dwarf",
  "Recipe for Disaster - Pirate Pete": "Recipe for Disaster/Freeing Pirate Pete",
  "Recipe for Disaster - Sir Amik Varze": "Recipe for Disaster/Freeing Sir Amik Varze",
  "Recipe for Disaster - Skrach Uglogwee": "Recipe for Disaster/Freeing Skrach Uglogwee",
  "Recipe for Disaster - Wartface & Bentnoze": "Recipe for Disaster/Freeing the Goblin generals"
};

const COLLECTION_ITEM_ALIASES = new Map([
  [29472, 12013],
  [29474, 12014],
  [29476, 12015],
  [29478, 12016]
]);

export function normalizeQuestName(questName) {
  return QUEST_NAME_ALIASES[questName] || questName;
}

export function normalizeQuestStatuses(quests) {
  if (!quests) return {};
  const normalized = {};
  for (const [questName, status] of Object.entries(quests)) {
    const canonicalName = normalizeQuestName(questName);
    // Preserve the highest status in case both alias and canonical entries exist
    if (normalized[canonicalName] === undefined || status > normalized[canonicalName]) {
      normalized[canonicalName] = status;
    }
  }
  return normalized;
}

function normalizeCollectionItemId(itemId) {
  const numericItemId = Number(itemId);
  return COLLECTION_ITEM_ALIASES.get(numericItemId) || numericItemId;
}

export function normalizeCollectionLogItems(items) {
  return [...new Set((items || []).map(normalizeCollectionItemId).filter(Number.isFinite))];
}

function getCollectionLogTotal(data) {
  const officialTotal = data.activities?.find(activity => activity.name === 'Collections Logged')?.score;
  if (Number.isFinite(officialTotal) && officialTotal >= 0) {
    return officialTotal;
  }
  return normalizeCollectionLogItems(data.collection_log).length;
}

// Keep only the latest entry per calendar day (Europe/Vilnius)
function groupLatestPerDay(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return entries;
  const byDay = new Map();
  for (const entry of entries) {
    const ts = new Date(entry.timestamp);
    const dayKey = ts.toLocaleDateString('en-CA', { timeZone: 'Europe/Vilnius' }); // YYYY-MM-DD
    const existing = byDay.get(dayKey);
    if (!existing || ts > new Date(existing.timestamp)) {
      byDay.set(dayKey, entry);
    }
  }
  return [...byDay.values()].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function addLatestPerDay(entries, entry) {
  const entryDay = new Date(entry.timestamp).toLocaleDateString('en-CA', { timeZone: 'Europe/Vilnius' });
  const lastEntry = entries.at(-1);
  if (!lastEntry) {
    entries.push(entry);
    return;
  }

  const lastDay = new Date(lastEntry.timestamp).toLocaleDateString('en-CA', { timeZone: 'Europe/Vilnius' });
  if (lastDay === entryDay) {
    if (new Date(entry.timestamp) >= new Date(lastEntry.timestamp)) {
      entries[entries.length - 1] = entry;
    }
    return;
  }

  entries.push(entry);
}

function atomicWrite(filePath, contents) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, contents);
  renameSync(temporaryPath, filePath);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

export function parseSnapshotTimestamp(filename) {
  const match = filename.match(/_(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\.json$/);
  if (!match) {
    throw new Error(`Snapshot filename has no ISO timestamp: ${filename}`);
  }
  return new Date(match[1]);
}

function getDisplayName(playerDir) {
  return PLAYER_CONFIG.displayNames[playerDir] || playerDir;
}

function getQuestComparisonData(playerDataMap, gameData) {
  const latestPlayerData = {};
  const allQuests = new Set();
  const { questMetaByName, knownQuestNames, questCapeRequiredNames } = gameData;

  const isKnownQuest = (questName) => {
    if (!knownQuestNames) return true;
    return knownQuestNames.has(questName);
  };

  for (const [player, playerInfo] of Object.entries(playerDataMap)) {
    const data = playerInfo.latestData;

    const normalizedQuests = normalizeQuestStatuses(data.quests);
    for (const questName of Object.keys(normalizedQuests)) {
      if (!isKnownQuest(questName)) {
        delete normalizedQuests[questName];
        continue;
      }
      allQuests.add(questName);
    }

    latestPlayerData[player] = normalizedQuests;
  }

  return {
    players: Object.keys(latestPlayerData).sort(),
    quests: [...allQuests].sort(),
    playerQuests: latestPlayerData,
    questMetaByName,
    questCapeRequiredNames
  };
}

function getLevelComparisonData(playerDataMap) {
  const latestPlayerData = {};
  const allSkills = new Set();

  for (const [player, playerInfo] of Object.entries(playerDataMap)) {
    const data = playerInfo.latestData;

    if (data.levels) {
      latestPlayerData[player] = data.levels;
      Object.keys(data.levels).forEach(skill => allSkills.add(skill));
    }
  }

  return {
    players: Object.keys(latestPlayerData).sort(),
    skills: [...allSkills].sort(),
    playerLevels: latestPlayerData
  };
}

function getOverallExperience(data) {
  const overall = data.skills?.find(skill => skill?.name === 'Overall');
  return Number.isFinite(overall?.xp) ? overall.xp : null;
}

export function getPlayerOverviewData(playerDataMap, gameData) {
  const knownQuestNames = gameData.knownQuestNames || new Set();
  const totalQuests = knownQuestNames.size;
  const totalCombatAchievements = Object.keys(gameData.combatAchievements || {}).length;
  const totalSeaChartingTasks = gameData.seaChartingTasks?.length || 0;
  const players = {};

  for (const [player, playerInfo] of Object.entries(playerDataMap)) {
    const data = playerInfo.latestData;
    const normalizedQuests = normalizeQuestStatuses(data.quests);
    const completedQuests = Object.entries(normalizedQuests).filter(([questName, status]) =>
      status === 2 && (knownQuestNames.size === 0 || knownQuestNames.has(questName))
    ).length;
    const levels = Object.values(data.levels || {}).filter(Number.isFinite);
    const seaCharting = Array.isArray(data.sea_charting)
      ? new Set(data.sea_charting.filter(Number.isInteger)).size
      : null;

    players[player] = {
      snapshotAt: parseSnapshotTimestamp(playerInfo.latestFile).toISOString(),
      totalLevel: levels.reduce((sum, level) => sum + level, 0),
      totalExperience: getOverallExperience(data),
      completedQuests,
      sailingLevel: Number.isFinite(data.levels?.Sailing) ? data.levels.Sailing : null,
      seaCharting,
      collectionLog: getCollectionLogTotal(data),
      combatAchievements: new Set((data.combat_achievements || []).filter(Number.isInteger)).size
    };
  }

  return {
    players: Object.keys(players).sort(),
    playerStats: players,
    totals: {
      quests: totalQuests,
      combatAchievements: totalCombatAchievements,
      seaCharting: totalSeaChartingTasks
    }
  };
}

function groupSeaChartingTasks(tasks, key) {
  const groups = new Map();
  for (const task of tasks) {
    const name = task[key];
    if (!groups.has(name)) {
      groups.set(name, {
        name,
        taskIds: []
      });
    }
    groups.get(name).taskIds.push(task.taskId);
  }

  return [...groups.values()]
    .map(group => ({ ...group, taskIds: group.taskIds.sort((a, b) => a - b) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getSailingProgressData(playerDataMap, seaChartingTasks) {
  const tasks = Array.isArray(seaChartingTasks) ? seaChartingTasks : [];
  const knownTaskIds = new Set(tasks.map(task => task.taskId));
  const playerProgress = {};

  for (const [player, playerInfo] of Object.entries(playerDataMap)) {
    const data = playerInfo.latestData;
    const hasSeaCharting = Array.isArray(data.sea_charting);
    const completedTaskIds = hasSeaCharting
      ? [...new Set(data.sea_charting.filter(Number.isInteger))].sort((a, b) => a - b)
      : [];
    const knownCompletedTaskIds = completedTaskIds.filter(taskId => knownTaskIds.has(taskId));

    playerProgress[player] = {
      available: hasSeaCharting,
      sailingLevel: Number.isFinite(data.levels?.Sailing) ? data.levels.Sailing : null,
      completedTaskIds: knownCompletedTaskIds,
      unknownTaskIds: completedTaskIds.filter(taskId => !knownTaskIds.has(taskId)),
      snapshotAt: parseSnapshotTimestamp(playerInfo.latestFile).toISOString()
    };
  }

  return {
    sourceUrl: 'https://oldschool.runescape.wiki/w/Sea_charting',
    totalTasks: tasks.length,
    players: Object.keys(playerProgress).sort(),
    playerProgress,
    completionGroups: groupSeaChartingTasks(tasks, 'completionGroup'),
    tasks: tasks.map(task => ({
      taskId: task.taskId,
      level: task.level,
      type: task.type,
      task: task.task,
      sea: task.sea,
      seaWikiLink: task.seaWikiLink,
      ocean: task.ocean,
      oceanWikiLink: task.oceanWikiLink,
      completionGroup: task.completionGroup,
      isBonusChart: task.isBonusChart,
      hazard: task.hazard
    }))
  };
}

function getAchievementDiaryComparisonData(playerDataMap) {
  const latestPlayerData = {};
  const allAchievements = new Set();

  for (const [player, playerInfo] of Object.entries(playerDataMap)) {
    const data = playerInfo.latestData;

    if (data.achievement_diaries) {
      latestPlayerData[player] = data.achievement_diaries;
      Object.keys(data.achievement_diaries).forEach(achievement => allAchievements.add(achievement));
    }
  }

  return {
    players: Object.keys(latestPlayerData).sort(),
    achievements: [...allAchievements].sort(),
    playerAchievements: latestPlayerData
  };
}

function getCombatAchievementsComparisonData(playerDataMap, combatAchievementsData) {
  const latestPlayerData = {};

  for (const [player, playerInfo] of Object.entries(playerDataMap)) {
    const data = playerInfo.latestData;

    if (data.combat_achievements) {
      latestPlayerData[player] = data.combat_achievements;
    }
  }

  return {
    players: Object.keys(latestPlayerData).sort(),
    playerCombatAchievements: latestPlayerData,
    combatAchievementsData: combatAchievementsData
  };
}

function getMusicTracksComparisonData(playerDataMap, musicTracksData) {
  const latestPlayerData = {};
  const allMusicTracks = new Set(Object.keys(musicTracksData || {}));

  for (const [player, playerInfo] of Object.entries(playerDataMap)) {
    const data = playerInfo.latestData;

    if (data.music_tracks) {
      latestPlayerData[player] = data.music_tracks;
      Object.keys(data.music_tracks).forEach(track => allMusicTracks.add(track));
    }
  }

  return {
    players: Object.keys(latestPlayerData).sort(),
    musicTracks: [...allMusicTracks].sort(),
    playerMusicTracks: latestPlayerData
  };
}

/**
 * Generate all chart data using pre-loaded player data with incremental caching.
 * Only reads new snapshot files since last cache, merges with cached progress data.
 */
function generateAllChartData(playerDataMap, cacheIndex, gameData) {
  // Try to load cached chart data (incremental format with per-player progress)
  const cachedChartData = USE_CACHE ? loadCacheData('chart_data.json') : null;
  const hasCache = cachedChartData?.cacheVersion === CACHE_VERSION && cachedChartData.processedFiles;

  // Process all files once for all chart types
  const questProgressData = {};
  const totalLevelProgressData = {};
  const totalExpProgressData = {};
  const skillLevelProgressData = {};
  const allSkills = new Set(hasCache ? cachedChartData.allSkills : []);
  const processedFiles = hasCache ? { ...cachedChartData.processedFiles } : {};

  let totalNewFiles = 0;

  for (const [player, playerInfo] of Object.entries(playerDataMap)) {
    // Restore cached per-player progress data if available
    if (hasCache && cachedChartData.questProgressData?.[player]) {
      questProgressData[player] = cachedChartData.questProgressData[player].map(e => ({ ...e, timestamp: new Date(e.timestamp) }));
      totalLevelProgressData[player] = cachedChartData.totalLevelProgressData[player].map(e => ({ ...e, timestamp: new Date(e.timestamp) }));
      totalExpProgressData[player] = cachedChartData.totalExpProgressData[player].map(e => ({ ...e, timestamp: new Date(e.timestamp) }));
      skillLevelProgressData[player] = cachedChartData.skillLevelProgressData[player].map(e => ({ ...e, timestamp: new Date(e.timestamp) }));
    } else {
      questProgressData[player] = [];
      totalLevelProgressData[player] = [];
      totalExpProgressData[player] = [];
      skillLevelProgressData[player] = [];
    }

    // Load only new snapshots since last processed file
    const cachedLatestFile = processedFiles[player] || null;
    const snapshots = cachedLatestFile
      ? loadNewSnapshotsForPlayer(playerInfo, cachedLatestFile)
      : loadAllSnapshotsForPlayer(playerInfo);
    const candidateFiles = cachedLatestFile
      ? getNewFilesForPlayer(playerInfo, cachedLatestFile)
      : playerInfo.allFiles;
    const pendingFileCount = cachedLatestFile && candidateFiles[0] === cachedLatestFile
      ? candidateFiles.length - 1
      : candidateFiles.length;

    if (pendingFileCount > 0) {
      totalNewFiles += pendingFileCount;
      console.log(`Processing ${pendingFileCount} new chart files for ${player}`);
    }

    for (const { filename, data } of snapshots) {
      const timestamp = parseSnapshotTimestamp(filename);

      if (data.quests) {
        const normalizedQuests = normalizeQuestStatuses(data.quests);
        const completedQuests = Object.entries(normalizedQuests).filter(([questName, status]) =>
          status === 2 && gameData.knownQuestNames.has(questName)
        ).length;
        addLatestPerDay(questProgressData[player], { timestamp, completedQuests });
      }

      if (data.levels) {
        const totalLevel = Object.values(data.levels).reduce((sum, level) => sum + (level || 0), 0);
        addLatestPerDay(totalLevelProgressData[player], { timestamp, totalLevel });
      }

      if (data.skills && Array.isArray(data.skills)) {
        const overallSkill = data.skills.find(s => s.name === 'Overall');
        if (overallSkill && overallSkill.xp > 0) {
          addLatestPerDay(totalExpProgressData[player], { timestamp, totalExp: overallSkill.xp });
        }
      }

      if (data.levels) {
        Object.keys(data.levels).forEach(skill => allSkills.add(skill));
        addLatestPerDay(skillLevelProgressData[player], { timestamp, skillLevels: { ...data.levels } });
      }
    }

    // Sort and aggregate to daily (cheap on already-aggregated data + few new entries)
    questProgressData[player].sort((a, b) => a.timestamp - b.timestamp);
    questProgressData[player] = groupLatestPerDay(questProgressData[player]);

    totalLevelProgressData[player].sort((a, b) => a.timestamp - b.timestamp);
    totalLevelProgressData[player] = groupLatestPerDay(totalLevelProgressData[player]);

    totalExpProgressData[player].sort((a, b) => a.timestamp - b.timestamp);
    totalExpProgressData[player] = groupLatestPerDay(totalExpProgressData[player]);

    skillLevelProgressData[player].sort((a, b) => a.timestamp - b.timestamp);
    skillLevelProgressData[player] = groupLatestPerDay(skillLevelProgressData[player]);

    // Track last processed file
    processedFiles[player] = playerInfo.allFiles[playerInfo.allFiles.length - 1];
  }

  if (totalNewFiles === 0 && hasCache) {
    console.log('Using cached chart data (no new files)');
  } else {
    console.log(`Processed ${totalNewFiles} new chart snapshot files`);
  }

  // Generate chart data from progress arrays
  const chartData = generateChartData(questProgressData);
  const totalLevelChartData = generateTotalLevelChartData(totalLevelProgressData);
  const totalExpChartData = generateTotalExpChartData(totalExpProgressData);

  // Cache the per-player progress data for incremental updates
  if (USE_CACHE) {
    saveCacheData('chart_data.json', {
      cacheVersion: CACHE_VERSION,
      processedFiles,
      allSkills: [...allSkills].sort(),
      questProgressData,
      totalLevelProgressData,
      totalExpProgressData,
      skillLevelProgressData
    });
  }

  return {
    chartData,
    totalLevelChartData,
    totalExpChartData,
    skillLevelProgressData: {
      playerData: skillLevelProgressData,
      availableSkills: [...allSkills].sort()
    }
  };
}


function generateTimeSeriesChartData(playerData, valueExtractor) {
  const datasets = [];
  const allTimestamps = new Set();
  const colors = CHART_COLORS;
  let colorIndex = 0;

  for (const player in playerData) {
    const data = playerData[player];
    data.forEach(d => allTimestamps.add(d.timestamp.getTime()));
  }

  const sortedTimestamps = [...allTimestamps].sort((a, b) => a - b);

  const labels = sortedTimestamps.map(timestamp => {
    return new Date(timestamp).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Europe/Vilnius'
    });
  });

  for (const player in playerData) {
    const data = playerData[player];
    const color = colors[colorIndex % colors.length];
    colorIndex++;

    const formattedData = data.map(d => ({
      x: d.timestamp.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Europe/Vilnius'
      }),
      y: valueExtractor(d)
    }));

    datasets.push({
      label: getDisplayName(player),
      data: formattedData,
      borderColor: color,
      backgroundColor: color + '33',
      fill: false,
    });
  }

  return { labels, datasets };
}

function generateChartData(playerData) {
  return generateTimeSeriesChartData(playerData, d => d.completedQuests);
}

function generateTotalLevelChartData(playerData) {
  return generateTimeSeriesChartData(playerData, d => d.totalLevel);
}

function generateSkillLevelChartData(playerData, selectedSkill) {
  return generateTimeSeriesChartData(playerData, d => d.skillLevels[selectedSkill] || 1);
}

function getAchievementsData(playerDataMap, cacheIndex, gameData) {
  const { combatAchievements: combatAchievementsData, collectionLog: collectionLogData, musicTracks: musicTracksData, knownQuestNames, questCapeRequiredNames } = gameData;

  // Load cached achievements
  let cachedAchievements = USE_CACHE ? loadCacheData('achievements.json') : null;
  if (cachedAchievements?.cacheVersion !== CACHE_VERSION) {
    cachedAchievements = { cacheVersion: CACHE_VERSION, achievements: [], processedFiles: {} };
  }

  // Convert cached timestamps back to Date objects
  const existingAchievements = cachedAchievements.achievements.map(a => ({
    ...a,
    timestamp: new Date(a.timestamp),
    previousTimestamp: new Date(a.previousTimestamp)
  }));

  const newAchievements = [];

  const isKnownQuest = (questName) => {
    if (!knownQuestNames) return true;
    return knownQuestNames.has(questName);
  };

  for (const [player, playerInfo] of Object.entries(playerDataMap)) {
    const { allFiles, playerDir } = playerInfo;
    if (allFiles.length < 2) continue;

    // Find which files we need to process (new files since last cache)
    const cachedLastFile = cachedAchievements.processedFiles[player];
    let startIndex = 1; // Default: process from second file

    if (cachedLastFile) {
      const cachedIdx = allFiles.indexOf(cachedLastFile);
      if (cachedIdx !== -1) {
        // Start processing from the file AFTER the cached one
        startIndex = cachedIdx + 1;
      }
    }

    // If no new files to process, skip this player
    if (startIndex >= allFiles.length) {
      continue;
    }

    console.log(`Processing ${allFiles.length - startIndex} new achievement files for ${player}`);

    // Process file pairs starting from the first new file
    // Cache previous data to avoid re-reading the same file
    let cachedPreviousData = null;
    try {
      cachedPreviousData = JSON.parse(readFileSync(path.join(playerDir, allFiles[startIndex - 1]), "utf-8"));
    } catch { /* will be re-attempted in loop */ }
    for (let i = startIndex; i < allFiles.length; i++) {
      const currentFile = allFiles[i];
      const previousFile = allFiles[i - 1];

      try {
        const currentData = JSON.parse(readFileSync(path.join(playerDir, currentFile), "utf-8"));
        const previousData = cachedPreviousData || JSON.parse(readFileSync(path.join(playerDir, previousFile), "utf-8"));

        const currentTimestamp = parseSnapshotTimestamp(currentFile);
        const previousTimestamp = parseSnapshotTimestamp(previousFile);

        const currentQuests = normalizeQuestStatuses(currentData.quests);
        const previousQuests = normalizeQuestStatuses(previousData.quests);

        // Check for quest completions
        if (currentData.quests && previousData.quests) {
          for (const [questName, currentStatus] of Object.entries(currentQuests)) {
            if (!isKnownQuest(questName)) {
              continue;
            }
            const previousStatus = previousQuests[questName] || 0;
            if (previousStatus !== 2 && currentStatus === 2) {
              newAchievements.push({
                player: player,
                type: 'quest',
                name: questName,
                timestamp: currentTimestamp,
                previousTimestamp: previousTimestamp,
                displayName: getDisplayName(player),
                isMajorAchievement: false
              });
            }
          }

          let questCapeQuestNames = null;
          if (questCapeRequiredNames && questCapeRequiredNames.size > 0) {
            questCapeQuestNames = questCapeRequiredNames;
          } else {
            questCapeQuestNames = new Set(Object.keys(currentQuests).filter(isKnownQuest));
          }

          const requiredQuestNames = [...questCapeQuestNames];

          const hasQuestCapeNow = requiredQuestNames.length > 0 && requiredQuestNames.every(questName => {
            return currentQuests[questName] === 2;
          });

          const hadQuestCapeBefore = requiredQuestNames.length > 0 && requiredQuestNames.every(questName => {
            return previousQuests[questName] === 2;
          });

          if (hasQuestCapeNow && !hadQuestCapeBefore) {
            newAchievements.push({
              player: player,
              type: 'quest',
              name: 'Quest Cape (All quests complete)',
              timestamp: currentTimestamp,
              previousTimestamp: previousTimestamp,
              displayName: getDisplayName(player),
              isQuestCape: true,
              isMajorAchievement: true
            });
          }
        }

        // Check for achievement diary completions
        if (currentData.achievement_diaries && previousData.achievement_diaries) {
          for (const [diaryName, currentDiary] of Object.entries(currentData.achievement_diaries)) {
            const previousDiary = previousData.achievement_diaries[diaryName];
            if (previousDiary) {
              for (const [difficulty, currentDifficulty] of Object.entries(currentDiary)) {
                if (difficulty !== 'tasks') {
                  const previousDifficulty = previousDiary[difficulty];
                  if (previousDifficulty) {
                    const wasCompleted = Array.isArray(previousDifficulty.tasks) && previousDifficulty.tasks.length > 0 && previousDifficulty.tasks.every(task => task);
                    const isCompleted = Array.isArray(currentDifficulty.tasks) && currentDifficulty.tasks.length > 0 && currentDifficulty.tasks.every(task => task);

                    if (!wasCompleted && isCompleted) {
                      newAchievements.push({
                        player: player,
                        type: 'diary',
                        name: `${diaryName} ${difficulty}`,
                        timestamp: currentTimestamp,
                        previousTimestamp: previousTimestamp,
                        displayName: getDisplayName(player),
                        isMajorAchievement: false
                      });
                    }
                  }
                }
              }
            }
          }
        }

        // Check for level increases
        if (currentData.levels && previousData.levels) {
          for (const [skillName, currentLevel] of Object.entries(currentData.levels)) {
            const previousLevel = previousData.levels[skillName] || 1;
            if (currentLevel > previousLevel) {
              const isMaxLevel = currentLevel >= 99 && previousLevel < 99;
              newAchievements.push({
                player: player,
                type: 'level',
                name: `${skillName} (${previousLevel} → ${currentLevel})`,
                timestamp: currentTimestamp,
                previousTimestamp: previousTimestamp,
                displayName: getDisplayName(player),
                isMaxLevel: isMaxLevel,
                skill: skillName,
                newLevel: currentLevel,
                isMajorAchievement: isMaxLevel
              });
            }
          }
        }

        // Check for combat achievement progress
        if (currentData.combat_achievements && previousData.combat_achievements) {
          const currentAchievements = new Set(currentData.combat_achievements);
          const previousAchievements = new Set(previousData.combat_achievements);

          const newCombatAchievements = [...currentAchievements].filter(id => !previousAchievements.has(id));

          for (const achievementId of newCombatAchievements) {
            const achievementData = combatAchievementsData[achievementId];
            if (achievementData) {
              newAchievements.push({
                player: player,
                type: 'combat',
                name: achievementData.name,
                tierIconUrl: achievementData.tierIconUrl,
                nameWikiLink: achievementData.nameWikiLink,
                description: achievementData.description,
                timestamp: currentTimestamp,
                previousTimestamp: previousTimestamp,
                displayName: getDisplayName(player),
                isMajorAchievement: false
              });
            }
          }
        }

        // Use Jagex's official hiscore total. WikiSync's collectionLogItemCount
        // comes from a game varp that upstream documents as unreliable.
        const currentCollectionCount = getCollectionLogTotal(currentData);
        const previousCollectionCount = getCollectionLogTotal(previousData);
        if (currentCollectionCount > previousCollectionCount) {
          newAchievements.push({
            player: player,
            type: 'collection',
            name: `Collection Log (${previousCollectionCount} → ${currentCollectionCount} items)`,
            timestamp: currentTimestamp,
            previousTimestamp: previousTimestamp,
            displayName: getDisplayName(player)
          });
        }

        // Check for individual collection log item completions
        if (currentData.collection_log) {
          const currentItems = new Set(normalizeCollectionLogItems(currentData.collection_log));
          const previousItems = new Set(normalizeCollectionLogItems(previousData.collection_log));

          const newItems = [...currentItems].filter(itemId => !previousItems.has(itemId));

          for (const itemId of newItems) {
            const itemData = collectionLogData[itemId];
            if (itemData) {
              newAchievements.push({
                player: player,
                type: 'collection_item',
                name: itemData.itemName,
                itemIcon: itemData.itemIcon,
                itemLink: itemData.itemLink,
                timestamp: currentTimestamp,
                previousTimestamp: previousTimestamp,
                displayName: getDisplayName(player),
                isMajorAchievement: false
              });
            }
          }
        }

        // Check for music tracks unlocked
        if (currentData.music_tracks) {
          const prevMusic = previousData.music_tracks || {};
          for (const [trackName, isUnlocked] of Object.entries(currentData.music_tracks)) {
            const wasUnlocked = !!prevMusic[trackName];
            if (!wasUnlocked && isUnlocked === true) {
              const meta = musicTracksData ? musicTracksData[trackName] : null;
              newAchievements.push({
                player: player,
                type: 'music',
                name: trackName,
                nameWikiLink: meta?.nameWikiLink,
                timestamp: currentTimestamp,
                previousTimestamp: previousTimestamp,
                displayName: getDisplayName(player),
                isMajorAchievement: false
              });
            }
          }
        }

        // Check for league task completions
        if (currentData.league_tasks && previousData.league_tasks) {
          const currentCount = currentData.league_tasks.length;
          const previousCount = previousData.league_tasks.length;
          if (currentCount > previousCount) {
            newAchievements.push({
              player: player,
              type: 'league',
              name: `League Task (${previousCount} → ${currentCount} completed)`,
              timestamp: currentTimestamp,
              previousTimestamp: previousTimestamp,
              displayName: getDisplayName(player),
              isMajorAchievement: false
            });
          }
        }

        // Sailing sea charting is exposed as completed task IDs by WikiSync.
        if (Array.isArray(currentData.sea_charting) && Array.isArray(previousData.sea_charting)) {
          const currentCount = new Set(currentData.sea_charting).size;
          const previousCount = new Set(previousData.sea_charting || []).size;
          if (currentCount > previousCount) {
            newAchievements.push({
              player,
              type: 'sea_charting',
              name: `Sea Charting (${previousCount} → ${currentCount} tasks)`,
              timestamp: currentTimestamp,
              previousTimestamp,
              displayName: getDisplayName(player),
              isMajorAchievement: false
            });
          }
        }

        // Check for activity score increases
        if (currentData.activities && previousData.activities) {
          const currentActivitiesMap = new Map(currentData.activities.map(a => [a.name, a.score]));
          const previousActivitiesMap = new Map(previousData.activities.map(a => [a.name, a.score]));

          for (const [activityName, currentScore] of currentActivitiesMap) {
            if (activityName === 'Collections Logged' || !previousActivitiesMap.has(activityName)) {
              continue;
            }
            const previousScore = previousActivitiesMap.get(activityName);
            if (currentScore > 0 && currentScore > previousScore) {
              newAchievements.push({
                player: player,
                type: 'activity',
                name: previousScore === -1 ? `${activityName} (Score: ${currentScore})` : `${activityName} (${previousScore} -> ${currentScore})`,
                timestamp: currentTimestamp,
                previousTimestamp: previousTimestamp,
                displayName: getDisplayName(player),
                isMajorAchievement: false
              });
            }
          }
        }

        cachedPreviousData = currentData;
      } catch (error) {
        console.error(`Error processing files for ${player}:`, error);
        cachedPreviousData = null;
        continue;
      }
    }

    // Update processed files tracker
    cachedAchievements.processedFiles[player] = allFiles[allFiles.length - 1];
  }

  // Merge existing and new achievements
  // Reprocessing is necessary when cleanup removed the cache's last file. Keep
  // cached history, but collapse the repeated events generated by that rebuild.
  const achievementsByKey = new Map();
  for (const achievement of [...existingAchievements, ...newAchievements]) {
    const timestamp = achievement.timestamp instanceof Date
      ? achievement.timestamp.toISOString()
      : achievement.timestamp;
    const key = JSON.stringify([achievement.player, achievement.type, achievement.name, timestamp]);
    achievementsByKey.set(key, achievement);
  }
  const allAchievements = [...achievementsByKey.values()];

  // Sort achievements by timestamp (most recent first)
  allAchievements.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  // Save updated cache
  if (USE_CACHE) {
    saveCacheData('achievements.json', {
      cacheVersion: CACHE_VERSION,
      achievements: allAchievements.map(a => ({
        ...a,
        timestamp: a.timestamp.toISOString(),
        previousTimestamp: a.previousTimestamp.toISOString()
      })),
      processedFiles: cachedAchievements.processedFiles
    });
  }

  // Filter to show only achievements from the last 30 days by default
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentAchievements = allAchievements.filter(achievement =>
    achievement.timestamp > thirtyDaysAgo
  );

  return recentAchievements;
}

function getCollectionLogComparisonData(playerDataMap, collectionLogData) {
  const latestPlayerData = {};
  const playerCollectionTotals = {};

  for (const [player, playerInfo] of Object.entries(playerDataMap)) {
    const data = playerInfo.latestData;

    if (data.collection_log) {
      latestPlayerData[player] = normalizeCollectionLogItems(data.collection_log);
      playerCollectionTotals[player] = getCollectionLogTotal(data);
    }
  }

  return {
    players: Object.keys(latestPlayerData).sort(),
    playerCollectionLogs: latestPlayerData,
    playerCollectionTotals,
    collectionLogData: collectionLogData,
  };
}

function generatePlayerSelectionUI(players) {
  if (players.length === 0) {
    return "<p>No players found.</p>";
  }

  let selectionHtml = '<div class="player-selection">';
  selectionHtml += '<h3>Player Selection</h3>';
  selectionHtml += '<div class="player-options">';

  for (const [index, player] of players.sort().entries()) {
    const displayName = getDisplayName(player);
    const inputId = `player-option-${index}`;
    selectionHtml += `
      <div class="player-option">
        <input type="checkbox" id="${inputId}" value="${escapeHtml(player)}" checked onchange="updatePlayerSelection()">
        <label class="player-label" for="${inputId}">
          <span class="player-name">${escapeHtml(displayName)}</span>
        </label>
      </div>
    `;
  }

  selectionHtml += '</div>';
  selectionHtml += '<div class="player-actions">';
  selectionHtml += '<button onclick="selectAllPlayers()">Select All</button>';
  selectionHtml += '<button onclick="deselectAllPlayers()">Deselect All</button>';
  selectionHtml += '<label class="time-period-control">Time Period:';
  selectionHtml += '<select id="timePeriodSelect" onchange="updateTimePeriod()">';
  selectionHtml += '<option value="30">Last 30 days</option>';
  selectionHtml += '<option value="60">Last 60 days</option>';
  selectionHtml += '<option value="90">Last 90 days</option>';
  selectionHtml += '<option value="365">Last year</option>';
  selectionHtml += '<option value="all">All time</option>';
  selectionHtml += '</select>';
  selectionHtml += '</label>';
  selectionHtml += '</div>';
  selectionHtml += '</div>';

  return selectionHtml;
}

function generateWindowVisibilityUI() {
  const windows = [
    { id: 'player-overview', name: 'Player Overview', enabled: true, introducedVersion: 2 },
    { id: 'sailing-progress', name: 'Sailing Progress', enabled: true, introducedVersion: 2 },
    { id: 'sea-charting-explorer', name: 'Sea Charting Explorer', enabled: true, introducedVersion: 2 },
    { id: 'quest-progress', name: 'Quest Progress', enabled: true },
    { id: 'total-level-progress', name: 'Total Level Progress', enabled: true },
    { id: 'total-exp-progress', name: 'Total XP Progress', enabled: true },
    { id: 'skill-level-progress', name: 'Skill Level Progress', enabled: true },
    { id: 'quest-comparison', name: 'Quest Comparison', enabled: true },
    { id: 'level-comparison', name: 'Level Comparison', enabled: true },
    { id: 'achievement-diaries-comparison', name: 'Achievement Diaries Comparison', enabled: true },
    { id: 'combat-achievements-comparison', name: 'Combat Achievements Comparison', enabled: true },
    { id: 'music-tracks-comparison', name: 'Music Tracks Comparison', enabled: true },
    { id: 'collection-log-comparison', name: 'Collection Log Comparison', enabled: true },
    { id: 'activities-comparison', name: 'Activities Comparison', enabled: true },
    { id: 'recent-achievements--progress', name: 'Recent Achievements & Progress', enabled: true }
  ];

  let visibilityHtml = '<div class="window-visibility">';
  visibilityHtml += '<h3>Window Visibility</h3>';
  visibilityHtml += '<div class="window-options">';

  for (const window of windows) {
    visibilityHtml += `
      <div class="window-option">
        <input type="checkbox" id="window-${window.id}" value="${window.id}" data-introduced-version="${window.introducedVersion || 1}" ${window.enabled ? 'checked' : ''} onchange="updateWindowVisibility()">
        <label class="window-label" for="window-${window.id}">
          <span class="window-name">${window.name}</span>
        </label>
      </div>
    `;
  }

  visibilityHtml += '</div>';
  visibilityHtml += '<div class="window-actions">';
  visibilityHtml += '<button onclick="showAllWindows()">Show All</button>';
  visibilityHtml += '<button onclick="hideAllWindows()" style="margin-left: 10px;">Hide All</button>';
  visibilityHtml += '</div>';
  visibilityHtml += '</div>';

  return visibilityHtml;
}

// Chart Options UI removed from Configuration; control moved into Total XP window

function generateTotalExpChartData(playerData) {
  return generateTimeSeriesChartData(playerData, d => d.totalExp);
}

// Activities to exclude from the comparison table
const IGNORED_ACTIVITIES = new Set([
  "PvP Arena - Rank",
  "LMS - Rank",
  "League Points",
  "Soul Wars Zeal",
  "Collections Logged"
]);

function getActivitiesComparisonData(playerDataMap) {
  const latestPlayerData = {};
  const allActivities = new Set();

  for (const [player, playerInfo] of Object.entries(playerDataMap)) {
    const data = playerInfo.latestData;

    if (data.activities && Array.isArray(data.activities)) {
      const playerActivities = {};
      data.activities.forEach(activity => {
        if (activity.score > 0 && !IGNORED_ACTIVITIES.has(activity.name)) {
          playerActivities[activity.name] = activity.score;
          allActivities.add(activity.name);
        }
      });

      if (Array.isArray(data.sea_charting)) {
        playerActivities['Sea charting tasks'] = new Set(data.sea_charting).size;
        allActivities.add('Sea charting tasks');
      }
      latestPlayerData[player] = playerActivities;
    }
  }

  return {
    players: Object.keys(latestPlayerData).sort(),
    activities: [...allActivities].sort(),
    playerActivities: latestPlayerData
  };
}

export async function generateStaticHTML() {
  mkdirSync('public', { recursive: true });

  console.log('Generating static HTML...');

  try {
    // === BULK DATA LOADING PHASE ===
    console.log('Loading data...');
    const startLoad = Date.now();

    // Load cache index (for incremental processing)
    const cacheIndex = USE_CACHE ? loadCacheIndex() : { version: 1, players: {} };

    // Load all game metadata once
    const gameData = loadGameData();

    // Get player list and load all latest snapshots
    const players = getPlayerList();
    const playerDataMap = loadAllPlayerData(players);

    console.log(`Data loaded in ${Date.now() - startLoad}ms`);

    // === GENERATE COMPARISON DATA (using pre-loaded data) ===
    console.log('Generating comparison tables...');
    const startCompare = Date.now();

    const questComparisonData = getQuestComparisonData(playerDataMap, gameData);
    const levelComparisonData = getLevelComparisonData(playerDataMap);
    const achievementDiaryComparisonData = getAchievementDiaryComparisonData(playerDataMap);
    const combatAchievementsComparisonData = getCombatAchievementsComparisonData(playerDataMap, gameData.combatAchievements);
    const musicTracksComparisonData = getMusicTracksComparisonData(playerDataMap, gameData.musicTracks);
    const collectionLogComparisonData = getCollectionLogComparisonData(playerDataMap, gameData.collectionLog);
    const activitiesComparisonData = getActivitiesComparisonData(playerDataMap);
    const playerOverviewData = getPlayerOverviewData(playerDataMap, gameData);
    const sailingProgressData = getSailingProgressData(playerDataMap, gameData.seaChartingTasks);

    console.log(`Comparison data generated in ${Date.now() - startCompare}ms`);

    // === GENERATE CHART DATA (with caching) ===
    console.log('Generating chart data...');
    const startCharts = Date.now();

    const { chartData, totalLevelChartData, totalExpChartData, skillLevelProgressData } =
      generateAllChartData(playerDataMap, cacheIndex, gameData);

    const defaultSkill = skillLevelProgressData.availableSkills[0] || 'Attack';
    const skillLevelChartData = generateSkillLevelChartData(skillLevelProgressData.playerData, defaultSkill);

    console.log(`Chart data generated in ${Date.now() - startCharts}ms`);

    // === GENERATE ACHIEVEMENTS DATA (with incremental caching) ===
    console.log('Generating achievements...');
    const startAchievements = Date.now();

    const achievementsData = getAchievementsData(playerDataMap, cacheIndex, gameData);

    console.log(`Achievements generated in ${Date.now() - startAchievements}ms`);

    // === SAVE CACHE ===
    if (USE_CACHE) {
      // Update cache index with latest files
      for (const player of Object.keys(playerDataMap)) {
        cacheIndex.players[player] = {
          latestFile: playerDataMap[player].latestFile
        };
      }
      saveCacheIndex(cacheIndex);
    }

    const playerSelectionHtml = generatePlayerSelectionUI(Object.keys(playerDataMap));
    const windowVisibilityHtml = generateWindowVisibilityUI();

    const generatedAt = new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'Europe/Vilnius'
    });

    // Write JSON data files
    mkdirSync('public/data', { recursive: true });
    const dataVersion = Date.now();

    atomicWrite('public/data/chart-data.json', JSON.stringify({
      questChart: chartData,
      totalLevelChart: totalLevelChartData,
      totalExpChart: totalExpChartData,
      skillLevelProgress: skillLevelProgressData,
      skillLevelChart: skillLevelChartData
    }));

    atomicWrite('public/data/player-config.json', JSON.stringify({
      displayToPlayer: Object.fromEntries(
        PLAYER_CONFIG.players.map(p => [getDisplayName(p), p])
      ),
      playerToDisplay: Object.fromEntries(
        PLAYER_CONFIG.players.map(p => [p, getDisplayName(p)])
      ),
      playerColors: PLAYER_CONFIG.colors,
      chartColors: CHART_COLORS
    }));

    // Serialize table data - handle non-JSON types
    const serializedAchievements = achievementsData.map(a => ({
      ...a,
      timestamp: a.timestamp.toISOString(),
      previousTimestamp: a.previousTimestamp.toISOString()
    }));

    // Remove questCapeRequiredNames (it's a Set, not needed client-side)
    const { questCapeRequiredNames, ...questDataForClient } = questComparisonData;

    atomicWrite('public/data/table-data.json', JSON.stringify({
      quests: questDataForClient,
      levels: levelComparisonData,
      achievementDiaries: achievementDiaryComparisonData,
      combatAchievements: combatAchievementsComparisonData,
      musicTracks: musicTracksComparisonData,
      musicTracksMetadata: gameData.musicTracks || {},
      collectionLog: collectionLogComparisonData,
      activities: activitiesComparisonData,
      playerOverview: playerOverviewData,
      sailing: sailingProgressData,
      achievements: serializedAchievements
    }));

    const htmlContent = `<!DOCTYPE html>
<html lang="en" prefix="og: https://ogp.me/ns#">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${escapeHtml(SITE_METADATA.title)}</title>
  <meta name="description" content="${escapeHtml(SITE_METADATA.description)}">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
  <meta name="theme-color" content="#008080">
  <meta name="application-name" content="${escapeHtml(SITE_METADATA.name)}">
  <meta name="apple-mobile-web-app-title" content="${escapeHtml(SITE_METADATA.name)}">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="canonical" href="${SITE_METADATA.canonicalUrl}">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon-48x48.png" type="image/png" sizes="48x48">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">
  <link rel="manifest" href="/site.webmanifest">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(SITE_METADATA.title)}">
  <meta property="og:description" content="${escapeHtml(SITE_METADATA.description)}">
  <meta property="og:url" content="${SITE_METADATA.canonicalUrl}">
  <meta property="og:site_name" content="${escapeHtml(SITE_METADATA.name)}">
  <meta property="og:locale" content="${SITE_METADATA.locale}">
  <meta property="og:image" content="${SITE_METADATA.socialImageUrl}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${escapeHtml(SITE_METADATA.socialImageAlt)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(SITE_METADATA.title)}">
  <meta name="twitter:description" content="${escapeHtml(SITE_METADATA.description)}">
  <meta name="twitter:image" content="${SITE_METADATA.socialImageUrl}">
  <meta name="twitter:image:alt" content="${escapeHtml(SITE_METADATA.socialImageAlt)}">
  <script type="application/ld+json">${SITE_STRUCTURED_DATA}</script>
  <link rel="stylesheet" href="https://unpkg.com/98.css@0.1.21/dist/98.css">
  <link rel="stylesheet" href="styles.css">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js"></script>
  <!-- 100% privacy-first analytics -->
  <script data-collect-dnt="true" async src="https://scripts.simpleanalyticscdn.com/latest.js"></script>
</head>
<body class="loading" data-version="${dataVersion}" data-window-catalog-version="2" style="background-color: #008080;">
  <noscript><img src="https://queue.simpleanalyticscdn.com/noscript.gif?collect-dnt=true" alt="" referrerpolicy="no-referrer-when-downgrade"/></noscript>
  <!-- Loading screen -->
  <div class="loading-screen" id="loadingScreen">
    <div class="loading-content">
      <div class="loading-spinner"></div>
      <div class="loading-text">Loading OSRS Tracker</div>
      <div class="loading-subtext">Initializing windows and applying saved settings...</div>
    </div>
  </div>

  <div class="generated-at" data-nosnippet>Generated: ${generatedAt}</div>
  <main class="container">
    <div class="window main-window configuration-window">
      <div class="title-bar">
        <div class="title-bar-text">Configuration</div>
        <div class="title-bar-controls">
          <button aria-label="Minimize" onclick="toggleWindow(this)"></button>
        </div>
      </div>
      <div class="window-body">
        <header class="site-intro">
          <img class="site-intro-icon" src="/favicon.svg" width="48" height="48" alt="">
          <div class="site-intro-copy">
            <h1>OSRS Tracker</h1>
            <p>Compare the crew across quests, levels, achievements, collection logs and Sailing.</p>
          </div>
        </header>
        <p class="site-attribution">Created using intellectual property belonging to Jagex Limited under the terms of Jagex's Fan Content Policy. This content is not endorsed by or affiliated with Jagex. <a href="https://legal.jagex.com/docs/policies/fan-content-policy" target="_blank" rel="noopener noreferrer">Read the policy</a>.</p>
        ${playerSelectionHtml}
        ${windowVisibilityHtml}
      </div>
    </div>
    <div class="window main-window" data-window-id="player-overview" data-introduced-version="2">
      <div class="title-bar">
        <div class="title-bar-text">Player Overview</div>
        <div class="title-bar-controls">
          <button aria-label="Minimize" onclick="toggleWindow(this)"></button>
          <button aria-label="Close" onclick="closeWindow(this)"></button>
        </div>
      </div>
      <div class="window-body">
        <div id="player-overview-container"></div>
      </div>
    </div>
    <div class="window main-window" data-window-id="sailing-progress" data-introduced-version="2">
      <div class="title-bar">
        <div class="title-bar-text">Sailing Progress</div>
        <div class="title-bar-controls">
          <button aria-label="Minimize" onclick="toggleWindow(this)"></button>
          <button aria-label="Close" onclick="closeWindow(this)"></button>
        </div>
      </div>
      <div class="window-body">
        <div id="sailing-progress-container"></div>
      </div>
    </div>
    <div class="window main-window" data-window-id="sea-charting-explorer" data-introduced-version="2">
      <div class="title-bar">
        <div class="title-bar-text">Sea Charting Explorer</div>
        <div class="title-bar-controls">
          <button aria-label="Minimize" onclick="toggleWindow(this)"></button>
          <button aria-label="Close" onclick="closeWindow(this)"></button>
        </div>
      </div>
      <div class="window-body">
        <div id="sea-charting-explorer-container"></div>
      </div>
    </div>
    <div class="window main-window" data-window-id="quest-progress">
      <div class="title-bar">
        <div class="title-bar-text">Quest Progress</div>
        <div class="title-bar-controls">
          <button aria-label="Minimize" onclick="toggleWindow(this)"></button>
          <button aria-label="Close" onclick="closeWindow(this)"></button>
        </div>
      </div>
      <div class="window-body">
        <div class="chart-frame">
          <canvas id="questChart"></canvas>
        </div>
      </div>
    </div>
    <div class="window main-window" data-window-id="total-level-progress">
      <div class="title-bar">
        <div class="title-bar-text">Total Level Progress</div>
        <div class="title-bar-controls">
          <button aria-label="Minimize" onclick="toggleWindow(this)"></button>
          <button aria-label="Close" onclick="closeWindow(this)"></button>
        </div>
      </div>
      <div class="window-body">
        <div class="chart-frame">
          <canvas id="totalLevelChart"></canvas>
        </div>
      </div>
    </div>
    <div class="window main-window" data-window-id="total-exp-progress">
      <div class="title-bar">
        <div class="title-bar-text">Total XP Progress</div>
        <div class="title-bar-controls">
          <button aria-label="Minimize" onclick="toggleWindow(this)"></button>
          <button aria-label="Close" onclick="closeWindow(this)"></button>
        </div>
      </div>
      <div class="window-body">
        <div class="chart-toolbar">
          <button id="btn-totalxp-scale">Log scale: On</button>
        </div>
        <div class="chart-frame">
          <canvas id="totalExpChart"></canvas>
        </div>
      </div>
    </div>
    <div class="window main-window" data-window-id="skill-level-progress">
      <div class="title-bar">
        <div class="title-bar-text">Skill Level Progress</div>
        <div class="title-bar-controls">
          <button aria-label="Minimize" onclick="toggleWindow(this)"></button>
          <button aria-label="Close" onclick="closeWindow(this)"></button>
        </div>
      </div>
      <div class="window-body">
        <div class="skill-control">
          <label for="skillSelect">Select Skill: </label>
          <select id="skillSelect" onchange="updateSkillChart()" style="margin-left: 10px; padding: 5px;">
            ${skillLevelProgressData.availableSkills.map(skill =>
      `<option value="${escapeHtml(skill)}" ${skill === defaultSkill ? 'selected' : ''}>${escapeHtml(skill)}</option>`
    ).join('')}
          </select>
        </div>
        <div class="chart-frame">
          <canvas id="skillLevelChart"></canvas>
        </div>
      </div>
    </div>
    <div class="window main-window" data-window-id="quest-comparison">
      <div class="title-bar">
        <div class="title-bar-text">Quest Comparison</div>
        <div class="title-bar-controls">
          <button aria-label="Minimize" onclick="toggleWindow(this)"></button>
          <button aria-label="Close" onclick="closeWindow(this)"></button>
        </div>
      </div>
      <div class="window-body">
        <div id="quest-table-container"></div>
      </div>
    </div>
    <div class="window main-window" data-window-id="level-comparison">
      <div class="title-bar">
        <div class="title-bar-text">Level Comparison</div>
        <div class="title-bar-controls">
          <button aria-label="Minimize" onclick="toggleWindow(this)"></button>
          <button aria-label="Close" onclick="closeWindow(this)"></button>
        </div>
      </div>
      <div class="window-body">
        <div id="level-table-container"></div>
      </div>
    </div>
    <div class="window main-window" data-window-id="achievement-diaries-comparison">
      <div class="title-bar">
        <div class="title-bar-text">Achievement Diaries Comparison</div>
        <div class="title-bar-controls">
          <button aria-label="Minimize" onclick="toggleWindow(this)"></button>
          <button aria-label="Close" onclick="closeWindow(this)"></button>
        </div>
      </div>
      <div class="window-body">
        <div id="diary-table-container"></div>
      </div>
    </div>
    <div class="window main-window" data-window-id="combat-achievements-comparison">
      <div class="title-bar">
        <div class="title-bar-text">Combat Achievements Comparison</div>
        <div class="title-bar-controls">
          <button aria-label="Minimize" onclick="toggleWindow(this)"></button>
          <button aria-label="Close" onclick="closeWindow(this)"></button>
        </div>
      </div>
      <div class="window-body">
        <div id="combat-achievements-table-container"></div>
      </div>
    </div>
    <div class="window main-window" data-window-id="music-tracks-comparison">
      <div class="title-bar">
        <div class="title-bar-text">Music Tracks Comparison</div>
        <div class="title-bar-controls">
          <button aria-label="Minimize" onclick="toggleWindow(this)"></button>
          <button aria-label="Close" onclick="closeWindow(this)"></button>
        </div>
      </div>
      <div class="window-body">
        <div id="music-tracks-table-container"></div>
      </div>
    </div>
    <div class="window main-window" data-window-id="collection-log-comparison">
      <div class="title-bar">
        <div class="title-bar-text">Collection Log Comparison</div>
        <div class="title-bar-controls">
          <button aria-label="Minimize" onclick="toggleWindow(this)"></button>
          <button aria-label="Close" onclick="closeWindow(this)"></button>
        </div>
      </div>
      <div class="window-body">
        <div id="collection-log-table-container"></div>
      </div>
    </div>
    <div class="window main-window" data-window-id="activities-comparison">
      <div class="title-bar">
        <div class="title-bar-text">Activities Comparison</div>
        <div class="title-bar-controls">
          <button aria-label="Minimize" onclick="toggleWindow(this)"></button>
          <button aria-label="Close" onclick="closeWindow(this)"></button>
        </div>
      </div>
      <div class="window-body">
        <div id="activities-table-container"></div>
      </div>
    </div>
    <div class="window main-window" data-window-id="recent-achievements--progress">
      <div class="title-bar">
        <div class="title-bar-text">Recent Achievements & Progress</div>
        <div class="title-bar-controls">
          <button aria-label="Minimize" onclick="toggleWindow(this)"></button>
          <button aria-label="Close" onclick="closeWindow(this)"></button>
        </div>
      </div>
      <div class="window-body">
        <div id="achievements-table-container"></div>
      </div>
    </div>
  </main>
  <script src="js/init.js"></script>
  <script src="js/app.js"></script>
</body>
</html>`;


    // Publish the HTML last so a fresh navigation only sees a complete generation.
    atomicWrite('public/index.html', htmlContent);
    console.log('Static HTML generated successfully at public/index.html');
    console.log(`Generated at: ${generatedAt}`);

  } catch (error) {
    console.error('Error generating static HTML:', error);
    throw error;
  }
}

const isMainModule = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  generateStaticHTML().catch(error => {
    console.error('Error in generateStaticHTML:', error);
    process.exitCode = 1;
  });
}
