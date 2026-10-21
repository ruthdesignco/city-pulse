#!/usr/bin/env bash
# The SQL files CI's fixture job feeds to psql, in order: every migration
# except the platform-only ones, then every test. A new migration runs by
# default, so an agent's `create or replace current_state` in a new file is
# tested; add it here only if it needs the Supabase platform.
#
#   psql "$PGURL" -v ON_ERROR_STOP=1 $(scripts/sql-fixture-files.sh)
set -euo pipefail
cd "$(dirname "$0")/.."

# Need pg_cron, Vault, or a function the platform creates.
SKIP=(
  20261018210000_poller_cron.sql
  20261019040000_poller_secret_from_vault.sql
  20261019060000_revoke_rls_auto_enable.sql
  20261020121000_weather_cron.sql
)

for f in supabase/migrations/*.sql; do
  name=$(basename "$f")
  skip=0
  for s in "${SKIP[@]}"; do [[ "$name" == "$s" ]] && skip=1; done
  [[ $skip == 1 ]] || printf -- '-f %s\n' "$f"
done
for f in supabase/tests/*.sql; do printf -- '-f %s\n' "$f"; done
