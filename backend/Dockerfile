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

EXPOSE 3000
CMD ["npm", "start"]