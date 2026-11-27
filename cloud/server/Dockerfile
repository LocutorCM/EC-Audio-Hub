FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
RUN mkdir -p /data/uploads /data/tmp && chown -R node:node /data /app
ENV DATA_DIR=/data
EXPOSE 8080
VOLUME ["/data"]
USER node
CMD ["node", "src/server.js"]
