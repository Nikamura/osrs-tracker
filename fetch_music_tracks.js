import {
  cleanText,
  makeAbsoluteUrl,
  fetchWikiPage,
  isMainModule,
  saveGameData
} from './fetch_utils.js';

const SOURCE_URL = 'https://oldschool.runescape.wiki/w/Music';

function headerIndex(headers, ...names) {
  return headers.findIndex(header => names.includes(header));
}

export function parseMusicTracks(document) {
  const tables = Array.from(document.querySelectorAll('table.wikitable'));
  const table = tables.find(candidate => {
    const headers = Array.from(candidate.querySelector('tr')?.querySelectorAll('th') || [])
      .map(cell => cleanText(cell.textContent).toLowerCase());
    return headers.includes('name')
      && headers.some(header => header.startsWith('unlock'))
      && (headers.includes('length') || headers.includes('duration'))
      && (headers.includes('p2p') || headers.includes('members'));
  });

  if (!table) {
    throw new Error('Music tracks table not found');
  }

  const headerCells = Array.from(table.querySelector('tr').querySelectorAll('th'));
  const headers = headerCells.map(cell => cleanText(cell.textContent).toLowerCase());
  const indexes = {
    name: headerIndex(headers, 'name'),
    unlock: headers.findIndex(header => header.startsWith('unlock')),
    duration: headerIndex(headers, 'length', 'duration'),
    members: headerIndex(headers, 'p2p', 'members'),
    release: headerIndex(headers, 'release', 'release date'),
    track: headerIndex(headers, 'music track', 'track')
  };

  if (Object.entries(indexes).some(([name, index]) => name !== 'release' && index < 0)) {
    throw new Error(`Music tracks table has unsupported headers: ${headers.join(', ')}`);
  }

  const rows = Array.from(table.querySelectorAll('tr')).slice(1);
  return rows.map(row => {
    const cells = Array.from(row.querySelectorAll('td'));
    if (cells.length <= Math.max(...Object.values(indexes))) return null;

    const nameCell = cells[indexes.name];
    const unlockCell = cells[indexes.unlock];
    const membersCell = cells[indexes.members];
    const nameLink = nameCell.querySelector('a');
    const membersText = cleanText(membersCell.textContent).toLowerCase();

    return {
      name: cleanText(nameCell.textContent),
      nameWikiLink: makeAbsoluteUrl(nameLink?.getAttribute('href')),
      unlockDetails: cleanText(unlockCell.textContent),
      unlockLinks: Array.from(unlockCell.querySelectorAll('a'))
        .map(link => makeAbsoluteUrl(link.getAttribute('href')))
        .filter(Boolean),
      members: Boolean(membersCell.querySelector('a[title="Members"]')) || membersText.startsWith('1'),
      duration: cleanText(cells[indexes.duration]?.textContent),
      releaseDate: indexes.release >= 0 ? cleanText(cells[indexes.release]?.textContent) : null,
      trackOggUrl: makeAbsoluteUrl(cells[indexes.track]?.querySelector('a')?.getAttribute('href')),
      isExclusive: Boolean(nameCell.querySelector('b')),
      isHoliday: Boolean(nameCell.querySelector('i'))
    };
  }).filter(track => track?.name);
}

export async function fetchMusicTracks() {
  console.log('Fetching music tracks data...');
  const document = await fetchWikiPage(SOURCE_URL);
  const musicTracks = parseMusicTracks(document);

  const names = musicTracks.map(track => track.name);
  if (new Set(names).size !== names.length) {
    throw new Error('Music tracks data contains duplicate names');
  }

  console.log(`Parsed ${musicTracks.length} music tracks`);
  saveGameData('music_tracks.json', musicTracks, { minimumItems: 800 });
  return musicTracks;
}

if (isMainModule(import.meta.url)) {
  fetchMusicTracks().catch(error => {
    console.error('Error fetching music tracks:', error);
    process.exitCode = 1;
  });
}
