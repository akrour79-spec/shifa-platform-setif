/**
 * middleware/auth.js — المصادقة والصلاحيات
 * -----------------------------------------------------------------------------
 * هذه الطبقة هي المرجع الوحيد للصلاحيات. قاعدة البيانات ممنوعة من الوصول
 * المباشر للمتصفح، فلا توجد سياسات RLS موزّعة قد تُنسى أو تُخطئ.
 */

'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { CLINIC_ROLES } = require('../lib/constants');

/** يغلّف async handler ليمرّر الأخطاء إلى express */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * يتحقق من رمز الجلسة (JWT) ويحمّل ملف المستخدم في req.user
 * لا يكتمل إن فشل التحقق — يعيد 401.
 */
const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({
      error: 'unauthenticated',
      message: 'يجب تسجيل الدخول للوصول إلى هذه الخدمة',
    });
  }

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    return res.status(401).json({
      error: expired ? 'token_expired' : 'invalid_token',
      message: expired ? 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول من جديد' : 'رمز الدخول غير صالح',
    });
  }

  // لا نثق بمحتوى الرمز وحده: نقرأ الحالة الحالية من القاعدة.
  // هذا يجعل إيقاف حساب أو تغيير دوره يسري فوراً على الجلسات المفتوحة.
  const user = await db.queryOne(
    `SELECT id, phone, full_name, role, commune_id, specialty_id,
            clinic_name, has_chifa, is_active
       FROM public.profiles
      WHERE id = $1`,
    [payload.sub]
  );

  if (!user) {
    return res.status(401).json({ error: 'user_not_found', message: 'الحساب غير موجود' });
  }
  if (!user.is_active) {
    return res.status(403).json({ error: 'account_disabled', message: 'هذا الحساب معطّل. تواصل مع الإدارة.' });
  }

  req.user = {
    id: user.id,
    phone: user.phone,
    fullName: user.full_name,
    role: user.role,
    communeId: user.commune_id,
    specialtyId: user.specialty_id,
    clinicName: user.clinic_name,
    hasChifa: user.has_chifa,
  };

  next();
});

/** يشطر تسجيل الدخول فقط (تستخدمه المسارات التي تقبل زائراً أو عضواً) */
const optionalAuth = asyncHandler(async (req, res, next) => {
  if (!req.headers.authorization) return next();
  return authenticate(req, res, next);
});

/** يشترط أحد أدوار العيادة (طبيب / سكرتير / مدير) */
const requireClinicRole = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'unauthenticated', message: 'يجب تسجيل الدخول' });
  }
  if (!CLINIC_ROLES.includes(req.user.role)) {
    return res.status(403).json({
      error: 'forbidden',
      message: 'هذه الخدمة مخصّصة للعيادات فقط',
    });
  }
  next();
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'unauthenticated', message: 'يجب تسجيل الدخول' });
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      error: 'forbidden',
      message: 'ليس لديك صلاحية للوصول إلى هذه الخدمة',
    });
  }
  next();
};

/** إصدار رمز جلسة */
function signToken(user) {
  return jwt.sign(
    { role: user.role },
    config.jwt.secret,
    { subject: user.id, expiresIn: config.jwt.expiresIn }
  );
}

/** الشكل العام لملف المستخدم في الاستجابات (بدون أي سرّ) */
function publicUser(user) {
  return {
    id: user.id,
    phone: user.phone,
    fullName: user.full_name ?? user.fullName,
    role: user.role,
    communeId: user.commune_id ?? user.communeId ?? null,
    specialtyId: user.specialty_id ?? user.specialtyId ?? null,
    clinicName: user.clinic_name ?? user.clinicName ?? null,
    hasChifa: user.has_chifa ?? user.hasChifa ?? true,
  };
}

module.exports = {
  authenticate,
  optionalAuth,
  requireClinicRole,
  requireRole,
  signToken,
  publicUser,
  asyncHandler,
};