import {
  cleanText,
  makeAbsoluteUrl,
  fetchWikiPage,
  isMainModule,
  saveGameData
} from './fetch_utils.js';

const SOURCE_URL = 'https://oldschool.runescape.wiki/w/Quests/List';

function isQuestTable(table) {
  const headers = Array.from(table.querySelector('tr')?.querySelectorAll('th') || [])
    .map(cell => cleanText(cell.textContent).toLowerCase());
  return headers.includes('name') && headers.includes('difficulty') && headers.includes('length');
}

function findSectionQuestTable(document, headingId) {
  const heading = document.getElementById(headingId);
  if (!heading) return null;

  let element = heading.closest('.mw-heading') || heading;
  while ((element = element.nextElementSibling)) {
    if (element.matches('.mw-heading') && element.querySelector('h2, h3')) {
      break;
    }

    const candidates = element.matches('table')
      ? [element]
      : Array.from(element.querySelectorAll?.('table') || []);
    const questTable = candidates.find(candidate => candidate.classList.contains('wikitable') && isQuestTable(candidate));
    if (questTable) return questTable;
  }

  return null;
}

function parseQuestTable(table, source) {
  if (!table) return [];

  const headerCells = Array.from(table.querySelector('tr').querySelectorAll('th'));
  const headers = headerCells.map(cell => cleanText(cell.textContent).toLowerCase());
  const indexOf = (name) => headers.findIndex(header => header === name);
  const indexes = {
    name: indexOf('name'),
    difficulty: indexOf('difficulty'),
    length: indexOf('length'),
    questPoints: headerCells.findIndex(cell =>
      cleanText(cell.textContent).toLowerCase().includes('quest point')
      || Boolean(cell.querySelector('[data-skill="Quest points"]'))
      || cell.querySelector('a[title="Quest points"]')
    ),
    series: indexOf('series'),
    release: headers.findIndex(header => header === 'release' || header === 'release date')
  };

  if (indexes.name < 0 || indexes.difficulty < 0 || indexes.length < 0) {
    throw new Error(`Quest table has unsupported headers: ${headers.join(', ')}`);
  }

  return Array.from(table.querySelectorAll('tr')).slice(1).map(row => {
    const cells = Array.from(row.querySelectorAll('td'));
    if (!cells.length) return null;

    const cellAt = index => index >= 0 ? cells[index] : null;
    const nameCell = cellAt(indexes.name);
    const nameLink = nameCell?.querySelector('a');
    const name = cleanText(nameLink?.textContent || nameCell?.textContent);
    if (!name) return null;

    const questPointsText = cleanText(cellAt(indexes.questPoints)?.textContent);
    const questPointsMatch = questPointsText.match(/\d+/);
    const seriesCell = cellAt(indexes.series);

    return {
      name,
      nameWikiLink: makeAbsoluteUrl(nameLink?.getAttribute('href')),
      difficulty: cleanText(cellAt(indexes.difficulty)?.textContent) || null,
      length: cleanText(cellAt(indexes.length)?.textContent) || null,
      questPoints: questPointsMatch ? Number(questPointsMatch[0]) : null,
      series: cleanText(seriesCell?.textContent) || null,
      seriesLinks: Array.from(seriesCell?.querySelectorAll('a') || []).map(link => ({
        text: cleanText(link.textContent),
        href: makeAbsoluteUrl(link.getAttribute('href'))
      })),
      releaseDate: cleanText(cellAt(indexes.release)?.textContent) || null,
      isMiniquest: source === 'mini',
      isFreeToPlay: source === 'f2p',
      isMembers: source === 'members' || source === 'mini'
    };
  }).filter(Boolean);
}

export function parseQuests(document) {
  const freeToPlay = parseQuestTable(findSectionQuestTable(document, 'Free-to-play_quests'), 'f2p');
  const members = parseQuestTable(findSectionQuestTable(document, "Members'_quests"), 'members');
  const miniquests = parseQuestTable(findSectionQuestTable(document, 'Miniquests'), 'mini');

  if (freeToPlay.length < 20 || members.length < 100 || miniquests.length < 10) {
    throw new Error(
      `Quest sections look incomplete: F2P=${freeToPlay.length}, Members=${members.length}, Miniquests=${miniquests.length}`
    );
  }

  const quests = [...freeToPlay, ...members, ...miniquests];
  const names = quests.map(quest => quest.name);
  if (new Set(names).size !== names.length) {
    throw new Error('Quest data contains duplicate names');
  }

  return { quests, counts: { freeToPlay: freeToPlay.length, members: members.length, miniquests: miniquests.length } };
}

export async function fetchQuests() {
  console.log('Fetching quests list...');
  const document = await fetchWikiPage(SOURCE_URL);
  const { quests, counts } = parseQuests(document);

  console.log(
    `Parsed quests: F2P=${counts.freeToPlay}, Members=${counts.members}, Miniquests=${counts.miniquests}, Total=${quests.length}`
  );
  saveGameData('quests.json', quests, { minimumItems: 200 });
  return quests;
}

if (isMainModule(import.meta.url)) {
  fetchQuests().catch(error => {
    console.error('Error fetching quests:', error);
    process.exitCode = 1;
  });
}
