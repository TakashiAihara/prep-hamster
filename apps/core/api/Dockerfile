# syntax=docker/dockerfile:1.7
ARG BUN_VERSION=1
FROM oven/bun:${BUN_VERSION}-slim AS base
WORKDIR /app
ENV CI=true

# --- deps: workspace package.json をすべて配置して bun install ---
# Bun は workspace を per-package node_modules の symlink で解決するため、
# root の node_modules だけでなく各 workspace の node_modules も生成される。
FROM base AS deps
COPY package.json bun.lock ./
COPY apps/core/api/package.json apps/core/api/package.json
COPY apps/user/client/cli/package.json apps/user/client/cli/package.json
COPY apps/administrator/client/cli/package.json apps/administrator/client/cli/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/schema/package.json packages/schema/package.json
RUN bun install --frozen-lockfile

# --- source: deps の node_modules を引き継いだまま、API が必要とする
#     workspace のソース実体を載せる ---
FROM deps AS source
COPY tsconfig.base.json ./
COPY apps/core/api ./apps/core/api
COPY packages/db ./packages/db
COPY packages/schema ./packages/schema

# --- runtime: 非 root ユーザーで起動、HEALTHCHECK で /health 監視 ---
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000

RUN groupadd --system --gid 1001 app \
 && useradd --system --uid 1001 --gid app --no-create-home --shell /usr/sbin/nologin app

COPY --from=source --chown=app:app /app /app

USER app
WORKDIR /app/apps/core/api

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun --eval "fetch('http://localhost:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "run", "src/index.ts"]
