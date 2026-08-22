#!/usr/bin/env node

import {
  existsSync,
  readdirSync,
  readFileSync,
  unlinkSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const PLAYER_DATA_DIR = path.join(moduleDirectory, 'player_data');

function parseTimestampFromFilename(filename) {
  const match = filename.match(/_(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\.json$/);
  return match ? new Date(match[1]) : null;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonicalize(value[key])])
    );
  }
  return value;
}

export function normalizePlayerProgress(data) {
  const sortByName = (left, right) => String(left.name).localeCompare(String(right.name));
  const sortValues = (values) => [...new Set(values || [])].sort((left, right) =>
    String(left).localeCompare(String(right), undefined, { numeric: true })
  );

  return canonicalize({
    quests: data.quests || {},
    achievementDiaries: data.achievement_diaries || {},
    levels: data.levels || {},
    musicTracks: data.music_tracks || {},
    combatAchievements: sortValues(data.combat_achievements),
    collectionLog: sortValues(data.collection_log),
    leagueTasks: sortValues(data.league_tasks),
    bingoTasks: sortValues(data.bingo_tasks),
    seaCharting: sortValues(data.sea_charting),
    skills: (data.skills || []).map(skill => ({
      name: skill.name,
      level: skill.level,
      xp: skill.xp
    })).sort(sortByName),
    activities: (data.activities || []).map(activity => ({
      name: activity.name,
      score: activity.score
    })).sort(sortByName)
  });
}

function loadProgress(filePath) {
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    return JSON.stringify(normalizePlayerProgress(data));
  } catch (error) {
    console.error(`Keeping unreadable snapshot ${filePath}: ${error.message}`);
    return null;
  }
}

function getPlayerDirectories() {
  if (!existsSync(PLAYER_DATA_DIR)) return [];
  return readdirSync(PLAYER_DATA_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort();
}

function getPlayerFiles(playerName) {
  const playerDirectory = path.join(PLAYER_DATA_DIR, playerName);
  return readdirSync(playerDirectory)
    .filter(filename => filename.endsWith('.json'))
    .map(filename => ({
      filename,
      timestamp: parseTimestampFromFilename(filename),
      filePath: path.join(playerDirectory, filename)
    }))
    .filter(file => file.timestamp)
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
}

export function findDuplicateSnapshots() {
  const duplicates = [];

  for (const player of getPlayerDirectories()) {
    let previousProgress = null;
    for (const file of getPlayerFiles(player)) {
      const progress = loadProgress(file.filePath);
      if (progress === null) {
        previousProgress = null;
        continue;
      }

      if (previousProgress === progress) {
        duplicates.push({ player, ...file });
      } else {
        previousProgress = progress;
      }
    }
  }

  return duplicates;
}

export function cleanupPlayerData({ dryRun = false } = {}) {
  const players = getPlayerDirectories();
  if (players.length === 0) {
    console.log('No player snapshots found. Nothing to clean up.');
    return { deletedCount: 0, duplicateCount: 0 };
  }

  const duplicates = findDuplicateSnapshots();
  if (duplicates.length === 0) {
    console.log('No consecutive duplicate player snapshots found.');
    return { deletedCount: 0, duplicateCount: 0 };
  }

  let deletedCount = 0;
  for (const duplicate of duplicates) {
    if (dryRun) {
      console.log(`[dry run] ${duplicate.player}: ${duplicate.filename}`);
      continue;
    }

    unlinkSync(duplicate.filePath);
    deletedCount++;
  }

  const action = dryRun ? 'Would delete' : 'Deleted';
  console.log(`${action} ${dryRun ? duplicates.length : deletedCount} duplicate snapshots across ${players.length} players.`);
  return { deletedCount, duplicateCount: duplicates.length };
}

const isMainModule = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  try {
    cleanupPlayerData({ dryRun: process.argv.includes('--dry-run') });
  } catch (error) {
    console.error('Player data cleanup failed:', error);
    process.exitCode = 1;
  }
}
