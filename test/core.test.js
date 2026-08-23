import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanupPlayerData, normalizePlayerProgress } from '../cleanup_player_data.js';
import { validateHighscoreData, validateWikiSyncData } from '../data_fetcher.js';
import {
  normalizeCollectionLogItems,
  normalizeQuestName,
  normalizeQuestStatuses,
  parseSnapshotTimestamp
} from '../generate_static.js';

function completeWikiSyncPayload() {
  return {
    quests: Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`Quest ${index}`, index % 3])),
    levels: Object.fromEntries([
      'Attack', 'Defence', 'Strength', 'Hitpoints', 'Ranged', 'Prayer', 'Magic',
      'Cooking', 'Woodcutting', 'Fletching', 'Fishing', 'Firemaking', 'Crafting',
      'Smithing', 'Mining', 'Herblore', 'Agility', 'Thieving', 'Slayer', 'Farming',
      'Runecraft', 'Hunter', 'Construction', 'Sailing'
    ].map(name => [name, 1])),
    music_tracks: Object.fromEntries(Array.from({ length: 800 }, (_, index) => [`Track ${index}`, false])),
    combat_achievements: [],
    collection_log: [],
    sea_charting: []
  };
}

function completeHighscorePayload() {
  const skillNames = [
    'Overall', 'Attack', 'Defence', 'Strength', 'Hitpoints', 'Ranged', 'Prayer',
    'Magic', 'Cooking', 'Woodcutting', 'Fletching', 'Fishing', 'Firemaking',
    'Crafting', 'Smithing', 'Mining', 'Herblore', 'Agility', 'Thieving', 'Slayer',
    'Farming', 'Runecraft', 'Hunter', 'Construction', 'Sailing'
  ];
  return {
    skills: skillNames.map(name => ({ name, level: 1, xp: 0 })),
    activities: Array.from({ length: 91 }, (_, index) => ({
      name: index === 0 ? 'Collections Logged' : `Activity ${index}`,
      score: -1
    }))
  };
}

test('temporary WikiSync quest alias reconciles Fallen From Grace', () => {
  assert.equal(normalizeQuestName('.'), 'Fallen From Grace');
  assert.deepEqual(normalizeQuestStatuses({ '.': 1, 'Fallen From Grace': 2 }), {
    'Fallen From Grace': 2
  });
});

test('collection log recolours normalize to canonical Prospector IDs', () => {
  assert.deepEqual(
    normalizeCollectionLogItems([29472, 29474, 29476, 29478, 12013]),
    [12013, 12014, 12015, 12016]
  );
});

test('snapshot comparison ignores rank churn but preserves score and XP changes', () => {
  const first = {
    timestamp: 'old',
    skills: [{ name: 'Sailing', rank: 100, level: 50, xp: 100_000 }],
    activities: [{ name: 'Mad Angel', rank: 100, score: 2 }],
    sea_charting: [2, 1]
  };
  const rankOnlyChange = {
    ...first,
    timestamp: 'new',
    skills: [{ ...first.skills[0], rank: 200 }],
    activities: [{ ...first.activities[0], rank: 200 }],
    sea_charting: [1, 2]
  };
  assert.deepEqual(normalizePlayerProgress(first), normalizePlayerProgress(rankOnlyChange));

  const progressChange = {
    ...rankOnlyChange,
    activities: [{ ...rankOnlyChange.activities[0], score: 3 }]
  };
  assert.notDeepEqual(normalizePlayerProgress(first), normalizePlayerProgress(progressChange));
});

test('cleanup compresses unchanged runs while retaining their newest chart endpoint', () => {
  const playerDataDir = mkdtempSync(path.join(os.tmpdir(), 'osrs-cleanup-test-'));
  const playerDirectory = path.join(playerDataDir, 'inactive-player');
  mkdirSync(playerDirectory);

  const writeSnapshot = timestamp => {
    const filename = `inactive-player_${timestamp}.json`;
    writeFileSync(path.join(playerDirectory, filename), JSON.stringify({
      timestamp,
      skills: [{ name: 'Overall', rank: 100, level: 100, xp: 1_000_000 }]
    }));
    return filename;
  };

  try {
    const timestamps = [
      '2026-08-19T12:00:00.000Z',
      '2026-08-20T12:00:00.000Z',
      '2026-08-21T12:00:00.000Z',
      '2026-08-22T12:00:00.000Z'
    ];
    const filenames = timestamps.map(writeSnapshot);

    const firstCleanup = cleanupPlayerData({ playerDataDir });
    assert.equal(firstCleanup.deletedCount, 2);
    assert.deepEqual(readdirSync(playerDirectory).sort(), [filenames[0], filenames[3]]);

    const newestFilename = writeSnapshot('2026-08-23T12:00:00.000Z');
    const secondCleanup = cleanupPlayerData({ playerDataDir });
    assert.equal(secondCleanup.deletedCount, 1);
    assert.deepEqual(readdirSync(playerDirectory).sort(), [filenames[0], newestFilename]);
  } finally {
    rmSync(playerDataDir, { recursive: true, force: true });
  }
});

test('live payload validators reject incomplete responses', () => {
  const wikiSync = completeWikiSyncPayload();
  assert.equal(validateWikiSyncData(wikiSync, 'player'), wikiSync);
  assert.throws(() => validateWikiSyncData({ levels: {} }, 'player'), /missing quests/);
  assert.throws(
    () => validateWikiSyncData({ ...wikiSync, levels: { ...wikiSync.levels, Sailing: 0 } }, 'player'),
    /invalid skill levels/
  );

  const highscores = completeHighscorePayload();
  assert.equal(validateHighscoreData(highscores, 'player'), highscores);
  assert.throws(() => validateHighscoreData({ skills: [], activities: [] }, 'player'), /Overall/);
  assert.throws(
    () => validateHighscoreData({ ...highscores, skills: highscores.skills.filter(skill => skill.name !== 'Sailing') }, 'player'),
    /invalid skills/
  );
});

test('snapshot timestamps are parsed from the suffix even when a player name contains underscores', () => {
  assert.equal(
    parseSnapshotTimestamp('player_with_underscores_2026-08-22T10:00:00.000Z.json').toISOString(),
    '2026-08-22T10:00:00.000Z'
  );
});
