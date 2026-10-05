FROM node:22-slim AS build
WORKDIR /app
# better-sqlite3 compiles from source when no prebuilt binary matches; build stage only.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 MEDIATROVE_DATA_DIR=/data
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/_engine ./_engine
COPY --from=build /app/app/dist ./app/dist
VOLUME /data
EXPOSE 8787
CMD ["node_modules/.bin/tsx", "_engine/server.ts"]
