FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src

RUN mkdir -p /data/uploads && chown -R node:node /data /app
USER node
ENV NODE_ENV=production PORT=4000 DATA_DIR=/data
EXPOSE 4000
CMD ["node", "src/server.js"]
