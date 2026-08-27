# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app

# ---- 開発用 : docker compose が使うのはこのステージ ----
# ソースは bind mount で流し込むため COPY しない
#
# NODE_ENV は意図的に設定しない。
# Vite は `NODE_ENV || mode` で production 判定を行うため、ここで development を
# 固定すると、同じコンテナで実行する `npm run build` まで dev ビルド
# （Vue の開発版・MSW の混入）になってしまう。未設定なら dev/build 双方が正しく決まる。
FROM base AS dev
EXPOSE 5173
CMD ["npm", "run", "dev"]

# ---- 本番ビルド : 将来デプロイする時に使う ----
FROM base AS build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
