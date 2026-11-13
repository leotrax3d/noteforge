#!/usr/bin/env bash
# Startet ein Wegwerf-Postgres, spielt Supabase-Stub + Migrationen ein und führt die RLS-Tests aus.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)"; bin="${PG_BIN:-$bin}"
tmp="$(mktemp -d)"; trap '"$bin/pg_ctl" -D "$tmp/db" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
"$bin/initdb" -D "$tmp/db" -U postgres -A trust >/dev/null
"$bin/pg_ctl" -D "$tmp/db" -o "-k $tmp -c listen_addresses=''" -l "$tmp/log" start -w >/dev/null
run() { psql -h "$tmp" -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
run -f "$here/supabase_stub.sql"
for m in "$here"/../migrations/*.sql; do run -f "$m"; done
run -f "$here/bug_reports_rls.sql"
