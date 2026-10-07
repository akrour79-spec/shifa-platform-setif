/**
 * lib/constants.js — ثوابت وقواميم مشتركة
 * -----------------------------------------------------------------------------
 * حالات الموعد تُخزَّن في قاعدة البيانات بالإنجليزية (canonical) وتُترجَم هنا.
 * هذا يمنع تسرّب نصوص عربية إلى استعلامات SQL ويجعل المقارنات آمنة.
 */

'use strict';

/** ترجمة حالات الموعد + لون كل حالة في الواجهة */
const APPOINTMENT_STATUS = Object.freeze({
  confirmed:       { ar: 'مؤكد',            tone: 'info',    next: ['waiting', 'cancelled', 'no_show'] },
  waiting:         { ar: 'في قاعة الانتظار', tone: 'warn',    next: ['in_consultation', 'no_show', 'cancelled'] },
  in_consultation: { ar: 'عند الطبيب',       tone: 'active',  next: ['completed'] },
  completed:       { ar: 'مكتمل',           tone: 'done',    next: [] },
  cancelled:       { ar: 'ملغى',            tone: 'muted',   next: [] },
  no_show:         { ar: 'لم يحضر',         tone: 'danger',  next: [] },
});

const APPOINTMENT_STATUS_KEYS = Object.keys(APPOINTMENT_STATUS);

/** الحالات التي تحجز بها الت 여전히 (أي غير ملغاة) — تطابق الفهرس الجزئي uniq_doctor_slot */
const BLOCKING_STATUSES = Object.freeze(['confirmed', 'waiting', 'in_consultation', 'completed', 'no_show']);

const ROLES = Object.freeze(['patient', 'doctor', 'secretary', 'admin']);

/** أدوار لها حق الوصول إلى لوحة العيادة */
const CLINIC_ROLES = Object.freeze(['doctor', 'secretary', 'admin']);

/**
 * إحداثيات مركز مدينة سطيف.
 *
 * تُستخدم فقط كقيمة مؤقتة عند تسجيل طبيب جديد: حسابه يُنشأ مع عيادة
 * is_active = FALSE، أي أنها لا تظهر للعامة ولا تقبل حجزاً. لذلك لا
 * يُعرض هذا الدبوس لأحد. الإحداثيات الحقيقية تُضبط عند تفعيل العيادة
 * (npm run approve-clinic -- <هاتف> --lat .. --lng ..).
 *
 * لا بدّ من هذا الحقل لأن عمودَي lat و lng في doctors مُعرَّفان NOT NULL،
 * فلا يمكن إنشاء صف عيادة بدونهما.
 */
const SETIF_CENTER = Object.freeze({ lat: 36.1898, lng: 5.4108 });

const COMMUNES = Object.freeze([
  { id: 'setif',       name: 'سطيف',      sortOrder: 1 },
  { id: 'eulma',       name: 'العلمة',    sortOrder: 2 },
  { id: 'ain_oulmene', name: 'عين ولمان', sortOrder: 3 },
  { id: 'ain_kebira',  name: 'عين الكبيرة', sortOrder: 4 },
  { id: 'bougaa',      name: 'بوقاعة',    sortOrder: 5 },
  { id: 'amoucha',     name: 'عموشة',     sortOrder: 6 },
]);

const SPECIALTIES = Object.freeze([
  { id: 'generaliste',   name: 'الطب العام والاستعجالي',   icon: 'activity',     sortOrder: 1 },
  { id: 'pediatrie',     name: 'طب الأطفال',              icon: 'baby',         sortOrder: 2 },
  { id: 'cardiologie',   name: 'أمراض القلب والشرايين',    icon: 'heart-pulse',  sortOrder: 3 },
  { id: 'dentaire',      name: 'طب وجراحة الأسنان',       icon: 'smile',        sortOrder: 4 },
  { id: 'gynecologie',   name: 'أمراض النساء والتوليد',    icon: 'female',       sortOrder: 5 },
  { id: 'orthopedie',    name: 'أمراض وجراحة العظام',      icon: 'bone',         sortOrder: 6 },
  { id: 'ophtalmologie', name: 'أمراض وجراحة العيون',      icon: 'eye',          sortOrder: 7 },
  { id: 'endocrinologie',name: 'أمراض الغدد والسكري',      icon: 'droplet',      sortOrder: 8 },
  { id: 'laboratoire',   name: 'مخابر التحاليل الطبية',   icon: 'flask-conical',sortOrder: 9 },
  { id: 'imagerie',       name: 'مراكز الأشعة والسكانير',  icon: 'scan',         sortOrder: 10 },
]);

/** أوقات الدوام الافتراضية لتوليد الخانات المتاحة */
const DEFAULT_WORK_WINDOW = Object.freeze({ start: '08:00', end: '16:30' });

/** لا يُسمح بالحجز في الماضي */
function isPast(dateStr, timeStr) {
  const target = new Date(`${dateStr}T${timeStr || '00:00'}`);
  if (Number.isNaN(target.getTime())) return true;
  return target.getTime() < Date.now();
}

/** يضيف _ar إلى كائن موعد لقادم من قاعدة البيانات */
function decorateAppointment(row) {
  const meta = APPOINTMENT_STATUS[row.status] || APPOINTMENT_STATUS.confirmed;
  return {
    ...row,
    price: row.price === null || row.price === undefined ? undefined : Number(row.price),
    rating: row.rating === null || row.rating === undefined ? undefined : Number(row.rating),
    status_ar: meta.ar,
    status_tone: meta.tone,
  };
}

module.exports = {
  APPOINTMENT_STATUS,
  APPOINTMENT_STATUS_KEYS,
  BLOCKING_STATUSES,
  ROLES,
  CLINIC_ROLES,
  SETIF_CENTER,
  COMMUNES,
  SPECIALTIES,
  DEFAULT_WORK_WINDOW,
  isPast,
  decorateAppointment,
};