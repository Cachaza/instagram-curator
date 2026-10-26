FROM node:22-bookworm AS base
RUN npm install -g bun@1.3.0 @openai/codex \
  && apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip \
  && python3 -m pip install --break-system-packages yt-dlp gallery-dl instaloader \
  && rm -rf /var/lib/apt/lists/*
# Bun 1.3's installer selects AVX2 under Mac emulation; the production KVM CPU
# cannot execute that binary. Its installed baseline variant runs on both hosts.
RUN if [ "$(node -p 'process.arch')" = x64 ]; then \
      cp /usr/local/lib/node_modules/bun/node_modules/@oven/bun-linux-x64-baseline/bin/bun "$(command -v bun)"; \
    fi
WORKDIR /app

FROM base AS build
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build && rm -rf /app/data

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["bun", "run", "start:selfhosted"]
