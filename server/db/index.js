/**
 * db/index.js — طبقة الوصول لقاعدة البيانات
 * -----------------------------------------------------------------------------
 * يستخدم service_role (يتجاوز RLS) لأن Express هو طبقة الصلاحيات الوحيدة.
 * هذا هو مستخدم قاعدة البيانات الوحيد الذي يجب أن يعرف رابط الاتصال.
 * ============================================================================
 */

'use strict';

const { Pool } = require('pg');
const config = require('../config');

// القيم الرقمية من Postgres تأتي كنصوص بدون pg-types الإضافي.
// نهبطها يدوياً حتى لا نحتاج حزمة types إضافية.
const pg = require('pg');
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : parseInt(v, 10)));

// -------------------------------------------------------------------------
// DATE و TIME: نُبقيهما نصاً كما هما في قاعدة البيانات
// -------------------------------------------------------------------------
// الافتراضي: Postgres يرسل DATE بالنص (نحو '2026-10-04') لكن pg يحوّله
// إلى كائن Date عبر interpretDate. المتصفح يفسّر هذا الكائن بتوقيت
// UTC فيحوّله إلى التوقيت المحلي، فينقص يوماً أو يزيد يوماً.
//
// مثال حقيقي على المنصة: موعد محجوز لـ 2026-10-04 رجع للواجهة 2026-10-03
// لأن المنطقة الزمنية للجهاز أقل من UTC.
//
// الحل: نتعامل مع التاريخ كسلسلة نصية. لا حساب ولا تحويل — والنص
// 'YYYY-MM-DD' هو نفسه في كل مكان، بلا تحويل ولا مناطق زمنية.
// وكذلك الوقت: نُبقيه 'HH:MM' كما هو بدل كائن Date.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
pg.types.setTypeParser(pg.types.builtins.TIME, (v) => (typeof v === 'string' ? v.slice(0, 5) : v));
pg.types.setTypeParser(pg.types.builtins.TIMETZ, (v) => v);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (v) => v);

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,

  // Supabase يطلب TLS. نُفعّله في الإنتاج، ونسمح بإيقافه في التطوير المحلي
  // فقط إذا كان الرابط يشير إلى localhost.
  ssl: config.isProd || !/localhost|127\.0\.0\.1/.test(config.databaseUrl)
    ? { rejectUnauthorized: false }
    : false,
});

pool.on('error', (err) => {
  console.error('[db] خطأ في اتصال غير متوقع بخادم قاعدة البيانات:', err.message);
});

/** تنفيذ استعلام (قراءة) وإرجاع الصفوف */
async function query(text, params) {
  const started = Date.now();
  try {
    const result = await pool.query(text, params);
    return result.rows;
  } finally {
    if (config.env === 'development') {
      const ms = Date.now() - started;
      if (ms > 300) console.warn(`[db] استعلام بطيء (${ms}ms): ${text.slice(0, 90)}...`);
    }
  }
}

/** إرجاع أول صف أو null */
async function queryOne(text, params) {
  const rows = await query(text, params);
  return rows[0] || null;
}

/**
 * تنفيذ مجموعة عمليات داخل معاملة واحدة.
 * كل شيء ينجح أو يتراجع بالكامل — أساسي لدقة رقم الدور ومنع الحجز المزدوج.
 */
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* الاتصال انقطع بالفعل */ }
    throw err;
  } finally {
    client.release();
  }
}

async function healthCheck() {
  try {
    const row = await queryOne('SELECT NOW() AS now, current_database() AS db');
    return { ok: true, ...row };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, queryMany: query, queryOne, transaction, healthCheck, close };