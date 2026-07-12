# Apical single-box image.
#
# One image runs every role — the Next.js web app AND the four network
# mini-services (run-relay, scheduler, desktop-bridge, agent-worker) — selected
# by the container command (see docker-compose.yml). They intentionally share
# one source tree, one node_modules, and one generated Prisma client, so the
# services can never drift from the web app's schema.

FROM oven/bun:1-slim AS build
WORKDIR /app

# A few repo scripts shell out to `node`; bun is CLI-compatible for them.
RUN ln -sf /usr/local/bin/bun /usr/local/bin/node

# Optional: extra trusted CA certs for TLS-intercepting build proxies (corporate
# networks, some CI). Drop PEM files in docker/certs/ (gitignored, empty by
# default). Concatenated into a bundle used only for the install steps below.
COPY docker/cert[s]/ /tmp/extra-ca/
RUN cat /tmp/extra-ca/*.crt > /tmp/ca.pem 2>/dev/null || true

# Root dependencies first (layer-cached until the lockfile changes).
# postinstall runs `prisma generate`, which needs the schema present.
COPY package.json bun.lock ./
COPY prisma ./prisma
RUN NODE_EXTRA_CA_CERTS=/tmp/ca.pem bun install --frozen-lockfile

# Per-service dependencies (socket.io, playwright). @prisma/client is
# deliberately NOT a per-service dependency — it resolves up-tree to the root
# generated client.
COPY mini-services ./mini-services
RUN set -e; for d in mini-services/*/; do \
      if [ -f "$d/package.json" ]; then (cd "$d" && NODE_EXTRA_CA_CERTS=/tmp/ca.pem bun install); fi; \
    done

# Build the web app (standalone output + static assets copied in).
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN NODE_EXTRA_CA_CERTS=/tmp/ca.pem bun run build

# Optional: bake Chromium so the agent-worker's browser tools work out of the
# box. Off by default (adds ~400MB); the worker runs fine without it and
# browser-based tools report an actionable error instead.
#   docker build --build-arg INSTALL_BROWSER=1 -t apical .
ARG INSTALL_BROWSER=0
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
RUN if [ "$INSTALL_BROWSER" = "1" ]; then \
      cd mini-services/agent-worker && bunx playwright install --with-deps chromium; \
    fi

ENV NODE_ENV=production
# Web app; run-relay; scheduler; desktop-bridge; agent-worker.
EXPOSE 3000 3003 3004 3005 3006

# Default role: the web app. The standalone server binds HOSTNAME/PORT
# (0.0.0.0:3000 in compose). Other roles override the command, e.g.
#   bun mini-services/run-relay/index.ts
CMD ["bun", ".next/standalone/server.js"]
