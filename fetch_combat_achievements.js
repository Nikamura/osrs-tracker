import {
  cleanText,
  makeAbsoluteUrl,
  fetchWikiPage,
  isMainModule,
  saveGameData
} from './fetch_utils.js';

const SOURCE_URL = 'https://oldschool.runescape.wiki/w/Combat_Achievements/All_tasks';

export function parseCombatAchievements(document) {
  const table = document.querySelector('table.ca-tasks');
  if (!table) {
    throw new Error('Combat achievements table not found');
  }

  const rows = Array.from(table.querySelectorAll('tr')).slice(1);
  const combatAchievements = rows.map(row => {
    const cells = Array.from(row.querySelectorAll('td'));
    if (cells.length < 5) return null;

    const extractWikiLink = (cell) => {
      const href = cell?.querySelector('a')?.getAttribute('href');
      return makeAbsoluteUrl(href);
    };

    const taskId = row.getAttribute('data-ca-task-id');
    return {
      taskId,
      monster: cleanText(cells[0]?.textContent),
      monsterWikiLink: extractWikiLink(cells[0]),
      name: cleanText(cells[1]?.textContent),
      nameWikiLink: extractWikiLink(cells[1]),
      description: cleanText(cells[2]?.textContent),
      type: cleanText(cells[3]?.textContent),
      tier: cleanText(cells[4]?.textContent),
      tierIconUrl: makeAbsoluteUrl(cells[4]?.querySelector('img')?.getAttribute('src'))
    };
  }).filter(Boolean);

  const taskIds = combatAchievements.map(item => item.taskId);
  if (taskIds.some(taskId => !/^\d+$/.test(taskId || ''))) {
    throw new Error('Combat achievements data contains a missing or invalid task ID');
  }
  if (new Set(taskIds).size !== taskIds.length) {
    throw new Error('Combat achievements data contains duplicate task IDs');
  }

  return combatAchievements;
}

export async function fetchCombatAchievements() {
  console.log('Fetching combat achievements data...');
  const document = await fetchWikiPage(SOURCE_URL);
  const combatAchievements = parseCombatAchievements(document);

  console.log(`Parsed ${combatAchievements.length} combat achievements`);
  saveGameData('combat_achievements.json', combatAchievements, { minimumItems: 600 });
  return combatAchievements;
}

if (isMainModule(import.meta.url)) {
  fetchCombatAchievements().catch(error => {
    console.error('Error fetching combat achievements:', error);
    process.exitCode = 1;
  });
}
