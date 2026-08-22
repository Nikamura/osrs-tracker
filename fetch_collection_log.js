import {
  cleanText,
  makeAbsoluteUrl,
  fetchWikiPage,
  isMainModule,
  saveGameData
} from './fetch_utils.js';

const SOURCE_URL = 'https://oldschool.runescape.wiki/w/Collection_log/Table';

export function parseCollectionLog(document) {
  const table = document.querySelector('table.collection-log');
  if (!table) {
    throw new Error('Collection log table not found');
  }

  const rows = Array.from(table.querySelectorAll('tr')).slice(1);
  const collectionLog = rows.map(row => {
    const cells = Array.from(row.querySelectorAll('td'));
    if (cells.length < 2) return null;

    const itemId = row.getAttribute('data-item-id');
    const itemCell = cells[0];
    const collectionCell = cells[1];
    const itemLinks = Array.from(itemCell.querySelectorAll('a'));
    const itemNameLinkElement = itemLinks.find(link => !link.querySelector('img') && cleanText(link.textContent));
    const itemIconLinkElement = itemLinks.find(link => link.querySelector('img'));
    const collectionLinkElement = collectionCell.querySelector('a');

    return {
      itemId,
      itemName: cleanText(itemNameLinkElement?.textContent || itemCell.textContent),
      itemLink: makeAbsoluteUrl(itemNameLinkElement?.getAttribute('href')),
      itemIcon: makeAbsoluteUrl(itemCell.querySelector('img')?.getAttribute('src')),
      itemIconLink: makeAbsoluteUrl(itemIconLinkElement?.getAttribute('href')),
      collection: cleanText(collectionLinkElement?.textContent || collectionCell.textContent),
      collectionLink: makeAbsoluteUrl(collectionLinkElement?.getAttribute('href'))
    };
  }).filter(item => item?.itemName);

  const itemIds = collectionLog.map(item => item.itemId);
  if (itemIds.some(itemId => !/^\d+$/.test(itemId || ''))) {
    throw new Error('Collection log data contains a missing or invalid item ID');
  }
  if (new Set(itemIds).size !== itemIds.length) {
    throw new Error('Collection log data contains duplicate item IDs');
  }

  return collectionLog;
}

export async function fetchCollectionLog() {
  console.log('Fetching collection log data...');
  const document = await fetchWikiPage(SOURCE_URL);
  const collectionLog = parseCollectionLog(document);

  console.log(`Parsed ${collectionLog.length} collection log items`);
  saveGameData('collection_log.json', collectionLog, { minimumItems: 1_600 });
  return collectionLog;
}

if (isMainModule(import.meta.url)) {
  fetchCollectionLog().catch(error => {
    console.error('Error fetching collection log:', error);
    process.exitCode = 1;
  });
}
