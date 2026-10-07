# Production Dockerfile for Shifa Platform Setif
# Multi-stage lightweight build with non-root security execution

FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Copy node_modules and project files
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set unprivileged node user
USER node

EXPOSE 4000

# Docker Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/api/health || exit 1

CMD ["node", "server/index.js"]
