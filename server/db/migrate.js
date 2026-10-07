/**
 * db/migrate.js — مُشغّل الترحيلات (migrations)
 * -----------------------------------------------------------------------------
 * الاستخدام:  npm run migrate
 * -----------------------------------------------------------------------------
 * كل ملف .sql في مجلد migrations يُنفَّذ مرة واحدة فقط، وتُسجَّل أسماؤه في
 * جدول _migrations. الترحيلات مرتّبة حسب الاسم.
 *
 * كل الترحيلات مُغلَّفة في معاملة واحدة لكل ملف، مع BUSY_TIMEOUT لتحمّل
 * التزامن أثناء التطوير.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const db = require('./index');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureRegistry() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public._migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function appliedFiles() {
  const rows = await db.query('SELECT filename FROM public._migrations');
  return new Set(rows.map((r) => r.filename));
}

/**
 * جداول التطبيق — وجودها مع سجل ترحيلات فارغ = حالة خطرة.
 *
 * لماذا هذا الفحص موجود:
 *   حدث أن كانت هذه الجداول موجودة فعلاً بينما جدول _migrations كان فارغاً
 *   (قاعدة أُنشئت بطريق آخر، أو استُعيدت من نسخة بلا السجل). عندها ظنّ
 *   المشغّل أن كل الترحيلات جديدة فنفّذ 000_drop_legacy.sql على قاعدة
 *   فيها بيانات، فمسح كل المواعيد. السجل وحده لا يكفي كحارس.
 *
 * ما نفعله: نوقف التشغيل ونشرح، بدل أن نخمّن. المستخدم يقرر.
 */
const APP_TABLES = ['profiles', 'doctors', 'appointments', 'communes', 'specialties'];

async function assertNoOrphanSchema(done) {
  if (done.size > 0) return;

  const rows = await db.query(
    `SELECT c.relname AS table_name,
            (SELECT count(*) FROM pg_class x WHERE x.relname = c.relname) AS present
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ANY($1)`,
    [APP_TABLES]
  );
  const existing = rows.filter((r) => Number(r.present) > 0).map((r) => r.table_name);

  if (existing.length === 0) return;

  console.error(
    `\n\x1b[31m✗ توقّف: جداول التطبيق موجودة لكن سجل الترحيلات فارغ.\x1b[0m\n` +
    `  \x1b[31m${existing.join('، ')}\x1b[0m\n`
  );
  console.error('  تشغيل كل الترحيلات على قاعدة فيها بيانات قد يمسحها (000_drop_legacy.sql).');
  console.error('\n  إن كنت متأكداً أن القاعدة فارغة فعلاً، احذف الجداول ثم أعد التشغيل:');
  console.error(`    DROP TABLE ${existing.map((t) => `public.${t}`).join(', ')} CASCADE;`);
  console.error('\n  وإن كانت فيها بيانات تريد الاحتفاظ بها، سجّل الترحيلات المطبَّقة يدوياً:');
  console.error(
    `    INSERT INTO public._migrations (filename)\n` +
    `    VALUES ('000_drop_legacy.sql'), ('001_schema.sql'), ('002_security_lockdown.sql');`
  );
  console.error('');
  process.exit(1);
}

async function main() {
  console.log('\n\x1b[36m▸ فحص الاتصال بقاعدة البيانات...\x1b[0m');

  const health = await db.healthCheck();
  if (!health.ok) {
    console.error(`\x1b[31m✗ فشل الاتصال: ${health.error}\x1b[0m`);
    console.error('  تحقّق من DATABASE_URL في ملف .env');
    process.exit(1);
  }
  console.log(`\x1b[32m✓ متصل بقاعدة: ${health.db}\x1b[0m`);

  await ensureRegistry();
  const done = await appliedFiles();
  await assertNoOrphanSchema(done);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('\x1b[33mلا توجد ترحيلات في مجلد migrations.\x1b[0m');
    return;
  }

  const pending = files.filter((f) => !done.has(f));

  if (pending.length === 0) {
    console.log('\x1b[32m✓ قاعدة البيانات محدَّثة بالكامل — لا ترحيلات معلّقة.\x1b[0m\n');
    return;
  }

  console.log(`\n\x1b[36m▸ ${pending.length} ترحيل معلّق:\x1b[0m`);
  pending.forEach((f) => console.log(`   - ${f}`));
  console.log('');

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    process.stdout.write(`  ▸ ${file} ... `);

    try {
      await db.transaction(async (client) => {
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query("SET LOCAL statement_timeout = '60s'");
        await client.query(sql);
        await client.query('INSERT INTO public._migrations (filename) VALUES ($1)', [file]);
      });
      console.log('\x1b[32m✓ نجح\x1b[0m');
    } catch (err) {
      console.log('\x1b[31m✗ فشل\x1b[0m');
      console.error(`\n\x1b[31m${err.message}\x1b[0m\n`);
      if (err.code === '42501') {
        console.error('  السبب الأرجح: DATABASE_URL يستخدم مستخدماً بلا صلاحية DDL.');
        console.error('  الحل: استخدم رابط الاتصال المباشر (5432) لمرة الترحيل، أو اسمح لـ service_role بإنشاء الجداول.');
      }
      if (err.detail) console.error(`  تفاصيل: ${err.detail}`);
      process.exit(1);
    }
  }

  console.log('\n\x1b[32m✓ اكتملت كل الترحيلات بنجاح.\x1b[0m\n');
}

main()
  .catch((err) => {
    console.error('\n\x1b[31mخطأ غير متوقع:\x1b[0m', err);
    process.exit(1);
  })
  .finally(() => db.close());