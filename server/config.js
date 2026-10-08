/**
 * config.js — إعدادات الخادم من متغيرات البيئة
 * -----------------------------------------------------------------------------
 * قاعدة التصميم: أي سرّ لا يجب أن يُكتَب داخل الكود إطلاقاً.
 * لا توجد قيم افتراسية لـ DATABASE_URL أو JWT_SECRET عمداً — يجب ضبطها،
 * والخادم يرفض الإقلاع بدونها بدل أن يعمل في وضع غير آمن.
 */

'use strict';

require('dotenv').config();

const path = require('path');

const ROOT = path.join(__dirname, '..');

/** يجمع الأخطاءinstead من رميها فوراً، لنطبع كل النواقص دفعة واحدة */
function collectErrors() {
  const errors = [];

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || !dbUrl.trim()) {
    errors.push(
      'DATABASE_URL مفقود.\n' +
      '    → Supabase: Settings > Database > Connection string > URI (نمط Pooler، المنفذ 6543)'
    );
  } else if (!/^postgres(ql)?:\/\//.test(dbUrl)) {
    errors.push('DATABASE_URL غير صالح: يجب أن يبدأ بـ postgres:// أو postgresql://');
  }

  const secret = process.env.JWT_SECRET;
  if (!secret || !secret.trim()) {
    errors.push('JWT_SECRET مفقود. ولّد مفتاحاً بالأمر: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  } else if (secret.length < 32) {
    errors.push(`JWT_SECRET ضعيف (${secret.length} حرفاً). الحد الأدنى 32 حرفاً.`);
  }

  if (process.env.NODE_ENV === 'production') {
    if (secret && secret === 'change-me-in-production') {
      errors.push('JWT_SECRET لا يجب أن يبقى على قيمته الافتراضية في الإنتاج.');
    }
    if (process.env.CORS_ORIGIN === '*') {
      errors.push('CORS_ORIGIN=* غير مسموح في الإنتاج. حدد النطاق بدقة.');
    }
    if (!process.env.CHARGILY_SECRET_KEY && !process.env.CHARGILY_API_KEY) {
      console.warn('\x1b[33m⚠ تحذير: مفاتيح Chargily غائبة في الإنتاج — الدفع الإلكتروني سيرفض (fail-closed).\x1b[0m');
    }
    if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
      console.warn('\x1b[33m⚠ تحذير: إعدادات WhatsApp غائبة — التذكيرات ستعمل في وضع السجل فقط.\x1b[0m');
    }
  }

  return errors;
}

const errors = collectErrors();
if (errors.length > 0) {
  console.error('\n\x1b[31m╔══════════════════════════════════════════════════════════════╗');
  console.error('║  تعذّر إقلاع الخادم — إعدادات ناقصة أو غير آمنة              ║');
  console.error('╚══════════════════════════════════════════════════════════════╝\x1b[0m\n');
  errors.forEach((e, i) => console.error(`  ${i + 1}. ${e}\n`));
  console.error('  راجع .env.example للخطوات الكاملة.\n');
  process.exit(1);
}

const int = (v, fallback) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

module.exports = Object.freeze({
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',

  port: int(process.env.PORT, 4000),
  host: process.env.HOST || '0.0.0.0',

  // الخادم نفسه يقدّم ملفات الواجهة، لكن في الإنتاج قد يكون على نطاق منفصل
  corsOrigin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
    : ['http://localhost:4000', 'http://127.0.0.1:4000', 'http://localhost:8080'],

  databaseUrl: process.env.DATABASE_URL.trim(),

  jwt: Object.freeze({
    secret: process.env.JWT_SECRET.trim(),
    expiresIn: process.env.JWT_EXPIRES_IN || '12h',
  }),

  bcryptRounds: int(process.env.BCRYPT_ROUNDS, 12),

  rateLimit: Object.freeze({
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: int(process.env.RATE_LIMIT_MAX, 300),
    authMax: int(process.env.RATE_LIMIT_AUTH_MAX, 10), // محاولات دخول/تسجيل
  }),

  root: ROOT,
  publicDir: path.join(ROOT, 'public'),
  webDir: path.join(ROOT), // الواجهة الحالية في الجذر: index.html, js/, css/
});