import { fetchJson } from './http.js';
import {
  cleanText,
  makeAbsoluteUrl,
  isMainModule,
  saveGameData
} from './fetch_utils.js';

export const SEA_CHARTING_SOURCE_URL = 'https://oldschool.runescape.wiki/w/Sea_charting';
export const SEA_CHARTING_API_URL = 'https://oldschool.runescape.wiki/api.php';
export const SEA_CHARTING_QUERY = "bucket('seachart').select('id','description','level','type','sea','ocean','location','location2','hazard').orderBy('id','asc').limit(500).run()";

function wikiPageUrl(title) {
  if (!title) return null;
  const slug = encodeURIComponent(title.replace(/\s+/g, '_')).replace(/%2F/gi, '/');
  return makeAbsoluteUrl(`/w/${slug}`);
}

function decodeHtmlEntities(value) {
  const namedEntities = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    if (code[0] === '#') {
      const radix = code[1]?.toLowerCase() === 'x' ? 16 : 10;
      const digits = radix === 16 ? code.slice(2) : code.slice(1);
      const codePoint = Number.parseInt(digits, radix);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    }
    return namedEntities[code.toLowerCase()] ?? entity;
  });
}

function plainWikiText(value) {
  return cleanText(decodeHtmlEntities(String(value || '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/''+/g, '')));
}

function coordinatePair(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const coordinates = value.split(',').map(Number);
  return coordinates.length === 2 && coordinates.every(Number.isFinite) ? coordinates : null;
}

export function normalizeSeaChartingTasks(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.bucket;
  if (!Array.isArray(rows)) {
    throw new Error('Sea charting API response has no bucket rows');
  }

  const primaryOceanBySea = new Map();
  for (const row of rows) {
    const sea = cleanText(row?.sea);
    const ocean = cleanText(row?.ocean);
    if (sea && ocean && ocean !== 'Bonus charts') {
      const existing = primaryOceanBySea.get(sea);
      if (existing && existing !== ocean) {
        throw new Error(`Sea charting metadata maps ${sea} to multiple oceans`);
      }
      primaryOceanBySea.set(sea, ocean);
    }
  }

  const tasks = rows.map(row => {
    const taskId = Number(row?.id);
    const sea = cleanText(row?.sea);
    const upstreamOcean = cleanText(row?.ocean);
    const isBonusChart = upstreamOcean === 'Bonus charts';
    const ocean = isBonusChart ? primaryOceanBySea.get(sea) : upstreamOcean;
    const completionGroup = isBonusChart && taskId !== 2 ? 'Miscellaneous' : ocean;

    return {
      taskId,
      level: Number(row?.level),
      type: cleanText(row?.type),
      task: plainWikiText(row?.description),
      sea,
      seaWikiLink: wikiPageUrl(sea),
      ocean,
      oceanWikiLink: wikiPageUrl(ocean),
      completionGroup,
      isBonusChart,
      location: coordinatePair(row?.location),
      secondaryLocation: coordinatePair(row?.location2),
      hazard: cleanText(row?.hazard) || null
    };
  });

  const taskIds = tasks.map(task => task.taskId);
  if (tasks.some(task => !Number.isInteger(task.taskId) || task.taskId < 0)) {
    throw new Error('Sea charting data contains a missing or invalid task ID');
  }
  if (new Set(taskIds).size !== taskIds.length) {
    throw new Error('Sea charting data contains duplicate task IDs');
  }
  if (tasks.some(task => !Number.isInteger(task.level) || task.level < 1 || task.level > 99)) {
    throw new Error('Sea charting data contains an invalid Sailing level');
  }
  if (tasks.some(task => !task.type || !task.task || !task.sea || !task.ocean)) {
    throw new Error('Sea charting data contains an incomplete task row');
  }
  return tasks;
}

export async function fetchSeaChartingTasks() {
  console.log('Fetching sea charting task data...');
  const url = new URL(SEA_CHARTING_API_URL);
  url.searchParams.set('action', 'bucket');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('query', SEA_CHARTING_QUERY);

  const payload = await fetchJson(url.href);
  const tasks = normalizeSeaChartingTasks(payload);

  console.log(`Parsed ${tasks.length} sea charting tasks`);
  saveGameData('sea_charting.json', tasks, { minimumItems: 358 });
  return tasks;
}

if (isMainModule(import.meta.url)) {
  fetchSeaChartingTasks().catch(error => {
    console.error('Error fetching sea charting tasks:', error);
    process.exitCode = 1;
  });
}
