# Imagen de DESARROLLO para la API y el worker (cambia solo el comando, ver docker-compose.yml).
# Corre con tsx (igual que `pnpm dev`), sin compilar. docker-compose monta ./src y ./drizzle,
# así que un `git pull` se aplica solo: tsx watch reinicia el proceso al detectar cambios.

FROM node:22-alpine
WORKDIR /app
RUN npm install -g pnpm@10.28.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src ./src
EXPOSE 3000
CMD ["node_modules/.bin/tsx", "watch", "src/entrypoints/api.ts"]
