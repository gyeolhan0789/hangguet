# syntax=docker/dockerfile:1

# 개발 서버 배포 이미지 (deploy/dev/compose.yml)

# 빌드: CI(ai-test)와 같은 Python·uv 버전으로 uv.lock 그대로 가상 환경을 만든다. 개발 도구(dev 그룹)는 빼고 설치한다.
FROM python:3.13-slim AS build
ENV UV_VERSION=0.12.5 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/app/.venv
RUN pip install --no-cache-dir "uv==${UV_VERSION}"
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev

# 실행: 같은 Python 이미지에 가상 환경과 앱 코드만 담는다.
FROM python:3.13-slim
WORKDIR /app

RUN groupadd --system --gid 10001 a301 \
    && useradd --system --uid 10001 --gid a301 a301

COPY --from=build --chown=a301:a301 /app/.venv ./.venv
COPY --chown=a301:a301 app ./app

USER a301

# AI_ROOT_PATH: 지금은 내부 전용이라 비워 둔다. Nginx에서 /ai 같은 경로로 열 때 이 값만 넣으면 Swagger 주소가 맞게 나온다.
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    AI_ROOT_PATH=""

EXPOSE 8000

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --root-path \"$AI_ROOT_PATH\""]
