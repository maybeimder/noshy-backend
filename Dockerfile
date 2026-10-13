# Imagen única para la API y el worker (cambia solo el comando, ver docker-compose.yml).

FROM node:22-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@11.28.3
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
RUN pnpm build

FROM node:22-alpine AS prod-deps
WORKDIR /app
RUN npm install -g pnpm@11.28.3
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/entrypoints/api.js"]
