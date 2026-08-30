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
import { JSDOM } from 'jsdom';
import {
  generateStaticHTML,
  getPlayerOverviewData,
  getSailingProgressData,
  SITE_METADATA
} from '../generate_static.js';

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data));
}

function seaChartingTasks(count = 358) {
  return Array.from({ length: count }, (_, taskId) => {
    const isArdent = taskId < 3;
    const ocean = isArdent ? 'Ardent Ocean' : 'Northern Ocean';
    const sea = isArdent ? 'Bay of Sarim' : 'Test Northern Sea';
    return {
      taskId,
      level: isArdent ? 1 : 78,
      type: taskId === 2 ? 'Spyglass' : 'Generic',
      task: `Charting task ${taskId}`,
      sea,
      seaWikiLink: `https://oldschool.runescape.wiki/w/${sea.replaceAll(' ', '_')}`,
      ocean,
      oceanWikiLink: `https://oldschool.runescape.wiki/w/${ocean.replaceAll(' ', '_')}`,
      completionGroup: ocean,
      isBonusChart: taskId === 2,
      location: [3000 + taskId, 3200],
      secondaryLocation: null,
      hazard: null
    };
  });
}

test('player overview stays general while Sailing progress distinguishes live data states', () => {
  const tasks = seaChartingTasks(4);
  const playerDataMap = {
    alpha: {
      latestFile: 'alpha_2026-08-22T10:15:00.000Z.json',
      latestData: {
        quests: { 'Quest 0': 2, 'Fallen From Grace': 1, 'Unknown Quest': 2 },
        levels: { Sailing: 62, Attack: 99 },
        skills: [{ name: 'Overall', xp: 1_234_567 }],
        activities: [{ name: 'Collections Logged', score: 9 }],
        collection_log: [10, 11],
        combat_achievements: [5, 5, 6],
        sea_charting: [3, 1, 1, 999]
      }
    },
    beta: {
      latestFile: 'beta_2026-08-22T10:00:00.000Z.json',
      latestData: {
        quests: { 'Quest 0': 0 },
        levels: { Sailing: 1 },
        skills: [{ name: 'Overall', xp: 0 }],
        activities: [],
        collection_log: [],
        combat_achievements: []
      }
    }
  };
  const gameData = {
    knownQuestNames: new Set(['Quest 0', 'Fallen From Grace']),
    combatAchievements: { 5: {}, 6: {}, 7: {} },
    seaChartingTasks: tasks
  };

  const overview = getPlayerOverviewData(playerDataMap, gameData);
  assert.deepEqual(overview.players, ['alpha', 'beta']);
  assert.deepEqual(overview.totals, {
    quests: 2,
    combatAchievements: 3
  });
  assert.deepEqual(overview.playerStats.alpha, {
    snapshotAt: '2026-08-22T10:15:00.000Z',
    totalLevel: 161,
    totalExperience: 1_234_567,
    completedQuests: 1,
    maxedSkills: 1,
    collectionLog: 9,
    combatAchievements: 2
  });
  assert.equal(overview.playerStats.beta.maxedSkills, 0);

  const sailing = getSailingProgressData(playerDataMap, tasks);
  assert.equal(sailing.totalTasks, 4);
  assert.deepEqual(sailing.players, ['alpha', 'beta']);
  assert.deepEqual(sailing.playerProgress.alpha.completedTaskIds, [1, 3]);
  assert.deepEqual(sailing.playerProgress.alpha.unknownTaskIds, [999]);
  assert.equal(sailing.playerProgress.alpha.available, true);
  assert.equal(sailing.playerProgress.beta.available, false);
  assert.deepEqual(
    sailing.completionGroups.map(group => ({ name: group.name, taskIds: group.taskIds })),
    [
      { name: 'Ardent Ocean', taskIds: [0, 1, 2] },
      { name: 'Northern Ocean', taskIds: [3] }
    ]
  );
  assert.equal(sailing.tasks.length, 4);
  assert.equal(sailing.tasks[2].isBonusChart, true);
});

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
    writeJson('game_data/sea_charting.json', seaChartingTasks());

    // A metadata-only fresh deploy should render an explicit empty dashboard, not fail on player_data.
    await generateStaticHTML();
    const emptyDashboardHtml = readFileSync('public/index.html', 'utf8');
    assert.match(emptyDashboardHtml, /No players found/);
    assert.match(emptyDashboardHtml, /viewport-fit=cover/);
    assert.match(emptyDashboardHtml, /configuration-window/);
    assert.match(emptyDashboardHtml, /chart-frame/);

    const emptyDashboardDocument = new JSDOM(emptyDashboardHtml).window.document;
    assert.equal(emptyDashboardDocument.documentElement.lang, 'en');
    assert.equal(emptyDashboardDocument.title, SITE_METADATA.title);
    assert.equal(
      emptyDashboardDocument.querySelector('meta[name="description"]')?.content,
      SITE_METADATA.description
    );
    assert.equal(
      emptyDashboardDocument.querySelector('link[rel="canonical"]')?.href,
      SITE_METADATA.canonicalUrl
    );
    assert.equal(
      emptyDashboardDocument.querySelector('meta[property="og:image"]')?.content,
      SITE_METADATA.socialImageUrl
    );
    assert.equal(
      emptyDashboardDocument.querySelector('meta[property="og:image:alt"]')?.content,
      SITE_METADATA.socialImageAlt
    );
    assert.equal(
      emptyDashboardDocument.querySelector('meta[name="twitter:card"]')?.content,
      'summary_large_image'
    );
    assert.equal(
      emptyDashboardDocument.querySelector('meta[name="twitter:image"]')?.content,
      SITE_METADATA.socialImageUrl
    );
    assert.equal(
      emptyDashboardDocument.querySelector('meta[name="robots"]')?.content,
      'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1'
    );
    assert.equal(emptyDashboardDocument.querySelector('link[rel="manifest"]')?.href, '/site.webmanifest');
    assert.equal(emptyDashboardDocument.querySelector('link[rel="apple-touch-icon"]')?.href, '/apple-touch-icon.png');
    assert.ok(emptyDashboardDocument.querySelector('link[rel="icon"][href="/favicon.svg"]'));
    assert.equal(emptyDashboardDocument.querySelector('h1')?.textContent, SITE_METADATA.name);
    assert.doesNotMatch(SITE_METADATA.title, /Sailing/);
    assert.doesNotMatch(SITE_METADATA.description, /Sailing/);
    assert.doesNotMatch(emptyDashboardDocument.querySelector('.site-intro-copy')?.textContent || '', /Sailing/);
    assert.ok(emptyDashboardDocument.querySelector('main.container'));
    assert.match(
      emptyDashboardDocument.querySelector('.site-attribution')?.textContent || '',
      /This content is not endorsed by or affiliated with Jagex\./
    );
    assert.equal(emptyDashboardDocument.querySelector('meta[name="keywords"]'), null);
    const structuredData = JSON.parse(
      emptyDashboardDocument.querySelector('script[type="application/ld+json"]')?.textContent || '{}'
    );
    assert.equal(structuredData['@type'], 'WebSite');
    assert.equal(structuredData.url, SITE_METADATA.canonicalUrl);
    assert.equal(structuredData.name, SITE_METADATA.name);
    assert.equal(emptyDashboardDocument.body.dataset.windowCatalogVersion, '3');
    for (const windowId of ['player-overview', 'sailing-progress', 'sea-charting-explorer']) {
      const checkbox = emptyDashboardDocument.querySelector(`#window-${windowId}`);
      const windowElement = emptyDashboardDocument.querySelector(`[data-window-id="${windowId}"]`);
      assert.ok(checkbox, `${windowId} visibility control should exist`);
      assert.equal(checkbox.dataset.introducedVersion, '2');
      assert.equal(checkbox.checked, windowId === 'player-overview');
      assert.ok(windowElement, `${windowId} window should exist`);
      assert.equal(windowElement.dataset.introducedVersion, '2');
    }
    assert.ok(emptyDashboardDocument.querySelector('#player-overview-container'));
    assert.ok(emptyDashboardDocument.querySelector('#sailing-progress-container'));
    assert.ok(emptyDashboardDocument.querySelector('#sea-charting-explorer-container'));
    const windowIds = [...emptyDashboardDocument.querySelectorAll('.window[data-window-id]')]
      .map(windowElement => windowElement.dataset.windowId);
    assert.deepEqual(windowIds.slice(-2), ['sailing-progress', 'sea-charting-explorer']);

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
    assert.equal(progressedTableData.playerOverview.playerStats.tester.maxedSkills, 0);
    assert.equal(progressedTableData.sailing.totalTasks, 358);
    assert.deepEqual(progressedTableData.sailing.playerProgress.tester.completedTaskIds, [1, 2, 3]);
    assert.deepEqual(progressedTableData.sailing.playerProgress.tester.unknownTaskIds, []);
    assert.equal(progressedTableData.sailing.playerProgress.tester.snapshotAt, progressedTimestamp);
    assert.equal(progressedTableData.sailing.tasks.length, 358);
    assert.deepEqual(
      progressedTableData.sailing.completionGroups.find(group => group.name === 'Ardent Ocean').taskIds,
      [0, 1, 2]
    );
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
