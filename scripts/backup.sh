#!/usr/bin/env bash
# Weekly logical backup (SPEC 11 Backups): a compressed pg_dump of the production database for an
# off-platform copy, on top of Supabase's daily backups. See docs/OPERATIONS.md ("Backups").
#
# Usage: DATABASE_URL='postgresql://…' scripts/backup.sh [output-directory]
#   DATABASE_URL  the session-pooler or direct connection string from Supabase (Settings > Database);
#                 keep it in a password manager, never in the repository.
#   KEEP          how many dumps to keep in the directory (default 8, about two months).
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Set DATABASE_URL to the database connection string (see docs/OPERATIONS.md)." >&2
  exit 1
fi
command -v pg_dump >/dev/null || { echo "pg_dump is not installed (PostgreSQL 17 client tools)." >&2; exit 1; }

out_dir="${1:-./backups}"
keep="${KEEP:-8}"
mkdir -p "$out_dir"
stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
file="$out_dir/loandesk-$stamp.dump"

# Custom format: compressed, and restorable table by table with pg_restore.
pg_dump --format=custom --no-owner --no-privileges --schema=public --schema=auth --schema=storage \
  --file="$file" "$DATABASE_URL"
sha256sum "$file" > "$file.sha256"
echo "Backup written: $file ($(du -h "$file" | cut -f1))"

# Keep the newest $keep dumps.
ls -1t "$out_dir"/loandesk-*.dump 2>/dev/null | tail -n +"$((keep + 1))" | while read -r old; do
  rm -f -- "$old" "$old.sha256"
done
