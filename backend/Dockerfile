# STAGE 1: Builder
FROM node:20-alpine AS builder
WORKDIR /app

# Copy backend dependency files
COPY backend/package.json backend/package-lock.json ./
RUN npm install --production

# Copy the backend source code
COPY backend/ .

# Copy the 'deployed' folder from the frontend sibling directory
COPY frontend/deployed ./deployed

# STAGE 2: Runner
FROM node:20-alpine
WORKDIR /app

# Copy everything from the builder stage
COPY --from=builder /app ./

EXPOSE 3000
CMD ["npm", "start"]