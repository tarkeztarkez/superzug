FROM oven/bun:1.3 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.3-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl imagemagick poppler-utils unzip zbar-tools && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "server/index.ts"]
