# Build stage
FROM node:22-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy built files and dependencies
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/node_modules ./node_modules
COPY package.json .

# The functions use firebase-admin which requires service account credentials
# These should be mounted as a volume or passed as env vars at runtime

# Expose the default port for Firebase Functions emulator
EXPOSE 5001

# Start the functions (this is for local emulator usage, not production Firebase)
# For production, Firebase Functions are deployed via `firebase deploy`
CMD ["node", "lib/index.js"]
