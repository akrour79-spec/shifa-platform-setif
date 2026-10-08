/**
 * monitoring.js — تتبّع الأخطاء (اختياري)
 * -----------------------------------------------------------------------------
 * إذا ضُبط SENTRY_DSN في البيئة، تُرسَل أخطاء الخادم (500) إلى Sentry.
 * بدون المفتاح: لا يحدث شيء — يبقى السلوك الحالي (console فقط).
 * لا توجد اعتمادية صلبة على @sentry/node؛ يُحمَّل ديناميكياً عند الحاجة.
 */
'use strict';

let sentry = null;
let enabled = false;

function init() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || !dsn.trim()) return false;
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn: dsn.trim(),
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: 0.1,
    });
    sentry = Sentry;
    enabled = true;
    console.log('  المراقبة     : Sentry مفعّل');
    return true;
  } catch (e) {
    console.warn('  المراقبة     : SENTRY_DSN مضبوط لكن @sentry/node غير مثبّت — ثبّته: npm i @sentry/node');
    return false;
  }
}

/** يرسل الخطأ إلى Sentry إن كان مفعّلاً، وإلا لا يفعل شيئاً */
function captureError(err, context) {
  if (!enabled || !sentry) return;
  try {
    sentry.withScope((scope) => {
      if (context && typeof context === 'object') {
        Object.entries(context).forEach(([k, v]) => scope.setExtra(k, v));
      }
      sentry.captureException(err);
    });
  } catch {
    // المراقبة لا يجب أن تكسر الطلب أبداً
  }
}

module.exports = { init, captureError, isEnabled: () => enabled };
