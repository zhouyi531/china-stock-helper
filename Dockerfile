# syntax=docker/dockerfile:1

# ---------- Stage 1: install deps + build the web bundle ----------
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Toolchain so better-sqlite3 can compile if no prebuilt binary is available.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install with the lockfile for reproducible builds. Copy only manifests first
# so this layer is cached unless dependencies change.
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN npm ci

# Copy the rest of the sources and build the static web UI -> web/dist
COPY . .
RUN npm run build -w web

# ---------- Stage 2: runtime ----------
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    DB_PATH=/app/data/app.sqlite \
    TZ=Asia/Shanghai
WORKDIR /app

# Bring over installed modules (incl. the native better-sqlite3 binary built
# above for this same base image), the server source and the built web UI.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/server ./server
COPY --from=build /app/web/dist ./web/dist

# SQLite lives here; mount a volume to persist watchlist / positions / AI history.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 8787
WORKDIR /app/server
# tsx runs the TypeScript server directly (no separate compile step).
CMD ["npx", "--no-install", "tsx", "src/server.ts"]
