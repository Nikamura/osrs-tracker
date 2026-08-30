import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const appSource = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const initSource = readFileSync(new URL('../public/js/init.js', import.meta.url), 'utf8');
const appWithoutBoot = appSource.replace(
  /\nif \(document\.readyState === 'loading'\) \{[\s\S]*$/,
  ''
);

function createClient(html) {
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://tracker.test/'
  });
  dom.window.eval(`${appWithoutBoot}
    window.__clientTest = {
      loadWindowOrder,
      loadWindowVisibility,
      renderPlayerOverview,
      renderSailingProgress,
      renderSeaChartingExplorer,
      setSailingExplorerPlayer,
      setSailingExplorerGroup,
      setSailingExplorerStatus,
      setData(value) {
        tableData = value;
        playerToDisplay = {};
        playerColors = {};
      }
    };
  `);
  return dom;
}

function windowMarkup(id, title, introducedVersion = 1) {
  const dataId = id === 'configuration' ? '' : ` data-window-id="${id}"`;
  const introduced = introducedVersion > 1 ? ` data-introduced-version="${introducedVersion}"` : '';
  return `<div class="window"${dataId}${introduced}><div class="title-bar-text">${title}</div></div>`;
}

test('visibility state tolerates corruption and rebalances Sailing windows once', () => {
  const dom = createClient(`
    <body data-window-catalog-version="3">
      <input type="checkbox" id="window-player-overview" value="player-overview" data-introduced-version="2" checked>
      <input type="checkbox" id="window-sailing-progress" value="sailing-progress" data-introduced-version="2">
      <input type="checkbox" id="window-sea-charting-explorer" value="sea-charting-explorer" data-introduced-version="2">
      <input type="checkbox" id="window-quest-progress" value="quest-progress" data-introduced-version="1" checked>
      <div class="container">
        ${windowMarkup('configuration', 'Configuration')}
        ${windowMarkup('player-overview', 'Player Overview', 2)}
        ${windowMarkup('sailing-progress', 'Sailing Progress', 2)}
        ${windowMarkup('sea-charting-explorer', 'Sea Charting Explorer', 2)}
        ${windowMarkup('quest-progress', 'Quest Progress')}
      </div>
    </body>`);
  const { localStorage, document } = dom.window;
  const client = dom.window.__clientTest;

  for (const malformed of ['{', '{}']) {
    localStorage.setItem('osrs-selected-windows', malformed);
    assert.doesNotThrow(() => client.loadWindowVisibility());
    assert.equal(document.querySelector('#window-player-overview').checked, true);
    assert.equal(document.querySelector('#window-sailing-progress').checked, false);
    assert.equal(document.querySelector('#window-sea-charting-explorer').checked, false);
  }

  localStorage.setItem('osrs-window-catalog-version', '2');
  localStorage.setItem('osrs-selected-windows', JSON.stringify([
    'player-overview', 'sailing-progress', 'sea-charting-explorer', 'quest-progress'
  ]));
  client.loadWindowVisibility();
  assert.equal(document.querySelector('#window-player-overview').checked, true);
  assert.equal(document.querySelector('#window-sailing-progress').checked, false);
  assert.equal(document.querySelector('#window-sea-charting-explorer').checked, false);
  assert.equal(document.querySelector('#window-quest-progress').checked, true);
  assert.equal(localStorage.getItem('osrs-window-catalog-version'), '3');
});

test('early initialization hides Sailing windows before the version 3 app boot', () => {
  const dom = new JSDOM(`
    <body data-window-catalog-version="3">
      <div class="window" data-window-id="player-overview"></div>
      <div class="window" data-window-id="sailing-progress" data-introduced-version="2"></div>
      <div class="window" data-window-id="sea-charting-explorer" data-introduced-version="2"></div>
    </body>`, {
    runScripts: 'outside-only',
    url: 'https://tracker.test/'
  });
  dom.window.localStorage.setItem('osrs-window-catalog-version', '2');
  dom.window.localStorage.setItem('osrs-selected-windows', JSON.stringify([
    'player-overview', 'sailing-progress', 'sea-charting-explorer'
  ]));

  dom.window.eval(initSource);

  assert.equal(dom.window.document.querySelector('[data-window-id="player-overview"]').classList.contains('hidden'), false);
  assert.equal(dom.window.document.querySelector('[data-window-id="sailing-progress"]').classList.contains('hidden'), true);
  assert.equal(dom.window.document.querySelector('[data-window-id="sea-charting-explorer"]').classList.contains('hidden'), true);
  assert.deepEqual(JSON.parse(dom.window.localStorage.getItem('osrs-selected-windows')), ['player-overview']);
});

test('first-visit defaults hide optional Sailing windows before app boot', () => {
  const dom = new JSDOM(`
    <body data-window-catalog-version="3">
      <input type="checkbox" id="window-player-overview" value="player-overview" checked>
      <input type="checkbox" id="window-sailing-progress" value="sailing-progress">
      <input type="checkbox" id="window-sea-charting-explorer" value="sea-charting-explorer">
      <div class="window" data-window-id="player-overview"></div>
      <div class="window" data-window-id="sailing-progress"></div>
      <div class="window" data-window-id="sea-charting-explorer"></div>
    </body>`, {
    runScripts: 'outside-only',
    url: 'https://tracker.test/'
  });

  dom.window.eval(initSource);

  assert.equal(dom.window.document.querySelector('[data-window-id="player-overview"]').classList.contains('hidden'), false);
  assert.equal(dom.window.document.querySelector('[data-window-id="sailing-progress"]').classList.contains('hidden'), true);
  assert.equal(dom.window.document.querySelector('[data-window-id="sea-charting-explorer"]').classList.contains('hidden'), true);
});

test('version 3 window order moves Sailing tools behind the general tracker', () => {
  const dom = createClient(`
    <body data-window-catalog-version="3">
      <div class="container">
        ${windowMarkup('configuration', 'Configuration')}
        ${windowMarkup('player-overview', 'Player Overview', 2)}
        ${windowMarkup('sailing-progress', 'Sailing Progress', 2)}
        ${windowMarkup('sea-charting-explorer', 'Sea Charting Explorer', 2)}
        ${windowMarkup('quest-progress', 'Quest Progress')}
      </div>
    </body>`);
  const { localStorage, document } = dom.window;
  localStorage.setItem('osrs-window-catalog-version', '2');
  localStorage.setItem('osrs-window-order', JSON.stringify([
    'configuration', 'player-overview', 'sailing-progress', 'sea-charting-explorer', 'quest-progress'
  ]));

  dom.window.__clientTest.loadWindowOrder();
  const order = [...document.querySelectorAll('.container > .window')]
    .map(element => element.querySelector('.title-bar-text').textContent);
  assert.deepEqual(order, ['Configuration', 'Player Overview', 'Quest Progress', 'Sailing Progress', 'Sea Charting Explorer']);
  assert.deepEqual(JSON.parse(localStorage.getItem('osrs-window-order')), [
    'configuration',
    'player-overview',
    'quest-progress',
    'sailing-progress',
    'sea-charting-explorer'
  ]);
});

test('player overview uses general account metrics instead of spotlighting Sailing', () => {
  const dom = createClient(`
    <body>
      <input type="checkbox" id="player-alpha" value="alpha" checked>
      <div id="player-overview-container"></div>
    </body>`);
  const client = dom.window.__clientTest;
  client.setData({
    playerOverview: {
      players: ['alpha'],
      totals: { quests: 211, combatAchievements: 655 },
      playerStats: {
        alpha: {
          snapshotAt: '2026-08-30T10:00:00.000Z',
          totalLevel: 2000,
          totalExperience: 100_000_000,
          completedQuests: 200,
          maxedSkills: 5,
          collectionLog: 300,
          combatAchievements: 100
        }
      }
    }
  });

  client.renderPlayerOverview(['alpha']);

  const overviewText = dom.window.document.querySelector('#player-overview-container').textContent;
  assert.match(overviewText, /Level 99s/);
  assert.doesNotMatch(overviewText, /Sailing/);
});

test('Sailing filters retain focus and collapse completion groups by default', () => {
  const dom = createClient(`
    <body>
      <input type="checkbox" id="player-alpha" value="alpha" checked>
      <input type="checkbox" id="player-beta" value="beta" checked>
      <div id="sailing-progress-container"></div>
      <div id="sea-charting-explorer-container"></div>
    </body>`);
  const groups = ['Ardent Ocean', 'Unquiet Ocean', 'Shrouded Ocean', 'Western Ocean', 'Northern Ocean', 'Sunset Ocean', 'Miscellaneous'];
  const tasks = groups.map((completionGroup, taskId) => ({
    taskId,
    level: 1,
    type: 'Generic',
    task: `Task ${taskId}`,
    sea: `Sea ${taskId}`,
    seaWikiLink: `https://oldschool.runescape.wiki/w/Sea_${taskId}`,
    ocean: completionGroup === 'Miscellaneous' ? 'Ardent Ocean' : completionGroup,
    oceanWikiLink: 'https://oldschool.runescape.wiki/w/Ardent_Ocean',
    completionGroup,
    isBonusChart: completionGroup === 'Miscellaneous',
    hazard: null
  }));
  const playerProgress = Object.fromEntries(['alpha', 'beta'].map(player => [player, {
    available: true,
    sailingLevel: player === 'alpha' ? 1 : 62,
    completedTaskIds: [],
    unknownTaskIds: [],
    snapshotAt: '2026-08-22T10:00:00.000Z'
  }]));
  const client = dom.window.__clientTest;
  client.setData({ sailing: {
    sourceUrl: 'https://oldschool.runescape.wiki/w/Sea_charting',
    totalTasks: tasks.length,
    players: ['alpha', 'beta'],
    playerProgress,
    completionGroups: groups.map((name, taskId) => ({ name, taskIds: [taskId] })),
    tasks
  } });

  client.renderSailingProgress(['alpha', 'beta']);
  assert.equal(dom.window.document.querySelector('#sailing-progress-container .sailing-player-grid') !== null, true);
  assert.equal(dom.window.document.querySelector('#sailing-progress-container .sailing-explorer-controls'), null);
  client.renderSeaChartingExplorer(['alpha', 'beta']);
  assert.equal(dom.window.document.querySelectorAll('.sailing-chart-group').length, 7);
  assert.equal(dom.window.document.querySelectorAll('.sailing-chart-group[open]').length, 0);

  dom.window.document.querySelector('#sailing-explorer-player').focus();
  client.setSailingExplorerPlayer('beta');
  assert.equal(dom.window.document.activeElement.id, 'sailing-explorer-player');
  assert.equal(dom.window.document.activeElement.value, 'beta');

  client.setSailingExplorerGroup('Ardent Ocean');
  assert.equal(dom.window.document.activeElement.id, 'sailing-explorer-group');
  client.setSailingExplorerStatus('all');
  assert.equal(dom.window.document.activeElement.id, 'sailing-explorer-status');
});
