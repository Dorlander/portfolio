# ============================================
# Act Management System - Production Docker
# ============================================

# Stage 1: Dependencies
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json bun.lock* ./
RUN npm install -g bun
RUN bun install --frozen-lockfile

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm install -g bun
ENV DATABASE_URL="file:/app/db-template/custom.db"
RUN bun run db:generate
# пустая база-шаблон создаётся на этапе сборки — prisma CLI в рантайме не нужен
RUN mkdir -p /app/db-template && bunx prisma db push --skip-generate
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

# Stage 3: Production
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV DATABASE_URL="file:/app/data/custom.db"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Prisma client + query engine (standalone-трейс может их не включить)
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
# База-шаблон: подкладывается в том при первом старте
COPY --from=builder /app/db-template /app/db-template
# Догонка схемы существующих томов при старте (Prisma CLI в образе нет)
COPY --from=builder /app/scripts/migrate-db.mjs ./scripts/migrate-db.mjs

RUN mkdir -p /app/data /app/logs && chown -R nextjs:nodejs /app/data /app/logs /app/db-template

USER nextjs

EXPOSE 3000

CMD ["sh", "-c", "[ -f /app/data/custom.db ] || cp /app/db-template/custom.db /app/data/custom.db; node scripts/migrate-db.mjs; node server.js"]
