# The sync server. Build it with:  docker build -t collab-sync-engine .
FROM node:26-alpine

WORKDIR /app

# Install only production dependencies first, so this layer is cached
# until package.json or package-lock.json change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

ENV NODE_ENV=production \
    LOG_LEVEL=info \
    PORT=8080

EXPOSE 8080

# Do not run as root inside the container.
USER node

CMD ["node", "src/server/index.js"]