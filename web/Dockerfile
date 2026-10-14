# 다단계: build에서 standalone을 만들고 runner는 server.js + 정적 자산만 가진다.
# 빌드 컨텍스트는 repo 루트(compose `context: .`) — 라우트가 ../src(classify-core·mask)를 import해 번들한다.
FROM node:22-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# 루트 의존성은 src/가 import하는 @typesafe-ai/sdk 해석용.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci --no-audit --no-fund
COPY src src
COPY web web
WORKDIR /app/web
RUN npx next build --webpack

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/web/.next/standalone ./
# standalone은 .next/static·public을 담지 않는다 — 빠지면 HTML은 200인데 CSS·폰트만 404다.
COPY --from=build --chown=node:node /app/web/.next/static ./.next/static
COPY --from=build --chown=node:node /app/web/public ./public
EXPOSE 3000
# 인터넷에 노출되는 프로세스라 root가 아닌 node(1000)로(리뷰 A4). 비밀 파일은 /home/node/.claude/에 마운트한다(compose).
USER node
CMD ["node", "server.js"]
