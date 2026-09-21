# syntax=docker/dockerfile:1
# Production image for the hosted deployment (see docs/agi/DEPLOY.md).
# Local dev and the Pinokio launcher do not use this — they run the Vite dev
# server; this image serves the built client plus the same API middlewares
# from server/index.mjs.

# ── Build stage ───────────────────────────────────────────────────────────
FROM node:24.14.0-slim AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# GEV_BASE is the deployment path prefix baked into asset URLs.
# GOOGLE_MAPS_API_KEY and CESIUM_ION_TOKEN are the two deliberately
# client-exposed keys (inlined into the bundle via Vite `define`; restrict
# them by HTTP referrer — see .env.example). Every other provider key is a
# runtime secret and must never appear here.
ARG GEV_BASE=/
ARG GOOGLE_MAPS_API_KEY=
ARG CESIUM_ION_TOKEN=
ARG GIT_SHA=
ENV GEV_BASE=$GEV_BASE \
    GOOGLE_MAPS_API_KEY=$GOOGLE_MAPS_API_KEY \
    CESIUM_ION_TOKEN=$CESIUM_ION_TOKEN \
    GIT_SHA=$GIT_SHA
RUN npm run build
# Bake build identity + release notes for /api/version and the update toast.
# release-notes.json is produced by scripts/release-notes.mjs on release
# builds; its absence (staging/branch builds) just means an empty notes list.
RUN node -e "const fs=require('fs');\
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));\
let notes=[];\
try{notes=JSON.parse(fs.readFileSync('release-notes.json','utf8')).notes||[]}catch{}\
fs.writeFileSync('server/build-info.json',JSON.stringify({version:pkg.version,sha:process.env.GIT_SHA||null,builtAt:new Date().toISOString(),notes},null,2));"

# ── Runtime stage ─────────────────────────────────────────────────────────
FROM node:24.14.0-slim
WORKDIR /app
ENV NODE_ENV=production PUPPETEER_SKIP_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# server/index.mjs imports vite.config.js, which imports from src/ and
# scripts/pinokio-environment.mjs; the CCTV proxy reads config/ at runtime.
COPY vite.config.js ./
COPY src ./src
COPY scripts ./scripts
COPY config ./config
COPY server ./server
COPY --from=build /app/dist ./dist
COPY --from=build /app/server/build-info.json ./server/build-info.json
# Proxy disk caches live here; machine-local and disposable.
RUN mkdir -p /app/.gev-cache && chown -R node:node /app/.gev-cache
USER node
EXPOSE 8080
CMD ["node", "server/index.mjs"]
