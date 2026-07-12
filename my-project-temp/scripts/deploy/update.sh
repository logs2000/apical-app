#!/usr/bin/env bash
# Server-side deploy step for the single-box docker-compose stack.
# Invoked by .github/workflows/deploy.yml over SSH after it updates the git
# checkout; can also be run by hand on the box:
#
#   cd /opt/apical/my-project-temp && bash scripts/deploy/update.sh
#
# Builds the image, applies migrations (one-shot migrate service), restarts the
# stack, then fails loudly unless /api/health comes back ok/degraded.
set -euo pipefail

cd "$(dirname "$0")/../.."   # my-project-temp/

if [ ! -f .env.docker ]; then
  echo "ERROR: .env.docker missing — copy .env.docker.example and fill in secrets (see docs/DEPLOY.md)." >&2
  exit 1
fi

compose() { docker compose --env-file .env.docker "$@"; }

echo "==> Building image"
compose build

echo "==> Applying migrations + backfills (db:release)"
compose run --rm migrate

echo "==> Restarting services"
compose up -d --remove-orphans

echo "==> Waiting for /api/health"
PORT="$(grep -E '^APICAL_HTTP_PORT=' .env.docker | cut -d= -f2 || true)"
PORT="${PORT:-8080}"
for i in $(seq 1 30); do
  body="$(curl -fsS -m 5 "http://localhost:${PORT}/api/health" 2>/dev/null || true)"
  case "$body" in
    *'"status":"ok"'*)       echo "health: ok"; break ;;
    *'"status":"degraded"'*) echo "health: degraded (reachable, config incomplete) — deploy continues"; break ;;
  esac
  if [ "$i" = 30 ]; then
    echo "ERROR: /api/health never became ok/degraded. Recent app logs:" >&2
    compose logs --tail 50 app >&2
    exit 1
  fi
  sleep 2
done

echo "==> Pruning old images"
docker system prune -f >/dev/null

echo "Deploy complete."
