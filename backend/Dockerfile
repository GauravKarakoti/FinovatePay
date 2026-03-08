# STAGE 1: Builder
FROM node:20-alpine AS builder
WORKDIR /app

# Copy backend dependency files (paths relative to project root)
COPY backend/package.json backend/package-lock.json ./
RUN npm install --production

# Copy the backend source code
COPY backend/ .

# Copy the 'deployed' folder (it is a sibling to backend/ in the root context)
COPY deployed ./deployed

# STAGE 2: Runner
FROM node:20-alpine
WORKDIR /app

# Copy everything from the builder stage
COPY --from=builder /app ./

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))" || exit 1

EXPOSE 3000

# Run database migrations before starting the application
CMD ["sh", "-c", "npm run migrate:db && npm start"]