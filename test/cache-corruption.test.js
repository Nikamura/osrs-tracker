import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadAllSnapshotsForPlayer, loadNewSnapshotsForPlayer } from '../cache.js';

for (const load of [loadAllSnapshotsForPlayer, loadNewSnapshotsForPlayer]) {
  test(`${load.name} retains valid history around a corrupt snapshot`, () => {
    const playerDir = mkdtempSync(path.join(tmpdir(), 'osrs-corrupt-'));
    try {
      writeFileSync(path.join(playerDir, '1.json'), '{"xp":1}');
      writeFileSync(path.join(playerDir, '2.json'), '{"xp":"broken\u0000"}');
      writeFileSync(path.join(playerDir, '3.json'), '{"xp":3}');
      const result = [...load({ playerDir, allFiles: ['1.json', '2.json', '3.json'] })];
      assert.deepEqual(result.map(x => x.data.xp), [1, 3]);
      assert.throws(() => [...load({ playerDir, allFiles: ['missing.json'] })], /ENOENT/);
    } finally { rmSync(playerDir, { recursive: true, force: true }); }
  });
}
