# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
ARG VITE_WS_URL=wss://gomoku.jopatk.top/ws
ENV VITE_WS_URL=$VITE_WS_URL
RUN npm run build

FROM node:22-alpine AS production
WORKDIR /app
RUN addgroup -S gomoku && adduser -S -G gomoku gomoku
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && chown -R gomoku:gomoku /app
COPY --from=build --chown=gomoku:gomoku /app/dist-server/index.mjs ./index.mjs
COPY --from=build --chown=gomoku:gomoku /app/dist ./web
USER gomoku
ENV NODE_ENV=production
ENV GOMOKU_HOST=0.0.0.0
ENV GOMOKU_WS_PORT=18765
EXPOSE 18765
HEALTHCHECK --interval=15s --timeout=3s --start-period=8s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:18765/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "index.mjs"]
