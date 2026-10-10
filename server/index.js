/**
 * server/index.js — نقطة انطلاق الخادم
 * -----------------------------------------------------------------------------
 * Express هو الخادم الوحيد: يقدّم ملفات الواجهة ويوفّر واجهات API.
 * لا يُشارَض المتصفح مع قاعدة البيانات إطلاقاً.
 */

'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const db = require('./db');
const { errorHandler, notFoundHandler, jsonErrorHandler } = require('./middleware/errors');

const app = express();

// ---------------------------------------------------------------------------
// تهيئة Express
// ---------------------------------------------------------------------------
app.set('trust proxy', 1);        // خلف Vercel/Nginx
app.disable('x-powered-by');      // لا نكشف اسم التقنيات
app.set('etag', 'strong');

// ---------------------------------------------------------------------------
// الأمان
// ---------------------------------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // نحمّل Leaflet و Lucide و Supabase من CDN. في الإنتاج يُفضَّل
      // تنزيلها محلياً ثم استبدال 'self'.
      // 'unsafe-inline' مطلوب هنا: الصفحة تستخدم معالجات onclick/onsubmit
      // مكتوبة داخل HTML نفسه (39 معالجاً). إزالتها تعني إعادة كتابة
      // الواجهة كاملة بنظام event delegation.
      //
      // ملاحظة أمنية: هذا لا يلغي الحماية من XSS. الخطر الفعلي هو حقن
      // HTML من قاعدة البيانات، وقد عولج على مستويين:
      //   • الخادم: nameSchema يرفض أي وسم HTML في أسماء المرضى
      //   • الواجهة: api.escape() على كل قيمة قادمة من القاعدة
      // كما أن سرقة الجلسة صعبة: الرمز في localStorage ولا يُرسَل
      // تلقائياً مع الطلبات (لا توجد كوكيز تحمل بيانات الدخول).
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com', 'https://cdn.jsdelivr.net'],
      styleSrc:  ["'self'", "'unsafe-inline'", 'https://unpkg.com', 'https://fonts.googleapis.com'],
      imgSrc:    ["'self'", 'data:', 'https:'],
      connectSrc:["'self'", 'https://*.supabase.co'],
      // خطوط Google: CSS من fonts.googleapis.com، الملفات من fonts.gstatic.com
      fontSrc:   ["'self'", 'data:', 'https://fonts.gstatic.com'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

/**
 * ALLOWED_ORIGINS — قائمة بيضاء نهائية لأصول المتصفح.
 *
 * أصل الخادم نفسه مُضاف دائماً: الخادم يقدّم ملفات الواجهة، لكن المتصفح
 * يرسل Origin في كل POST حتى لنفس الأصل — فبلا هذا ينهار زر الحجز وتسجيل
 * الدخول ما لم تُضبط CORS_ORIGIN بدقة في كل بيئة، وهو خطأ سهل الوقوع.
 */
const ALLOWED_ORIGINS = new Set([
  ...config.corsOrigin,
  `http://localhost:${config.port}`,
  `http://127.0.0.1:${config.port}`,
  // Render يضبط RENDER_EXTERNAL_URL تلقائياً — نسمح لنطاق السيرفر نفسه
  // حتى تعمل الواجهة المقدَّمة من الخادم مباشرة (onrender.com) بلا ضبط يدوي.
  ...(process.env.RENDER_EXTERNAL_URL ? [process.env.RENDER_EXTERNAL_URL] : []),
]);

app.use(cors({
  origin(origin, callback) {
    // طلبات بدون Origin (curl، تطبيقات أصلية، نفس المصدر) مسموحة
    if (!origin) return callback(null, true);

    if (ALLOWED_ORIGINS.has('*') || ALLOWED_ORIGINS.has(origin)) {
      return callback(null, true);
    }
    // لا نمرّر Error إلى cors: ذلك ينتج 500 ويكشف تفاصيل داخلية.
    // نمنع الإضافة فقط، وmiddleware أدناه يحوّل الطلب نفسه إلى 403.
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  maxAge: 86_400,
}));

/**
 * حارس الأصل: يقطع الطلب كلياً قبل أي منطق عمل إذا جاء من أصل غير مسموح.
 * بدونه، منع رؤوس CORS فقط لا يوقف تنفيذ الطلب على الخادم — المتصفح
 * يحجب القراءة، لكن الحجز قد يكون سُجّل فعلاً.
 */
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !(ALLOWED_ORIGINS.has('*') || ALLOWED_ORIGINS.has(origin))) {
    return res.status(403).json({
      error: 'origin_not_allowed',
      message: 'مصدر الطلب غير مسموح',
    });
  }
  return next();
});

// ---------------------------------------------------------------------------
// تحليل الطلبات
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(jsonErrorHandler);

app.use('/api', rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({
    error: 'rate_limited',
    message: 'عدد كبير من الطلبات. انتظر قليلاً ثم أعد المحاولة.',
  }),
}));

// ---------------------------------------------------------------------------
// فحص الصحة (لا يحتاج مصادقة — يُستعمل من Vercel وUptime monitors)
// ---------------------------------------------------------------------------
app.get('/api/health', async (req, res) => {
  const dbStatus = await db.healthCheck();
  res.status(dbStatus.ok ? 200 : 503).json({
    status: dbStatus.ok ? 'online' : 'degraded',
    service: 'منصة شفاء — ولاية سطيف',
    database: dbStatus.ok ? 'connected' : 'unreachable',
    databaseError: dbStatus.ok ? undefined : dbStatus.error,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// واجهات API
// ---------------------------------------------------------------------------
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/doctors',       require('./routes/doctors'));
app.use('/api/appointments',  require('./routes/appointments'));
app.use('/api/queue',         require('./routes/queue'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/payments',      require('./routes/payments'));
app.use('/api/admin',         require('./routes/admin'));
app.use('/api/medical-records', require('./routes/medical_records'));
app.use('/api/patient',         require('./routes/patient_portal'));

// أي مسار /api غير معروف → JSON 404 (لا نُسقطه إلى index.html)
app.use('/api', notFoundHandler);

// ---------------------------------------------------------------------------
// ملفات الواجهة الثابتة
// ---------------------------------------------------------------------------
/**
 * حارس أمني قبل خدمة الملفات: نمنع الوصول إلى أي مسار حسّاس.
 * بدون هذا الحارس كان بإمكان أي شخص طلب /.env والحصول على كلمة مرور
 * قاعدة البيانات وJWT_SECRET.
 */
const FORBIDDEN_PREFIXES = ['/server', '/node_modules', '/api'];
const isForbidden = (urlPath) => {
  const p = urlPath.toLowerCase();
  if (FORBIDDEN_PREFIXES.some((pre) => p === pre || p.startsWith(pre + '/'))) return true;
  // أي اسم ملف يبدأ بنقطة (.env, .gitignore, .git) ممنوع
  if (p.split('/').some((seg) => seg.startsWith('.'))) return true;
  return false;
};

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  if (isForbidden(req.path)) {
    return res.status(404).json({ error: 'not_found', message: 'المسار غير موجود' });
  }
  next();
});

const staticOptions = {
  index: 'index.html',
  extensions: ['html'],
  maxAge: config.isProd ? '1h' : 0,
  etag: true,
  setHeaders(res, filePath) {
    // لا نخزّن HTML مؤقتاً طويلاً حتى تصل التحديثات فوراً
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
    if (filePath.endsWith('.env')) {
      res.status(403).end(); // حزام أمان إضافي
    }
  },
};

app.use(express.static(config.webDir, staticOptions));

// أي مسار غير موجود في API وغير موجود كملف → index.html (تطبيق صفحة واحدة)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  const indexPath = path.join(config.webDir, 'index.html');
  if (!fs.existsSync(indexPath)) return next();
  res.sendFile(indexPath);
});

// ---------------------------------------------------------------------------
// معالجات الأخطاء (آخر شيء في السلسلة)
// ---------------------------------------------------------------------------
app.use(notFoundHandler);
app.use(errorHandler);

// ---------------------------------------------------------------------------
// الإقلاع والإيقاف الآمن
// ---------------------------------------------------------------------------
let server;

async function start() {
  // تتبّع الأخطاء (Sentry) — يُفعَّل فقط إذا ضُبط SENTRY_DSN
  try { require('./lib/monitoring').init(); } catch { /* اختياري */ }

  // نفحص قاعدة البيانات قبل قبول الطلبات — أوضح منDiscovery الفاشل لاحقاً
  const health = await db.healthCheck();
  if (!health.ok) {
    console.warn(`\x1b[33m⚠ تحذير: لا يمكن الاتصال بقاعدة البيانات — ${health.error}\x1b[0m`);
    if (config.isProd) {
      console.error('\x1b[31m✗ في الإنتاج: الخادم سيرفض الإقلاع بدون قاعدة بيانات.\x1b[0m');
      process.exit(1);
    }
  }

  server = app.listen(config.port, config.host, () => {
    const line = '─'.repeat(58);
    console.log(`\n\x1b[36m${line}\x1b[0m`);
    console.log('  \x1b[1mمنصة شفاء — ولاية سطيف\x1b[0m');
    console.log(`\x1b[36m${line}\x1b[0m`);
    console.log(`  البيئة     : ${config.env}`);
    console.log(`  العنوان    : http://localhost:${config.port}`);
    console.log(`  قاعدة البيانات: ${health.ok ? '\x1b[32mمتصلة\x1b[0m' : '\x1b[31mغير متصلة\x1b[0m'}`);
    console.log(`  واجهات API: http://localhost:${config.port}/api/health`);
    console.log(`\x1b[36m${line}\x1b[0m\n`);

    // تشغيل محرك التذكيرات التلقائي في الخلفية (Automated Reminders Queue Worker)
    const { scanAndScheduleUpcomingReminders } = require('./lib/notifications');
    setInterval(() => {
      scanAndScheduleUpcomingReminders().catch(() => {});
    }, 5 * 60 * 1000).unref();
  });
}

/** إغلاق نظيف: ننتظر الطلبات الجارية ثم نغلق مجموعة الاتصالات */
async function shutdown(signal) {
  console.log(`\n\x1b[33m${signal} — إيقاف الخادم...\x1b[0m`);

  const forceExit = setTimeout(() => {
    console.error('\x1b[31mانتهت مهلة الإيقاف — إغلاق قسري.\x1b[0m');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  try {
    await db.close();
  } catch { /* اتصال مغلق أصلاً */ }

  clearTimeout(forceExit);
  console.log('\x1b[32m✓ تم الإيقاف بنجاح.\x1b[0m');
  process.exit(0);
}

['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => shutdown(sig)));

process.on('unhandledRejection', (reason) => {
  console.error('\x1b[31m[غير معالَج] وعد مرفوض:\x1b[0m', reason);
});

if (require.main === module) {
  start().catch((err) => {
    console.error('\x1b[31mفشل إقلاع الخادم:\x1b[0m', err);
    process.exit(1);
  });
}

module.exports = { app, start };