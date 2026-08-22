import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { parseCombatAchievements } from '../fetch_combat_achievements.js';
import { parseCollectionLog } from '../fetch_collection_log.js';
import { parseMusicTracks } from '../fetch_music_tracks.js';
import { parseQuests } from '../fetch_quests.js';
import { normalizeSeaChartingTasks } from '../fetch_sea_charting.js';

function documentFrom(html) {
  return new JSDOM(html).window.document;
}

function questRows(prefix, count, withQuestPoints) {
  return Array.from({ length: count }, (_, index) => `
    <tr>
      ${withQuestPoints ? `<td>${index + 1}</td>` : ''}
      <td><a href="/w/${prefix}_${index + 1}">${prefix} ${index + 1}</a></td>
      <td>Novice</td><td>Short</td>
      ${withQuestPoints ? '<td>1</td>' : ''}
      <td>N/A</td><td>1 January 2026</td>
    </tr>`).join('');
}

function questTable(prefix, count, withQuestPoints = true) {
  const numberHeader = withQuestPoints ? '<th>#</th>' : '';
  const pointsHeader = withQuestPoints
    ? '<th><span data-skill="Quest points"><a title="Quest points"></a></span></th>'
    : '';
  return `<table class="wikitable oqg-table"><tr>${numberHeader}<th>Name</th><th>Difficulty</th><th>Length</th>${pointsHeader}<th>Series</th><th>Release date</th></tr>${questRows(prefix, count, withQuestPoints)}</table>`;
}

test('music parser follows current header names and column order', () => {
  const document = documentFrom(`
    <table class="wikitable music-tracks">
      <tr><th>Name</th><th>Unlock details</th><th>Length</th><th>P2P</th><th>Release</th><th>Music track</th></tr>
      <tr>
        <td><a href="/w/High_Seas">High Seas</a></td>
        <td>Unlocked while sailing.</td><td>03:45</td>
        <td><span>1</span><a title="Members"><img></a></td><td>19 November 2025</td>
        <td><a href="/w/File:High_Seas.ogg">Play Track</a></td>
      </tr>
    </table>`);

  const tracks = parseMusicTracks(document);
  assert.equal(tracks.length, 1);
  assert.deepEqual(
    {
      name: tracks[0].name,
      duration: tracks[0].duration,
      members: tracks[0].members,
      releaseDate: tracks[0].releaseDate
    },
    { name: 'High Seas', duration: '03:45', members: true, releaseDate: '19 November 2025' }
  );
});

test('quest parser traverses wrapped headings and current tables', () => {
  const document = documentFrom(`
    <div class="mw-heading"><h2 id="Free-to-play_quests">Free-to-play quests</h2></div>
    <p>Intro</p>${questTable('Free', 20)}
    <div class="mw-heading"><h2 id="Members'_quests">Members' quests</h2></div>
    ${questTable('Member', 100)}
    <div class="mw-heading"><h2 id="Miniquests">Miniquests</h2></div>
    ${questTable('Mini', 10, false)}
    <div class="mw-heading"><h2 id="See_also">See also</h2></div>`);

  const { quests, counts } = parseQuests(document);
  assert.deepEqual(counts, { freeToPlay: 20, members: 100, miniquests: 10 });
  assert.equal(quests.length, 130);
  assert.equal(quests[0].questPoints, 1);
  assert.equal(quests.at(-1).isMiniquest, true);
});

test('combat parser uses the semantic table and normalizes non-breaking spaces', () => {
  const document = documentFrom(`
    <table class="wikitable ca-tasks">
      <tr><th>Monster</th><th>Name</th><th>Description</th><th>Type</th><th>Tier</th></tr>
      <tr data-ca-task-id="645">
        <td><a href="/w/Maggot_King">Maggot King</a></td>
        <td><a href="/w/Test">Test Task</a></td><td>Do the thing.</td><td>Mechanical</td>
        <td><img src="/images/tier.png">Master&nbsp;(5&nbsp;pts)</td>
      </tr>
    </table>`);

  const achievements = parseCombatAchievements(document);
  assert.equal(achievements[0].taskId, '645');
  assert.equal(achievements[0].tier, 'Master (5 pts)');
});

test('collection parser uses stable IDs and semantic table class', () => {
  const document = documentFrom(`
    <table class="wikitable collection-log">
      <tr><th>Item</th><th>Collections</th><th>Comp%</th></tr>
      <tr data-item-id="34027">
        <td><a href="/w/File:Angel.png"><img src="/images/Angel.png"></a><a href="/w/Angel">Angel item</a></td>
        <td><a href="/w/Mad_Angel">Mad Angel</a></td><td>1%</td>
      </tr>
    </table>`);

  const items = parseCollectionLog(document);
  assert.equal(items[0].itemId, '34027');
  assert.equal(items[0].itemName, 'Angel item');
  assert.equal(items[0].collection, 'Mad Angel');
});

test('sea charting normalizer maps Wiki bucket rows to stable completion metadata', () => {
  const tasks = normalizeSeaChartingTasks({
    bucket: [
      {
        id: 0,
        description: 'Find a [[Crashed glider (Sea charting)|crashed glider]] south of the [[Karamja]] Shipyard.',
        level: 1,
        type: 'Generic',
        sea: 'Bay of Sarim',
        ocean: 'Ardent Ocean',
        location: '2987,3010',
      },
      {
        id: 2,
        description: "Use your [[spyglass]] to get a good view of the [[Wizards' Tower]] from the north.",
        level: 1,
        type: 'Spyglass',
        sea: 'Bay of Sarim',
        ocean: 'Bonus charts',
        location: '3104,3181'
      },
      {
        id: 300,
        description: 'Help the meteorologist document a small island<sup class="noprint">&#91;<span title="verbatim">sic</span>&#93;</sup> and a [[storm]].',
        level: 57,
        type: 'Weather',
        sea: 'Bay of Sarim',
        ocean: 'Bonus charts',
        location: '3000,3200',
        location2: '3001,3201',
        hazard: 'Stormy seas'
      }
    ]
  });

  assert.equal(tasks.length, 3);
  assert.deepEqual(
    {
      taskId: tasks[0].taskId,
      task: tasks[0].task,
      location: tasks[0].location,
      seaWikiLink: tasks[0].seaWikiLink,
      oceanWikiLink: tasks[0].oceanWikiLink,
      completionGroup: tasks[0].completionGroup
    },
    {
      taskId: 0,
      task: 'Find a crashed glider south of the Karamja Shipyard.',
      location: [2987, 3010],
      seaWikiLink: 'https://oldschool.runescape.wiki/w/Bay_of_Sarim',
      oceanWikiLink: 'https://oldschool.runescape.wiki/w/Ardent_Ocean',
      completionGroup: 'Ardent Ocean'
    }
  );

  // Task 2 is marked as a bonus chart upstream, but belongs to Ardent Ocean
  // completion. Other bonus-chart tasks form the Miscellaneous group.
  assert.equal(tasks[1].ocean, 'Ardent Ocean');
  assert.equal(tasks[1].completionGroup, 'Ardent Ocean');
  assert.equal(tasks[1].isBonusChart, true);
  assert.equal(tasks[2].completionGroup, 'Miscellaneous');
  assert.equal(tasks[2].isBonusChart, true);
  assert.equal(tasks[2].task, 'Help the meteorologist document a small island[sic] and a storm.');
  assert.deepEqual(tasks[2].secondaryLocation, [3001, 3201]);
  assert.equal(tasks[2].hazard, 'Stormy seas');
});

test('sea charting normalizer rejects malformed and duplicate task data', () => {
  assert.throws(
    () => normalizeSeaChartingTasks({ missing: [] }),
    /no bucket rows/
  );
  assert.throws(
    () => normalizeSeaChartingTasks([
      { id: 1, description: 'First', level: 1, type: 'Generic', sea: 'Test Sea', ocean: 'Test Ocean' },
      { id: 1, description: 'Second', level: 1, type: 'Generic', sea: 'Test Sea', ocean: 'Test Ocean' }
    ]),
    /duplicate task IDs/
  );
});
