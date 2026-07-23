FROM node:22-bookworm AS base
RUN npm install -g bun@1.3.0 @openai/codex \
  && apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip \
  && python3 -m pip install --break-system-packages yt-dlp gallery-dl instaloader \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["bun", "run", "start:selfhosted"]
