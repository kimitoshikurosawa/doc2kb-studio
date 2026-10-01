# syntax=docker/dockerfile:1

# ---- Dependencies (production only, no build toolchain needed: all deps are pure JS / WASM) ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ---- Runtime ----
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js ./
# Tesseract language models: OCR runs fully offline
COPY eng.traineddata fra.traineddata ./
COPY lib ./lib
COPY public ./public

# Never run as root
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/status').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# Doc2KB Studio handles SIGTERM itself (graceful shutdown + OCR worker cleanup)
CMD ["node", "server.js"]
