#!/usr/bin/env bash
# backup-db.sh — نسخ احتياطي لقاعدة بيانات Supabase (Postgres)
# ---------------------------------------------------------------------------
# الاستعمال:
#   ./scripts/backup-db.sh            # نسخة احتياطية الآن
#   # للتشغيل اليومي التلقائي (cron على الخادم):
#   0 3 * * * /path/to/shifa-platform/scripts/backup-db.sh >> /var/log/shifa-backup.log 2>&1
#
# يقرأ DATABASE_URL من .env، يحفظ لقطة مضغوطة في backups/، ويحذف ما تجاوز 7 أيام.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$ROOT/backups"
KEEP_DAYS=7

if [ -f "$ROOT/.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$ROOT/.env"; set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "✗ DATABASE_URL غير مضبوط (.env)" >&2
  exit 1
fi

command -v pg_dump >/dev/null 2>&1 || {
  echo "✗ pg_dump غير مثبّت (postgresql-client)" >&2
  exit 1
}

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/shifa-$STAMP.sql.gz"

pg_dump "$DATABASE_URL" --no-owner --no-acl | gzip > "$OUT"
echo "✓ حُفظت النسخة: $OUT ($(du -h "$OUT" | cut -f1))"

# تدوير: حذف النسخ الأقدم من KEEP_DAYS
find "$BACKUP_DIR" -name 'shifa-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "✓ التدوير: تُحفظ نسخ آخر $KEEP_DAYS أيام"
