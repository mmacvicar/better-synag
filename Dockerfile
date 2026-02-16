FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN pip install --no-cache-dir uv

# Install only runtime dependencies first for better layer caching.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Copy app source.
COPY app ./app
COPY README.md ./README.md

# Default container settings. Override via env as needed.
ENV APP_HOST=0.0.0.0
ENV APP_PORT=8080
ENV DATABASE_PATH=/data/portal.db

EXPOSE 8080

CMD ["sh", "-c", "uv run uvicorn app.main:app --host ${APP_HOST:-0.0.0.0} --port ${APP_PORT:-8080}"]
