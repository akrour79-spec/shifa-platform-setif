/**
 * routes/auth.js — التسجيل والدخول وإدارة الملف الشخصي
 * -----------------------------------------------------------------------------
 * المصادقة مبنية على: رقم الهاتف + كلمة السر (bcrypt) + رمز جلسة JWT.
 * لا توجد أي بيانات اعتماد مخزَّنة كنص صريح أبداً.
 */

'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const db = require('../db');
const config = require('../config');
const { SETIF_CENTER } = require('../lib/constants');
const {
  signupSchema, loginSchema, updateProfileSchema, changePasswordSchema,
  formatZodError,
} = require('../lib/validation');
const { authenticate, signToken, publicUser, asyncHandler } = require('../middleware/auth');
const { AppError } = require('../middleware/errors');

const router = express.Router();

/** حدّ صارم على مسارات الدخول — الهدف منع تخمين كلمات السر */
const authLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'rate_limited',
      message: 'محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.',
    });
  },
});

/** تجزئة كلمة السر — cost من الإعدادات (12 افتراضياً) */
const hashPassword = (plain) => bcrypt.hash(plain, config.bcryptRounds);

/** رسالة موحّدة عند فشل الدخول — لا نكشف إن كان الرقم موجوداً أم لا */
/**
 * يجلب عيادة الحساب ويردّها بصيغة الواجهة (بما فيها حالة التفعيل).
 * مُستدعى من /login و /me معاً: كان /login لا يُرجع العيادة إطلاقاً،
 * فحفظ العميل الحالة فارغة وظهر للطبيب المعلَّق لوحة بلا تفسير.
 * @param {string} profileId
 * @returns {Promise<object|null>}
 */
async function clinicForProfile(profileId) {
  const clinic = await db.queryOne(
    `SELECT id, name, title, address, phone, work_hours, slot_minutes, price,
            is_active, is_demo, lat, lng
       FROM public.doctors WHERE profile_id = $1`,
    [profileId]
  );
  if (!clinic) return null;
  return {
    id: clinic.id,
    name: clinic.name,
    title: clinic.title,
    address: clinic.address,
    phone: clinic.phone,
    work_hours: clinic.work_hours,
    slot_minutes: clinic.slot_minutes,
    price: Number(clinic.price),
    lat: Number(clinic.lat),
    lng: Number(clinic.lng),
    is_demo: clinic.is_demo,
    // pending هي ما تحتاجه الواجهة لتعرض شارة "بانتظار المراجعة"
    pending: !clinic.is_active,
  };
}

/** رسالة موحّدة عند فشل الدخول — لا نكشف إن كان الرقم موجوداً أم لا */

// ---------------------------------------------------------------------------
// POST /api/auth/signup — إنشاء حساب جديد
// ---------------------------------------------------------------------------
router.post('/signup', authLimiter, asyncHandler(async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('بيانات التسجيل غير صالحة', formatZodError(parsed.error).details);

  const { fullName, phone, password, role, communeId, clinicName, hasChifa,
          specialtyId, address, clinicPhone } = parsed.data;

  const exists = await db.queryOne('SELECT 1 FROM public.profiles WHERE phone = $1', [phone]);
  if (exists) {
    throw new AppError(409, 'phone_taken', 'رقم الهاتف مسجّل مسبقاً. سجّل الدخول بدلاً من ذلك.');
  }

  const passwordHash = await hashPassword(password);
  const isDoctor = role === 'doctor';

  // للطبيب: نتحقق من التخصص والبلدية قبل أي كتابة. الفحص المسبق يعطي
  // رسالة عربية واضحة، بينما خطأ المفتاح الأجنبي (23503) يعطي 500.
  let specialtyName = null;
  let communeName = null;
  if (isDoctor) {
    const specialty = await db.queryOne('SELECT id, name_ar FROM public.specialties WHERE id = $1', [specialtyId]);
    if (!specialty) throw AppError.badRequest('التخصص الطبي غير موجود');

    const commune = await db.queryOne('SELECT id, name_ar FROM public.communes WHERE id = $1', [communeId]);
    if (!commune) throw AppError.badRequest('البلدية غير موجودة');

    specialtyName = specialty.name_ar;
    communeName = commune.name_ar;
  }

  // الحساب والعيادة في معاملة واحدة: لو فشلت العيادة بعد إنشاء الحساب
  // لبقي حساب طبيب بلا عيادة إلى الأبد — وهو ما كان يُفقد المنصة قدرتها
  // على قبول أي طبيب جديد.
  const created = await db.transaction(async (client) => {
    let profile;
    try {
      profile = (await client.query(
        `INSERT INTO public.profiles
           (phone, password_hash, full_name, role, commune_id, specialty_id, clinic_name, has_chifa)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, phone, full_name, role, commune_id, specialty_id, clinic_name, has_chifa`,
        [phone, passwordHash, fullName, role, communeId || null,
         isDoctor ? specialtyId : null, clinicName || null, hasChifa]
      )).rows[0];
    } catch (err) {
      // سباق بين طلبين متزامنين على نفس الرقم → الخطأ الوحيد الحقيقي 23505
      if (err.code === '23505') {
        throw new AppError(409, 'phone_taken', 'رقم الهاتف مسجّل مسبقاً');
      }
      throw err;
    }

    if (!isDoctor) return { profile, clinic: null };

    // العيادة تُنشأ معطّلة (is_active = FALSE) عمداً:
    //   لا تظهر في الدليل العام، ولا تقبل أي حجز، حتى تتأكد الإدارة من
    //   صحّة الاسم والتخصص والإحداثيات. تفعيلها عبر approve-clinic.
    // is_demo = FALSE صراحةً: أي عيادة حقيقية لا تُوسم كبيانات تجريبية.
    const clinic = (await client.query(
      `INSERT INTO public.doctors
         (profile_id, name, title, specialty_id, commune_id, address, lat, lng,
          phone, is_active, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, FALSE)
       RETURNING id, name, title, specialty_id, commune_id, address, is_active, is_demo`,
      [profile.id, fullName, specialtyName, specialtyId, communeId,
       address, SETIF_CENTER.lat, SETIF_CENTER.lng, clinicPhone]
    )).rows[0];

    return { profile, clinic };
  });

  res.status(201).json({
    message: 'تم إنشاء الحساب بنجاح',
    token: signToken(created.profile),
    user: publicUser(created.profile),
    // الواجهة تعرض رسالة مختلفة للطبيب: عيادته بانتظار التفعيل
    clinic: created.clinic
      ? { id: created.clinic.id, name: created.clinic.name, pending: !created.clinic.is_active }
      : null,
  });
}));

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('بيانات الدخول غير صالحة', formatZodError(parsed.error).details);

  const { phone, password } = parsed.data;

  const user = await db.queryOne(
    `SELECT id, phone, password_hash, full_name, role, commune_id, specialty_id,
            clinic_name, has_chifa, is_active
       FROM public.profiles
      WHERE phone = $1`,
    [phone]
  );

  // مقارنة وهمية عند عدم وجود المستخدم، لتوحيد زمن الاستجابة
  // ومنع تعداد الحسابات (timing attack / user enumeration).
  const hash = user ? user.password_hash : '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const ok = await bcrypt.compare(password, hash);

  if (!user || !ok) throw new AppError(401, 'invalid_credentials', INVALID_CREDENTIALS.message);
  if (!user.is_active) throw new AppError(403, 'account_disabled', 'هذا الحساب معطّل. تواصل مع الإدارة.');

  res.json({
    message: 'تم تسجيل الدخول بنجاح',
    token: signToken(user),
    user: publicUser(user),
    // العيادة تُرفق مع الدخول أيضاً لا مع /me وحده: العميل يحفظها فوراً
    // فلا يحتاج طلباً إضافياً ليعرف أن عيادته بانتظار المراجعة.
    clinic: await clinicForProfile(user.id),
  });
}));

// ---------------------------------------------------------------------------
// GET /api/auth/me — الملف الشخصي الحالي
// ---------------------------------------------------------------------------
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const full = await db.queryOne(
    `SELECT id, phone, full_name, role, commune_id, specialty_id, clinic_name, has_chifa, created_at
       FROM public.profiles WHERE id = $1`,
    [req.user.id]
  );
  if (!full) throw AppError.notFound('الحساب غير موجود');

  // إذا كان حساب طبيب، نرفق عيادته — بما فيها حالة التفعيل، لأن
  // الواجهة تحتاج أن تُخبر الطبيب بأن عيادته ما زالت بانتظار المراجعة.
  const clinic = await clinicForProfile(req.user.id);

  res.json({
    user: publicUser(full),
    clinic,
  });
}));

// ---------------------------------------------------------------------------
// PATCH /api/auth/me — تحديث الملف الشخصي
// ---------------------------------------------------------------------------
router.patch('/me', authenticate, asyncHandler(async (req, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('بيانات التحديث غير صالحة', formatZodError(parsed.error).details);

  const { fullName, communeId, clinicName, hasChifa } = parsed.data;

  const updated = await db.queryOne(
    `UPDATE public.profiles
        SET full_name  = COALESCE($2, full_name),
            commune_id = COALESCE($3, commune_id),
            clinic_name= COALESCE($4, clinic_name),
            has_chifa  = COALESCE($5, has_chifa)
      WHERE id = $1
      RETURNING id, phone, full_name, role, commune_id, specialty_id, clinic_name, has_chifa`,
    [req.user.id, fullName ?? null, communeId ?? null, clinicName ?? null, hasChifa ?? null]
  );

  res.json({ message: 'تم تحديث الملف الشخصي', user: publicUser(updated) });
}));

// ---------------------------------------------------------------------------
// POST /api/auth/change-password
// ---------------------------------------------------------------------------
router.post('/change-password', authenticate, authLimiter, asyncHandler(async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('بيانات غير صالحة', formatZodError(parsed.error).details);

  const { currentPassword, newPassword } = parsed.data;

  const row = await db.queryOne('SELECT password_hash FROM public.profiles WHERE id = $1', [req.user.id]);
  if (!row) throw AppError.notFound('الحساب غير موجود');

  const ok = await bcrypt.compare(currentPassword, row.password_hash);
  if (!ok) throw new AppError(401, 'invalid_credentials', 'كلمة السر الحالية غير صحيحة');

  const newHash = await hashPassword(newPassword);
  await db.query('UPDATE public.profiles SET password_hash = $2 WHERE id = $1', [req.user.id, newHash]);

  res.json({ message: 'تم تغيير كلمة السر' });
}));

module.exports = router;