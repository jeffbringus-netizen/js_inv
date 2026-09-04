FROM node:22-bookworm-slim

LABEL org.opencontainers.image.source="https://github.com/jeffbringus-netizen/js_inv"
LABEL org.opencontainers.image.title="js_inv"

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY server.js db.js backup.js logger.js ./

COPY routes ./routes
COPY public ./public

ENV NODE_ENV=production \
    IS_DOCKER=1 \
    PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]