import express from 'express';
import helmet from 'helmet';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REQUIRED_DASHBOARD_FILES = [
  'index.html',
  'styles.css',
  'js/app.js',
  'js/init.js',
  'favicon.ico',
  'favicon.svg',
  'favicon-48x48.png',
  'apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'og/osrs-tracker-card-v1.png',
  'site.webmanifest',
  'robots.txt',
  'sitemap.xml',
  'data/chart-data.json',
  'data/player-config.json',
  'data/table-data.json'
];

const REQUIRED_JSON_FILES = REQUIRED_DASHBOARD_FILES.filter(filename =>
  filename.endsWith('.json') || filename.endsWith('.webmanifest')
);

function getFileProblems(publicDirectory) {
  const problems = [];

  for (const filename of REQUIRED_DASHBOARD_FILES) {
    const filePath = path.join(publicDirectory, filename);
    if (!existsSync(filePath)) {
      problems.push({ filename, reason: 'missing' });
      continue;
    }

    try {
      const stats = statSync(filePath);
      if (!stats.isFile() || stats.size === 0) {
        problems.push({ filename, reason: 'empty' });
      }
    } catch {
      problems.push({ filename, reason: 'unreadable' });
    }
  }

  for (const filename of REQUIRED_JSON_FILES) {
    if (problems.some(problem => problem.filename === filename)) continue;
    try {
      JSON.parse(readFileSync(path.join(publicDirectory, filename), 'utf8'));
    } catch {
      problems.push({ filename, reason: 'invalid-json' });
    }
  }

  return problems;
}

export function createApp({
  publicDirectory = path.resolve('public'),
  maximumGenerationAgeMs = 45 * 60_000
} = {}) {
  const app = express();
  mkdirSync(publicDirectory, { recursive: true });

  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'", 'https://queue.simpleanalyticscdn.com'],
        fontSrc: ["'self'", 'data:', 'https://unpkg.com'],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:', 'https://oldschool.runescape.wiki', 'https://queue.simpleanalyticscdn.com'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", 'https://cdn.jsdelivr.net', 'https://scripts.simpleanalyticscdn.com'],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
        upgradeInsecureRequests: []
      }
    }
  }));

  app.get('/healthz', (request, response) => {
    response.set('X-Robots-Tag', 'noindex, nofollow');
    const fileProblems = getFileProblems(publicDirectory);
    if (fileProblems.length > 0) {
      return response.status(503).json({ status: 'not-ready', fileProblems });
    }

    const generatedAt = statSync(path.join(publicDirectory, 'index.html')).mtime;
    const ageMs = Date.now() - generatedAt.getTime();
    if (ageMs > maximumGenerationAgeMs) {
      return response.status(503).json({
        status: 'stale',
        generatedAt: generatedAt.toISOString(),
        ageMinutes: Math.floor(ageMs / 60_000)
      });
    }

    return response.json({ status: 'ok', generatedAt: generatedAt.toISOString() });
  });

  app.get('/index.html', (request, response) => response.redirect(308, '/'));

  app.use('/data', (request, response, next) => {
    response.set('X-Robots-Tag', 'noindex, nofollow');
    next();
  });

  app.use(express.static(publicDirectory, {
    etag: true,
    index: 'index.html',
    maxAge: 0
  }));

  return app;
}

export function startServer({
  app = createApp(),
  port = Number(process.env.PORT || 3000),
  host = process.env.HOST || '0.0.0.0',
  logger = console,
  setExitCode = true
} = {}) {
  const server = app.listen(port, host);

  server.once('listening', () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    logger.log(`Server running at http://${host}:${actualPort}`);
  });

  server.on('error', error => {
    logger.error('Server failed:', error);
    if (setExitCode) process.exitCode = 1;
  });

  return server;
}

function shutdown(server, signal) {
  console.log(`Received ${signal}; shutting down.`);
  server.close(error => {
    if (error) {
      console.error('Server shutdown failed:', error);
      process.exitCode = 1;
    }
  });
}

const isMainModule = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  const configuredAgeMinutes = Number(process.env.HEALTH_MAX_AGE_MINUTES || 45);
  const maximumGenerationAgeMs = Number.isFinite(configuredAgeMinutes) && configuredAgeMinutes > 0
    ? configuredAgeMinutes * 60_000
    : 45 * 60_000;
  const app = createApp({ maximumGenerationAgeMs });
  const server = startServer({ app });
  process.on('SIGTERM', () => shutdown(server, 'SIGTERM'));
  process.on('SIGINT', () => shutdown(server, 'SIGINT'));
}
