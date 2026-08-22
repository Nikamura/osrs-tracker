import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateStaticHTML } from '../generate_static.js';

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data));
}

test('fresh generation works and includes Sailing-era progress', async () => {
  const previousDirectory = process.cwd();
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'osrs-tracker-test-'));

  try {
    process.chdir(temporaryDirectory);
    const quests = Array.from({ length: 200 }, (_, index) => ({
      name: index === 199 ? 'Fallen From Grace' : `Quest ${index}`,
      nameWikiLink: `https://oldschool.runescape.wiki/w/Quest_${index}`,
      isMiniquest: false
    }));
    const combatAchievements = Array.from({ length: 600 }, (_, index) => ({
      taskId: String(index), name: `Task ${index}`, tier: 'Easy (1 pt)'
    }));
    const collectionLog = Array.from({ length: 1_600 }, (_, index) => ({
      itemId: String(index + 1), itemName: `Item ${index + 1}`
    }));
    const musicTracks = Array.from({ length: 800 }, (_, index) => ({ name: `Track ${index}` }));
    musicTracks.push({ name: 'Wings of Madness', nameWikiLink: 'https://oldschool.runescape.wiki/w/Wings_of_Madness' });

    writeJson('game_data/quests.json', quests);
    writeJson('game_data/combat_achievements.json', combatAchievements);
    writeJson('game_data/collection_log.json', collectionLog);
    writeJson('game_data/music_tracks.json', musicTracks);

    // A metadata-only fresh deploy should render an explicit empty dashboard, not fail on player_data.
    await generateStaticHTML();
    const emptyDashboardHtml = readFileSync('public/index.html', 'utf8');
    assert.match(emptyDashboardHtml, /No players found/);
    assert.match(emptyDashboardHtml, /viewport-fit=cover/);
    assert.match(emptyDashboardHtml, /configuration-window/);
    assert.match(emptyDashboardHtml, /chart-frame/);

    const timestamp = '2026-08-22T10:00:00.000Z';
    const injectedSkillName = '"><img src=x onerror=alert(1)>';
    const snapshot = {
      quests: Object.fromEntries(quests.map(quest => [quest.name === 'Fallen From Grace' ? '.' : quest.name, 0])),
      levels: { Sailing: 42, Attack: 70, [injectedSkillName]: 1 },
      skills: [{ name: 'Overall', level: 112, xp: 1_000_000 }],
      activities: [{ name: 'Collections Logged', rank: 1, score: 12 }],
      achievement_diaries: {},
      combat_achievements: [],
      collection_log: [],
      music_tracks: { 'Track 0': true }
    };
    writeJson(`player_data/tester/tester_${timestamp}.json`, snapshot);

    await generateStaticHTML();
    assert.doesNotMatch(readFileSync('public/index.html', 'utf8'), /<img src=x onerror=alert\(1\)>/);
    const tableData = JSON.parse(readFileSync('public/data/table-data.json', 'utf8'));
    assert.equal(tableData.levels.playerLevels.tester.Sailing, 42);
    assert.equal(tableData.collectionLog.playerCollectionTotals.tester, 12);
    assert.ok(tableData.quests.quests.includes('Fallen From Grace'));
    assert.ok(tableData.musicTracks.musicTracks.includes('Wings of Madness'));

    const progressedTimestamp = '2026-08-22T10:15:00.000Z';
    const progressedSnapshot = structuredClone(snapshot);
    progressedSnapshot.quests['Quest 0'] = 2;
    progressedSnapshot.sea_charting = [1, 2, 3];
    progressedSnapshot.activities.push({ name: 'Mad Angel', rank: 1, score: 2 });
    writeJson(`player_data/tester/tester_${progressedTimestamp}.json`, progressedSnapshot);
    await generateStaticHTML();

    const progressedTableData = JSON.parse(readFileSync('public/data/table-data.json', 'utf8'));
    assert.equal(progressedTableData.activities.playerActivities.tester['Sea charting tasks'], 3);
    assert.equal(progressedTableData.achievements.filter(item => item.name === 'Quest 0').length, 1);
    assert.equal(progressedTableData.achievements.filter(item => item.type === 'sea_charting').length, 0);
    assert.equal(progressedTableData.achievements.filter(item => item.name.includes('Mad Angel')).length, 0);

    // A cleanup can remove the file named in the incremental cache. Rebuilding
    // from the remaining history must not duplicate already cached achievements.
    const duplicateTimestamp = '2026-08-22T10:30:00.000Z';
    const duplicatePath = `player_data/tester/tester_${duplicateTimestamp}.json`;
    writeJson(duplicatePath, progressedSnapshot);
    await generateStaticHTML();
    rmSync(duplicatePath);
    await generateStaticHTML();
    const rebuiltTableData = JSON.parse(readFileSync('public/data/table-data.json', 'utf8'));
    assert.equal(rebuiltTableData.achievements.filter(item => item.name === 'Quest 0').length, 1);
  } finally {
    process.chdir(previousDirectory);
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
