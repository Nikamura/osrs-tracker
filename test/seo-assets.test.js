import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

function publicAsset(relativePath) {
  return new URL(`../public/${relativePath}`, import.meta.url);
}

function pngDimensions(relativePath) {
  const image = readFileSync(publicAsset(relativePath));
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return {
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20)
  };
}

test('brand image outputs have the dimensions declared in page metadata and the web manifest', () => {
  assert.deepEqual(pngDimensions('og/osrs-tracker-card-v1.png'), { width: 1200, height: 630 });
  assert.deepEqual(pngDimensions('favicon-48x48.png'), { width: 48, height: 48 });
  assert.deepEqual(pngDimensions('apple-touch-icon.png'), { width: 180, height: 180 });
  assert.deepEqual(pngDimensions('icons/icon-192.png'), { width: 192, height: 192 });
  assert.deepEqual(pngDimensions('icons/icon-512.png'), { width: 512, height: 512 });
  assert.ok(statSync(publicAsset('og/osrs-tracker-card-v1.png')).size < 1_000_000);

  const icon = readFileSync(publicAsset('favicon.ico'));
  assert.deepEqual([...icon.subarray(0, 4)], [0, 0, 1, 0]);
  assert.equal(icon.readUInt16LE(4), 3);
});

test('manifest, crawler policy, sitemap, and SVG favicon use stable production paths', () => {
  const manifest = JSON.parse(readFileSync(publicAsset('site.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'OSRS Tracker');
  assert.match(manifest.description, /skills, XP, quests/);
  assert.doesNotMatch(manifest.description, /Sailing/);
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.theme_color, '#008080');
  assert.deepEqual(
    manifest.icons.map(icon => [icon.src, icon.sizes]),
    [
      ['/icons/icon-192.png', '192x192'],
      ['/icons/icon-512.png', '512x512']
    ]
  );

  const robots = readFileSync(publicAsset('robots.txt'), 'utf8');
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Sitemap: https:\/\/osrs-tracker\.cn\.lt\/sitemap\.xml$/m);

  const sitemap = readFileSync(publicAsset('sitemap.xml'), 'utf8');
  assert.match(sitemap, /<loc>https:\/\/osrs-tracker\.cn\.lt\/<\/loc>/);

  const favicon = readFileSync(publicAsset('favicon.svg'), 'utf8');
  assert.match(favicon, /viewBox="0 0 64 64"/);
  assert.match(favicon, /shape-rendering="crispEdges"/);
});
