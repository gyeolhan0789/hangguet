# syntax=docker/dockerfile:1

# 개발 서버 배포 이미지 (deploy/dev/compose.yml)
# next.config.ts의 output: "standalone" 결과물(.next/standalone)을 node server.js로 띄운다.
# API 주소(API_BASE_URL)는 빌드할 때 넣지 않는다. 컨테이너를 띄울 때 환경 변수로 넣는다(src/lib/api/config.ts).

# 의존성: package-lock.json만 바뀌지 않으면 이 레이어를 다시 쓴다.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 빌드: CI(fe-build)와 같은 Node 이미지에서 next build를 한다.
FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_A301_DEV_MONITORING=0
ENV NEXT_PUBLIC_A301_DEV_MONITORING=$NEXT_PUBLIC_A301_DEV_MONITORING
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# 실행: standalone 서버와, standalone에 들어가지 않는 정적 파일(public, .next/static)만 담는다.
FROM node:24-alpine
WORKDIR /app

# HOSTNAME=0.0.0.0: 컨테이너 밖(Nginx)에서 들어올 수 있게 모든 주소에서 받는다.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S -g 10001 a301 \
    && adduser -S -u 10001 -G a301 a301

COPY --from=build --chown=a301:a301 /app/.next/standalone ./
COPY --from=build --chown=a301:a301 /app/.next/static ./.next/static
COPY --from=build --chown=a301:a301 /app/public ./public

USER a301

EXPOSE 3000

CMD ["node", "server.js"]
