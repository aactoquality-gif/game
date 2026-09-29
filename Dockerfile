# Этап 1: сборка фронтенда
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Этап 2: Node-сервер (статика + API аналитики), без npm-зависимостей
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Постоянный диск Amvera (persistenceMount в amvera.yaml)
ENV DATA_DIR=/data
COPY --from=build /app/dist ./dist/
COPY server/ ./server/
EXPOSE 80
CMD ["node", "server/index.mjs"]
