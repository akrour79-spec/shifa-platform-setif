/**
 * middleware/errors.js — معالجة الأخطاء مركزياً
 * -----------------------------------------------------------------------------
 * هدفان:
 *   1) عدم تسريب تفاصيل داخلية (stack, SQL) إلى العميل في الإنتاج.
 *   2) تحويل أخطاء قاعدة البيانات المعروفة إلى استجابات مفهومة بالعربية.
 */

'use strict';

const config = require('../config');

/** خطأ مُقصود داخل التطبيق يحمل رمز HTTP ورسالة عربية */
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.expected = true;
  }

  static badRequest(message, details)  { return new AppError(400, 'bad_request', message, details); }
  static unauthorized(message = 'يجب تسجيل الدخول') { return new AppError(401, 'unauthenticated', message); }
  static forbidden(message = 'ليس لديك صلاحية')   { return new AppError(403, 'forbidden', message); }
  static notFound(message = 'العنصر المطلوب غير موجود') { return new AppError(404, 'not_found', message); }
  static conflict(message, details)    { return new AppError(409, 'conflict', message, details); }
  static tooMany(message = 'عدد كبير من المحاولات، حاول لاحقاً') { return new AppError(429, 'rate_limited', message); }
}

/** معالج 404 لكل المسارات غير الموجودة */
function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'not_found',
    message: `المسار غير موجود: ${req.method} ${req.originalUrl}`,
  });
}

/**
 * ترجمة أخطاء PostgreSQL الشائعة إلى رسائل عربية مفيدة.
 * ملاحظة: نُبقي SQLSTATEInternally ولا نكشف التفاصيل في الإنتاج.
 */
function translatePgError(err) {
  switch (err.code) {
    // نقص في unique constraint
    case '23505': {
      const constraint = err.constraint || '';
      if (constraint.includes('uniq_doctor_slot')) {
        return new AppError(409, 'slot_taken',
          'هذا الموعد محجوز بالفعل. اختر وقتاً آخر أو انظر إلى الخانات المتاحة.');
      }
      if (constraint.includes('uniq_doctor_queue_day')) {
        return new AppError(409, 'queue_conflict', 'تعارض في رقم الدور، أعد المحاولة');
      }
      if (constraint.includes('profiles_phone_key')) {
        return new AppError(409, 'phone_taken',
          'رقم الهاتف مسجّل مسبقاً. سجّل الدخول بدلاً من ذلك.');
      }
      return new AppError(409, 'duplicate', 'هذه البيانات مسجّلة مسبقاً');
    }
    // foreign key violation
    case '23503':
      return new AppError(400, 'bad_reference', 'أحد العناصر المرتبطة غير موجود');
    // check constraint violation
    case '23514':
      return new AppError(400, 'check_failed', 'قيمة غير مقبولة (قيد قاعدة البيانات)');
    // not-null violation
    case '23502':
      return new AppError(400, 'missing_field', 'حقل مطلوب مفقود');
    // lock timeout
    case '55P03':
      return new AppError(503, 'busy', 'الخادم مشغول، أعد المحاولة بعد لحظات');
    case '57014':
      return new AppError(503, 'timeout', 'انتهت مهلة الطلب، أعد المحاولة');
    default:
      return null;
  }
}

/** معالج الأخطاء الأخير — يجب أن يأتي بعد كل المسارات */
function errorHandler(err, req, res, _next) {
  const translated = translatePgError(err);
  const final = translated || err;

  const status = Number.isInteger(final.status) ? final.status : 500;

  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, '\n', err);
  }

  // لا نكشف تفاصيل داخلية في الإنتاج. AppError مُصمَّم ليكون آمناً للعرض.
  const exposeMessage = final.expected || !config.isProd || status < 500;

  const body = {
    error: final.code || 'internal_error',
    message: exposeMessage ? final.message : 'حدث خطأ غير متوقع في الخادم',
  };

  if (final.details) body.details = final.details;

  // في التطوير فقط: نعرض تفاصيل SQL لتسهيل التشخيص
  if (!config.isProd && status >= 500) {
    body.debug = {
      pgCode: err.code,
      constraint: err.constraint,
      detail: err.detail,
    };
  }

  res.status(status).json(body);
}

/** يلتقط أخطاء JSON غير الصالحة من body */
function jsonErrorHandler(err, req, res, next) {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({
      error: 'invalid_json',
      message: 'صيغة JSON المُرسلة غير صحيحة',
    });
  }
  return next(err);
}

module.exports = {
  AppError,
  errorHandler,
  notFoundHandler,
  jsonErrorHandler,
  translatePgError,
};