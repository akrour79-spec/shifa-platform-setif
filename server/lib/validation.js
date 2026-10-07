/**
 * lib/validation.js — مخططات التحقق من المدخلات (zod)
 * -----------------------------------------------------------------------------
 * كل مدخل من المستخدم يمرّ هنا قبل الوصول لقاعدة البيانات.
 * الهدف: رفض البيانات الخبيثة مبكراً وبmessages واضحة بالعربية.
 */

'use strict';

const { z } = require('zod');
const { normalizeAlgerianPhone, normalizeAlgerianClinicPhone } = require('./phone');
const { ROLES, APPOINTMENT_STATUS_KEYS } = require('./constants');

/** يحوّل رسائل zod التقنية إلى نص عربي مفهوم */
const arabicErrors = {
  invalid_type_error: 'نوع القيمة غير صحيح',
  required_error: 'هذا الحقل مطلوب',
  invalid_enum_value: 'القيمة غير مسموح بها',
  too_small: 'القيمة قصيرة جداً',
  too_big: 'القيمة طويلة جداً',
};

/** رقم هاتف جزائري — يُطبَّع تلقائياً إلى E.164 */
const phoneSchema = z
  .string({ required_error: 'رقم الهاتف مطلوب' })
  .transform((val, ctx) => {
    const result = normalizeAlgerianPhone(val);
    if (!result.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.reason });
      return z.NEVER;
    }
    return result.e164;
  });

/**
 * هاتف عيادة — نقّال أو ثابت.
 * منفصل عن phoneSchema عن قصد: عيادات سطيف تعلن أرقاماً ثابتة مثل
 * 036 92 45 10، وهي أرقام لا يقبلها تطبيع الهاتف الشخصي.
 */
const clinicPhoneSchema = z
  .string({ required_error: 'هاتف العيادة مطلوب' })
  .transform((val, ctx) => {
    const result = normalizeAlgerianClinicPhone(val);
    if (!result.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.reason });
      return z.NEVER;
    }
    return result.e164;
  });

const nameSchema = z
  .string({ required_error: 'الاسم مطلوب' })
  .trim()
  .min(3, 'الاسم قصير جداً (3 أحرف على الأقل)')
  .max(80, 'الاسم طويل جداً (80 حرفاً كحد أقصى)')
  // يمنع وسوم HTML: إصلاح ثغرة XSS عند العرض عبر innerHTML لاحقاً
  .refine((v) => !/[<>]/.test(v), 'الاسم يحتوي رموزاً غير مسموح بها')
  .refine((v) => !/^\s|\s$/.test(v), 'الاسم لا يبدأ أو ينتهي بمسافة')
  // نعدّ الأحرف الفعلية لا المسافات: ترفض الأسماء المختصرة مثل "أ ب"
  .refine(
    (v) => v.replace(/\s/g, '').length >= 3,
    'الاسم قصير جداً — اكتب الاسم الكامل (3 أحرف على الأقل بدون مسافات)'
  );

const passwordSchema = z
  .string({ required_error: 'كلمة السر مطلوبة' })
  .min(8, 'كلمة السر يجب أن تكون 8 محارف على الأقل')
  .max(128, 'كلمة السر طويلة جداً')
  .refine((v) => /[a-zA-Z؀-ۿ]/.test(v), 'كلمة السر يجب أن تحتوي حرفاً واحداً على الأقل')
  .refine((v) => /\d/.test(v), 'كلمة السر يجب أن تحتوي رقماً واحداً على الأقل');

/**
 * نص حرّ يُعرض في الواجهة — يمنع وسوم HTML ويحدّ الطول.
 * كل ما يصل إلى innerHTML في المتصفح يمرّ من هنا. بدون هذا الفحص كان
 * الخادم يقبل أي نص في الأسماء والعناوين، فتُخزَّن وسوم HTML وتُنفَّذ
 * في متصفح كل زائر للصفحة (XSS مخزَّن).
 */
const displayText = (max, label) =>
  z
    .string({ required_error: `${label} مطلوب` })
    .trim()
    .max(max, `${label} طويل جداً`)
    .refine((v) => !/[<>]/.test(v), `${label} يحتوي رموزاً غير مسموح بها`)
    .refine((v) => v.length > 0, `${label} لا يمكن أن يكون فارغاً`);

const idSchema = z.string().uuid('المعرّف غير صالح');
// المعرفات في البيانات الحالية بصيغة doc-1 … doc-8 (قصيرة).
// نسمح بـ 1-32 محرفاً بعد البادئة. أمان المعرف لا يعتمد على سرّيته:
// كل استعلامات العيادة تتحقق من الملكية عبر profile_id لا عبر تخمين المعرّف.
const doctorIdSchema = z
  .string()
  .regex(/^doc-[a-z0-9]{1,32}$/i, 'معرّف الطبيب غير صالح');
const aptIdSchema = z
  .string()
  .regex(/^APT-\d{4,12}$/i, 'معرّف الموعد غير صالح');
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD');
const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'الوقت يجب أن يكون بصيغة HH:MM (24 ساعة)');

// --------------------------------------------------------------------------
// مخططات التسجيل والدخول
// --------------------------------------------------------------------------

/**
 * التسجيل
 * -----------------------------------------------------------------------------
 * حساب المريض يحتاج: الاسم، الهاتف، البلدية، كلمة السر.
 * حساب الطبيب يحتاج إضافةً إلى ذلك: التخصص، العنوان، هاتف العيادة.
 *
 * لماذا هذه الحقول مطلوبة وليست اختيارية:
 *   عمود specialty_id في doctors مُعرَّف NOT NULL، وكذلك address و phone.
 *   أي أن تسجيل طبيب بدونها لا ينتج عيادة أصلاً، فينتهي الأمر بحساب
 *   طبيب لا يستطيع أن يستقبل موعداً — وهو بالضبط العيب الذي كان يمنع
 *   أي طبيب من الظهور في المنصة. نفضّل رفض الطلب برسالة واضحة الآن.
 *
 * clinicPhone منفصل عن phone: رقم الحساب قد يكون رقم الهاتف الشخصي
 * للطبيب، ورقم العيادة الذي يعرضه المريض على اللوحة شيء آخر.
 */
const signupSchema = z.object({
  fullName: nameSchema,
  phone: phoneSchema,
  password: passwordSchema,
  role: z.enum(ROLES, arabicErrors).default('patient'),
  communeId: z.string().max(40).optional().nullable(),
  clinicName: z.string().trim().max(120).optional().nullable(),
  hasChifa: z.boolean().default(true),
  // حقول الطبيب
  specialtyId: z.string().max(40).optional().nullable(),
  address: displayText(200, 'عنوان العيادة').optional().nullable(),
  clinicPhone: clinicPhoneSchema.optional().nullable(),
}).strict().superRefine((v, ctx) => {
  if (v.role !== 'doctor') return;
  if (!v.specialtyId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['specialtyId'], message: 'التخصص الطبي مطلوب لحساب الطبيب' });
  }
  if (!v.address) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['address'], message: 'عنوان العيادة مطلوب' });
  }
  if (!v.clinicPhone) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['clinicPhone'], message: 'هاتف العيادة مطلوب' });
  }
});

const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, 'كلمة السر مطلوبة').max(128),
}).strict();

const updateProfileSchema = z.object({
  fullName: nameSchema.optional(),
  communeId: z.string().max(40).optional().nullable(),
  clinicName: z.string().trim().max(120).optional().nullable(),
  hasChifa: z.boolean().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, 'لا يوجد ما يتم تحديثه');

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'كلمة السر الحالية مطلوبة'),
  newPassword: passwordSchema,
}).strict();

// --------------------------------------------------------------------------
// مخططات الأطباء
// --------------------------------------------------------------------------

const doctorFilterSchema = z.object({
  specialty: z.string().max(40).optional(),
  commune: z.string().max(40).optional(),
  search: z.string().trim().max(80).optional(),
  hasChifa: z.enum(['true', 'false']).optional(),
  sort: z.enum(['rating', 'price_asc', 'price_desc', 'geo']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
}).strict();

const availabilityQuerySchema = z.object({
  date: dateSchema,
  leadMinutes: z.coerce.number().int().min(0).max(240).default(0),
}).strict();
/** ساعات العمل بصيغة "HH:MM - HH:MM" — يتحقق الخادم أن البداية قبل النهاية */
const workHoursSchema = z
  .string({ required_error: 'ساعات العمل مطلوبة' })
  .trim()
  .regex(
    /^([01]\d|2[0-3]):([0-5]\d)\s*-\s*([01]\d|2[0-3]):([0-5]\d)$/,
    'ساعات العمل يجب أن تكون بصيغة HH:MM - HH:MM (مثال: 08:00 - 16:30)'
  )
  .refine((v) => {
    const [start, end] = v.split('-').map((s) => s.trim());
    return start < end;
  }, 'بداية الدوام يجب أن تكون قبل نهايته');

/**
 * تحديث ملف العيادة — PUT /api/doctors/me
 * -----------------------------------------------------------------------------
 * كل الحقول اختيارية (تحديث جزئي)، لكن ما يُرسَل يجب أن يمرّ بتحقق كامل.
 * بدون هذا المخطط كان الخادم يقبل أي نص في الاسم والعنوان، ما يعيد فتح
 * ثغرة XSS عند العرض في innerHTML.
 */
const updateClinicSchema = z
  .object({
    name: displayText(80, 'اسم الطبيب').optional(),
    title: displayText(120, 'التخصص').optional(),
    address: displayText(200, 'العنوان').optional(),
    phone: clinicPhoneSchema.optional(),
    price: z.coerce.number().int().min(0).max(1_000_000, 'السعر خارج النطاق المعقول').optional(),
    work_hours: workHoursSchema.optional(),
    available_days: displayText(80, 'أيام العمل').optional(),
    slot_minutes: z.coerce
      .number()
      .int()
      .refine((v) => [10, 15, 20, 30, 45, 60].includes(v), 'مدة الموعد يجب أن تكون 10 أو 15 أو 20 أو 30 أو 45 أو 60 دقيقة')
      .optional(),
    has_chifa: z.boolean().optional(),
    accepting_bookings: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'لا يوجد ما يتم تحديثه');

// --------------------------------------------------------------------------
// مخططات المواعيد
// --------------------------------------------------------------------------

const bookAppointmentSchema = z.object({
  doctorId: doctorIdSchema,
  date: dateSchema,
  time: timeSchema,
  patientName: nameSchema,
  patientPhone: phoneSchema,
  hasChifa: z.boolean().default(true),
  notes: z.string().trim().max(280).optional().nullable(),
}).strict();

const listAppointmentsSchema = z.object({
  date: dateSchema.optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  status: z.enum(APPOINTMENT_STATUS_KEYS, arabicErrors).optional(),
  scope: z.enum(['mine', 'doctor']).default('mine'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict();

const updateAppointmentStatusSchema = z.object({
  status: z.enum(APPOINTMENT_STATUS_KEYS, arabicErrors),
}).strict();

// --------------------------------------------------------------------------
// تحويل أخطاء zod إلى استجابة HTTP
// --------------------------------------------------------------------------

function formatZodError(error) {
  const details = error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
  return {
    error: 'invalid_input',
    message: 'البيانات المُرسلة غير صالحة',
    details,
  };
}

module.exports = {
  // حقول
  phoneSchema, clinicPhoneSchema, nameSchema, passwordSchema,
  dateSchema, timeSchema, doctorIdSchema, aptIdSchema, idSchema,
  // مخططات
  signupSchema, loginSchema, updateProfileSchema, changePasswordSchema,
  doctorFilterSchema, availabilityQuerySchema, updateClinicSchema,
  bookAppointmentSchema, listAppointmentsSchema, updateAppointmentStatusSchema,
  // أدوات
  formatZodError,
};