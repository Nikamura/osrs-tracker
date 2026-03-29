FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN apt-get update && apt-get install -y cron && rm -rf /var/lib/apt/lists/*

RUN echo '*/15 * * * * cd /app && /usr/local/bin/node data_fetcher.js && /usr/local/bin/node cleanup_player_data.js && NODE_OPTIONS="--max-old-space-size=4096" /usr/local/bin/node generate_static.js >> /var/log/cron.log 2>&1' > /etc/cron.d/osrs-cron \
    && chmod 0644 /etc/cron.d/osrs-cron \
    && crontab /etc/cron.d/osrs-cron

EXPOSE 3000

CMD cron && node server.js
