FROM node:24.16.0-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends cron util-linux \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .
RUN chmod 0755 /app/docker-entrypoint.sh \
    && chmod 0644 /app/docker/osrs-cron \
    && crontab /app/docker/osrs-cron

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(response => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
