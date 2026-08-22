import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveGameData } from '../fetch_utils.js';

test('validated metadata cannot silently shrink but can replace a corrupt prior file', () => {
  const previousDirectory = process.cwd();
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'osrs-metadata-test-'));

  try {
    process.chdir(temporaryDirectory);
    mkdirSync('game_data');
    writeFileSync('game_data/example.json', JSON.stringify([1, 2, 3]));

    assert.throws(
      () => saveGameData('example.json', [1, 2], { minimumItems: 1 }),
      /item count decreased from 3 to 2/
    );
    assert.deepEqual(JSON.parse(readFileSync('game_data/example.json', 'utf8')), [1, 2, 3]);

    writeFileSync('game_data/example.json', '{broken');
    saveGameData('example.json', [1, 2, 3, 4], { minimumItems: 1 });
    assert.deepEqual(JSON.parse(readFileSync('game_data/example.json', 'utf8')), [1, 2, 3, 4]);
  } finally {
    process.chdir(previousDirectory);
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
