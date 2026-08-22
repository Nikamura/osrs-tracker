import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { fetchText } from './http.js';

const WIKI_BASE = 'https://oldschool.runescape.wiki';

export function makeAbsoluteUrl(url) {
  if (!url) return null;
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `${WIKI_BASE}${url}`;
  return url;
}

export async function fetchWikiPage(url) {
  const text = await fetchText(url, {
    headers: { Accept: 'text/html,application/xhtml+xml' }
  });
  const dom = new JSDOM(text);
  return dom.window.document;
}

export function cleanText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

export function saveGameData(filename, data, { minimumItems = 1 } = {}) {
  if (!Array.isArray(data)) {
    throw new TypeError(`${filename} must contain an array`);
  }
  if (data.length < minimumItems) {
    throw new Error(
      `Refusing to replace ${filename}: parsed ${data.length} items, expected at least ${minimumItems}`
    );
  }

  fs.mkdirSync('game_data', { recursive: true });
  const filePath = path.join('game_data', filename);
  if (fs.existsSync(filePath) && process.env.OSRS_TRACKER_ALLOW_METADATA_DECREASE !== '1') {
    try {
      const previousData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (Array.isArray(previousData) && data.length < previousData.length) {
        throw new Error(
          `Refusing to replace ${filename}: item count decreased from ${previousData.length} to ${data.length}. `
          + 'Verify the upstream change, then set OSRS_TRACKER_ALLOW_METADATA_DECREASE=1 for one refresh if intentional.'
        );
      }
    } catch (error) {
      if (error.message.startsWith('Refusing to replace')) throw error;
      console.warn(`Previous ${filePath} is unreadable; replacing it with the newly validated data.`);
    }
  }
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(temporaryPath, filePath);
  console.log(`Saved to ${filePath}`);
}

export function isMainModule(importMetaUrl) {
  if (!process.argv[1]) return false;
  return importMetaUrl === pathToFileURL(path.resolve(process.argv[1])).href;
}
