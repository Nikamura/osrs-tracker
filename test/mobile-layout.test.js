import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const init = readFileSync(new URL('../public/js/init.js', import.meta.url), 'utf8');
const generator = readFileSync(new URL('../generate_static.js', import.meta.url), 'utf8');

test('mobile layout keeps windows within the viewport and tables independently scrollable', () => {
  assert.match(styles, /@media \(max-width: 700px\)/);
  assert.match(styles, /\.main-window\s*{[^}]*width:\s*100%[^}]*max-width:\s*none/s);
  assert.match(styles, /\.sunken-panel\s*{[^}]*overflow:\s*auto\s*!important/s);
  assert.match(styles, /overscroll-behavior-x:\s*contain/);
  assert.match(styles, /overscroll-behavior-y:\s*auto/);
  assert.match(styles, /padding-right:\s*max\(20px, env\(safe-area-inset-right\)\)/);
});

test('mobile controls are touch-sized and window dragging is disabled on coarse pointers', () => {
  assert.match(styles, /\.player-label,[\s\S]*?min-height:\s*44px/);
  assert.match(styles, /\.title-bar-controls button\s*{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s);
  assert.match(app, /matchMedia\('\(min-width: 701px\) and \(pointer: fine\)'\)/);
  assert.match(app, /maintainAspectRatio:\s*false/);
  assert.match(styles, /\.sailing-explorer-controls select,[\s\S]*?min-height:\s*44px/);
  assert.match(styles, /\.sailing-chart-group\s*>\s*summary,[\s\S]*?min-height:\s*44px/);
  assert.match(styles, /\.sailing-sea-group\s*>\s*summary[\s\S]*?min-height:\s*44px/);
  assert.match(styles, /\.sailing-sea-body\s*>\s*a\s*{[^}]*min-height:\s*44px/s);
});

test('mobile selection and scroll regions retain native control semantics', () => {
  assert.match(generator, /<input type="checkbox"[^>]*id="\$\{inputId\}"[^>]*>[\s\S]*?<label class="player-label" for="\$\{inputId\}">/);
  assert.match(generator, /<input type="checkbox"[^>]*id="window-\$\{window\.id\}"[^>]*>[\s\S]*?<label class="window-label" for="window-\$\{window\.id\}">/);
  assert.match(app, /role="region" aria-label="Quest comparison" tabindex="0"/);
  assert.match(app, /setAttribute\('aria-expanded', String\(!isMinimized\)\)/);
  assert.match(app, /setAttribute\('aria-label', isMinimized \? 'Restore' : 'Minimize'\)/);
  assert.match(styles, /\.title-bar-controls button\[aria-controls\]\s*{[^}]*background-image:/s);
});

test('new summary windows use mobile cards and preserve native disclosure controls', () => {
  assert.match(generator, /data-window-id="player-overview"/);
  assert.match(generator, /data-window-id="sailing-progress"/);
  assert.match(generator, /data-window-id="sea-charting-explorer"/);
  assert.match(app, /<details class="sailing-chart-group"/);
  assert.match(app, /<details class="sailing-sea-group">/);
  assert.match(app, /<summary>/);
  assert.match(styles, /\.overview-grid,[\s\S]*?\.sailing-explorer-controls\s*{\s*grid-template-columns:\s*1fr/s);
});

test('returning users see windows introduced after their saved visibility catalog', () => {
  assert.match(generator, /data-window-catalog-version="2"/);
  assert.match(generator, /data-introduced-version="\$\{window\.introducedVersion \|\| 1\}"/);
  assert.match(app, /introducedVersion\s*>\s*seenCatalogVersion/);
  assert.match(init, /introducedVersion\s*<=\s*seenCatalogVersion/);
});
