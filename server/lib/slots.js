/**
 * lib/slots.js — توليد أوقات الحجز المتاحة
 * -----------------------------------------------------------------------------
 * منطق خالص (بلا قاعدة بيانات) فيسهل اختباره. الخانات المحجوزة تُمرَّر
 * من الخارج كمجموعة، والدالة تعيد المتاح فقط.
 */

'use strict';

const { DEFAULT_WORK_WINDOW, isPast } = require('./constants');

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** يحلّل "08:00 - 16:30" إلى { start, end } بالدقائق منذ منتصف الليل */
function parseWindow(workHours) {
  const raw = typeof workHours === 'string' ? workHours : '';
  const parts = raw.split('-').map((s) => s.trim());

  const start = TIME_RE.test(parts[0]) ? parts[0] : DEFAULT_WORK_WINDOW.start;
  const end = parts[1] && TIME_RE.test(parts[1]) ? parts[1] : DEFAULT_WORK_WINDOW.end;

  return { start, end };
}

/**
 * أيام الأسبوع بالعربية → رقم JS (0 = الأحد).
 * ---------------------------------------------------------------------------
 * الترتيب هنا يختلف عن ترتيب JS: JS يبدأ بالأحد، وهذا هو المتعارف عليه
 * في العيادات الجزائرية ("السبت - الخميس")، فنعكسه يدوياً.
 */
const DAY_NAMES = Object.freeze({
  'الأحد': 0,
  'الاثنين': 1,
  'الثلاثاء': 2,
  'الأربعاء': 3,
  'الخميس': 4,
  'الجمعة': 5,
  'السبت': 6,
});

/** يوحّد صيغة اسم اليوم: يتجاهل التشكيل و"ال" الزائدة ("السبت" = "سبت") */
function normalizeDayName(token) {
  let t = String(token || '').trim();
  t = t.replace(/^ال(?=.{2,})/, '');   // "الأحد" -> "أحد"
  t = t.replace(/[\u064B-\u0652\u0640]/g, ''); // تشكيل وتطويل
  t = t.trim();
  return Object.prototype.hasOwnProperty.call(DAY_NAMES, 'ال' + t) ? 'ال' + t : t;
}

/**
 * يحوّل نص "أيام العمل" إلى مجموعة أرقام أيام JS.
 * يدعم صيغتين:
 *   • مدى:      "السبت - الخميس"  ← السبت(6) → الأحد(0) … الخميس(4)، الجمعة(5) مستثناة
 *   • قائمة:    "السبت، الأحد"    ← يومان فقط
 *
 * المدى يلتف حول نهاية الأسبوع: "الخميس - السبت" يعني 4،5،6 لا 4،5.
 * النص الفارغ أو غير المفهوم ← كل الأيام (لا نمنع الحجز بسبب صيغة غريبة).
 */
function parseWorkDays(availableDays) {
  const raw = typeof availableDays === 'string' ? availableDays.trim() : '';
  if (!raw) return null; // null = لا قيد

  const hasRange = /\s[-–—]\s/.test(raw) || /^ال\S+\s*[-–—]\s*ال\S+$/.test(raw.replace(/\s+/g, ' ').trim());

  if (hasRange) {
    const [rawFrom, rawTo] = raw.split(/\s*[-–—]\s*/);
    const from = DAY_NAMES[normalizeDayName(rawFrom)];
    const to = DAY_NAMES[normalizeDayName(rawTo)];
    if (from === undefined || to === undefined) return null;

    const days = new Set();
    // نكرّر 7 مرات كحد أقصى للتعامل مع التفاف المدى (6 → 4 مثلاً)
    let d = from;
    for (let i = 0; i <= 7 && d !== to; i++) {
      days.add(d);
      d = (d + 1) % 7;
    }
    days.add(to);
    return days;
  }

  const listed = raw
    .split(/[،,]|\s+و\s+|\+/)
    .map(normalizeDayName)
    .filter(Boolean)
    .map((n) => DAY_NAMES[n])
    .filter((n) => n !== undefined);

  return listed.length ? new Set(listed) : null;
}

/** رقم اليوم (0=الأحد) لتاريخ YYYY-MM-DD — بدون انزياح منطقة زمنية */
function weekdayOf(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d.getDay();
}

/** هل يعمل الطبيب في هذا اليوم؟ null (بلا قيد) = نعم دائماً */
function isWorkingDay(dateStr, availableDays) {
  const days = availableDays instanceof Set ? availableDays : parseWorkDays(availableDays);
  if (!days) return true;
  const wd = weekdayOf(dateStr);
  if (wd === null) return true;
  return days.has(wd);
}

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const toHHMM = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/**
 * توليد كل الخانات النظرية خلال دوام الطبيب.
 * @returns {string[]} مثل ["08:00","08:30","09:00", ...]
 */
function generateSlots(workHours, slotMinutes = 30) {
  const { start, end } = parseWindow(workHours);
  const step = Math.max(5, Math.min(240, Number(slotMinutes) || 30));

  const startMin = toMinutes(start);
  const endMin = toMinutes(end);
  if (endMin <= startMin) return [];

  const slots = [];
  // نستثني الخانة الأخيرة إن كانت تتجاوز نهاية الدوام
  for (let t = startMin; t + step <= endMin; t += step) {
    slots.push(toHHMM(t));
  }
  return slots;
}

/**
 * الخانات المتاحة فعلياً = النظرية − المحجوزة − المنتهية − أيام الإغلاق.
 *
 * @param {object}   opts
 * @param {string}   opts.workHours    "08:00 - 16:30"
 * @param {number}   opts.slotMinutes  مدة الخانة بالدقائق
 * @param {string}   opts.date         التاريخ بصيغة YYYY-MM-DD
 * @param {string[]} opts.bookedTimes  الأوقات المحجوزة (HH:MM)
 * @param {number}   [opts.leadMinutes نافذة إيقاف الحجز قبل الموعد]
 * @param {string}   [opts.availableDays "السبت - الخميس"]
 *
 * ملاحظة: أيام الإغلاق كانت تُخزَّن في القاعدة ولا تُقرأ أبداً، فكان
 * المريض يجد خانات يوم الجمعة للعيادة المغلقة يومياً. الآن تُطبَّق.
 */
function availableSlots({ workHours, slotMinutes, date, bookedTimes = [], leadMinutes = 0, availableDays }) {
  const all = generateSlots(workHours, slotMinutes);
  if (!date) return all;

  // يوم راحة ← لا خانات إطلاقاً
  if (!isWorkingDay(date, availableDays)) return [];

  const booked = new Set(bookedTimes);
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

  return all.filter((slot) => {
    if (booked.has(slot)) return false;

    const slotMin = toMinutes(slot);

    // خانات اليوم الماضي منتهية دائماً
    if (isPast(date, slot)) return false;

    // نافذة الإيقاف: لا نُظهر خانة قريبة جداً من الآن (تُستعمل للحالات الاستعجالية)
    if (dateIsToday(date) && slotMin - nowMin < leadMinutes) return false;

    return true;
  });
}

function dateIsToday(dateStr) {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return dateStr === `${y}-${m}-${d}`;
}

/** تواريخ الأيام المتاحة للاختيار (اليوم + عدد أيام) بصيغة YYYY-MM-DD */
function upcomingDates(days = 14, from = new Date()) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    // ننسّق بالتوقيت المحلي لا ISO/UTC، لأن الجزائر UTC+1 و toISOString
    // كان سيزيح التاريخ عند منتصف الليل.
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

module.exports = {
  parseWindow,
  generateSlots,
  availableSlots,
  upcomingDates,
  parseWorkDays,
  isWorkingDay,
  weekdayOf,
  toMinutes,
  toHHMM,
  dateIsToday,
};