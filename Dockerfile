# TypeWords 本地部署镜像：静态生成（pnpm generate）+ Nginx 托管
# 构建:  docker build -t typewords:local .
# 运行:  docker run -d --name typewords -p 5567:80 typewords:local

# ---------- 构建阶段 ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# 国内网络默认使用 npmmirror；需要官方源可 --build-arg NPM_REGISTRY=https://registry.npmjs.org
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV npm_config_registry=${NPM_REGISTRY} \
    CI=1 \
    NODE_OPTIONS=--max-old-space-size=4096

# pnpm >= 10.26 才支持 pnpm-workspace.yaml 里的 allowBuilds 配置
RUN npm install -g pnpm@10.26.0

# 先装依赖，命中 Docker 层缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# 再拷源码构建
COPY . .
RUN pnpm generate

# ---------- 运行阶段 ----------
FROM nginx:alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/.output/public /usr/share/nginx/html
EXPOSE 80
