#!/bin/sh
# Container entrypoint.
#
# When LITESTREAM_BUCKET is set, restore the SQLite DB from its replica if the
# local file is missing (e.g. fresh volume), then run the app under Litestream
# so every write is continuously backed up. When it's unset (local dev or before
# backups are provisioned), just run the app directly.
set -e

DB_PATH="${LITESTREAM_DB_PATH:-/data/jpos.db}"
CONFIG="/app/litestream.yml"

if [ -n "$LITESTREAM_BUCKET" ]; then
  echo "[entrypoint] Litestream enabled (bucket=$LITESTREAM_BUCKET)"
  if [ ! -f "$DB_PATH" ]; then
    echo "[entrypoint] Local DB missing — attempting restore from replica"
    litestream restore -if-replica-exists -config "$CONFIG" -o "$DB_PATH" "$DB_PATH" \
      || echo "[entrypoint] No replica found — starting with a fresh DB"
  fi
  exec litestream replicate -config "$CONFIG" -exec "node dist/index.js"
else
  echo "[entrypoint] Litestream disabled (LITESTREAM_BUCKET unset) — running app directly"
  exec node dist/index.js
fi
