# QuickCompare — full app, for an always-on VM (Oracle Cloud Always Free, or any box).
#
# Node 24 specifically: the app stores data through the built-in `node:sqlite`,
# which avoids a native build toolchain entirely. On Node 22 it needs an
# experimental flag; on 24 it does not.
#
# Builds clean on both arm64 (Oracle Ampere A1) and amd64.

FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    HEADLESS=true \
    HOST=0.0.0.0 \
    PORT=5177

WORKDIR /app

# Dependencies first so a source edit doesn't invalidate the browser download,
# which is by far the slowest layer.
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci --include=dev

# Chromium plus its system libraries. --with-deps pulls the right set for the
# architecture, which is why this works unchanged on Ampere.
RUN npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*

COPY . .

# Build the PWA, then drop dev dependencies from the final image.
RUN npm run build && npm prune --omit=dev

# Chromium must not run as root. Give the app user ownership of the data
# volume mountpoint and the browser cache.
RUN groupadd -r qc && useradd -r -g qc -G audio,video qc \
 && mkdir -p /app/data \
 && chown -R qc:qc /app /ms-playwright
USER qc

VOLUME ["/app/data"]
EXPOSE 5177

HEALTHCHECK --interval=60s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5177/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/index.js"]
