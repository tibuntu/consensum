# syntax=docker/dockerfile:1
# NOTE: The exact prisma-CLI-in-runner path (node node_modules/prisma/build/index.js)
# and better-sqlite3 native module availability are validated by the CI docker job.
# The generated Prisma client lives at /app/generated/prisma (per schema output setting).

FROM node:24-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ openssl && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm dlx prisma generate
RUN pnpm build

FROM base AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV DATABASE_URL="file:/data/app.db"
ENV PORT=3000
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
# prisma.config.ts does `import "dotenv/config"`; the prisma CLI loads that config
# during `migrate deploy`, so dotenv must exist in the runner (DATABASE_URL is still
# supplied via env — dotenv simply no-ops when no .env file is present).
COPY --from=builder /app/node_modules/dotenv ./node_modules/dotenv
RUN mkdir -p /data
VOLUME /data
EXPOSE 3000
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node server.js"]
