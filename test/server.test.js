import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createApp,
  REQUIRED_DASHBOARD_FILES,
  startServer
} from '../server.js';

function writeDashboardFiles(publicDirectory, { empty = false } = {}) {
  for (const filename of REQUIRED_DASHBOARD_FILES) {
    const filePath = path.join(publicDirectory, filename);
    mkdirSync(path.dirname(filePath), { recursive: true });
    const contents = empty
      ? ''
      : (filename.endsWith('.json') || filename.endsWith('.webmanifest') ? '{}' : 'ok');
    writeFileSync(filePath, contents);
  }
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test('health check rejects empty or invalid dashboard artifacts', async () => {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'osrs-server-test-'));
  const publicDirectory = path.join(temporaryDirectory, 'public');
  writeDashboardFiles(publicDirectory, { empty: true });

  const server = createApp({ publicDirectory }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;

  try {
    const emptyResponse = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(emptyResponse.status, 503);
    const emptyBody = await emptyResponse.json();
    assert.ok(emptyBody.fileProblems.some(problem => problem.filename === 'index.html' && problem.reason === 'empty'));

    writeDashboardFiles(publicDirectory);
    const healthyResponse = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(healthyResponse.status, 200);

    writeFileSync(path.join(publicDirectory, 'data/table-data.json'), '{broken');
    const invalidJsonResponse = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(invalidJsonResponse.status, 503);
    const invalidJsonBody = await invalidJsonResponse.json();
    assert.ok(invalidJsonBody.fileProblems.some(problem =>
      problem.filename === 'data/table-data.json' && problem.reason === 'invalid-json'
    ));
  } finally {
    await closeServer(server);
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('bind failures never log a successful server start', async () => {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'osrs-bind-test-'));
  const publicDirectory = path.join(temporaryDirectory, 'public');
  writeDashboardFiles(publicDirectory);

  const occupiedServer = createServer();
  occupiedServer.listen(0, '127.0.0.1');
  await once(occupiedServer, 'listening');
  const port = occupiedServer.address().port;
  const logs = [];
  const errors = [];
  const logger = {
    log: (...values) => logs.push(values),
    error: (...values) => errors.push(values)
  };

  try {
    const failedServer = startServer({
      app: createApp({ publicDirectory }),
      port,
      host: '127.0.0.1',
      logger,
      setExitCode: false
    });
    const bindError = await new Promise(resolve => failedServer.once('error', resolve));
    assert.equal(bindError.code, 'EADDRINUSE');
    assert.equal(logs.length, 0);
    assert.equal(errors.length, 1);
  } finally {
    await closeServer(occupiedServer);
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('serves crawler assets, redirects the duplicate index URL, and keeps data endpoints out of results', async () => {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'osrs-seo-server-test-'));
  const publicDirectory = path.join(temporaryDirectory, 'public');
  writeDashboardFiles(publicDirectory);

  const server = createApp({ publicDirectory }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const indexResponse = await fetch(`${baseUrl}/index.html`, { redirect: 'manual' });
    assert.equal(indexResponse.status, 308);
    assert.equal(indexResponse.headers.get('location'), '/');

    const expectedContentTypes = new Map([
      ['/favicon.svg', 'image/svg+xml'],
      ['/favicon.ico', 'image/vnd.microsoft.icon'],
      ['/apple-touch-icon.png', 'image/png'],
      ['/og/osrs-tracker-card-v1.png', 'image/png'],
      ['/site.webmanifest', 'application/manifest+json'],
      ['/robots.txt', 'text/plain'],
      ['/sitemap.xml', 'application/xml']
    ]);
    for (const [pathname, contentType] of expectedContentTypes) {
      const response = await fetch(`${baseUrl}${pathname}`);
      assert.equal(response.status, 200, pathname);
      assert.match(response.headers.get('content-type') || '', new RegExp(`^${contentType.replace('+', '\\+')}`));
    }

    const dataResponse = await fetch(`${baseUrl}/data/table-data.json`);
    assert.equal(dataResponse.status, 200);
    assert.equal(dataResponse.headers.get('x-robots-tag'), 'noindex, nofollow');

    const healthResponse = await fetch(`${baseUrl}/healthz`);
    assert.equal(healthResponse.status, 200);
    assert.equal(healthResponse.headers.get('x-robots-tag'), 'noindex, nofollow');
  } finally {
    await closeServer(server);
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
