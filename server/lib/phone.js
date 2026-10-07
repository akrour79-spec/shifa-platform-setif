/**
 * lib/phone.js — تطبيع أرقام الهواتف الجزائرية
 * -----------------------------------------------------------------------------
 * نوعان مختلفان في الجزائر، وخلطهما خطأ شائع:
 *
 *   الهاتف النقال   0 5|6|7 + 8 أرقام   = 10 أرقام وطنياً
 *                    0661998877   →   +213661998877  (9 أرقام بعد رمز الدولة)
 *
 *   الهاتف الثابت   0 3|4 + 7 أرقام      = 9 أرقام وطنياً
 *                    036 92 45 10 →   +21336924510   (8 أرقام بعد رمز الدولة)
 *
 * لماذا الفصل بينهما مهم هنا: عيادات سطيف تعلن أرقاماً ثابتة (036 لمركز
 * سطيف، 037 للعلمة)، وحقل هاتف العيادة يجب أن يقبلها. كان التطبيع القديم
 * يرفضها رغم أن تعليق هذا الملف يزعم أنه يقبلها، أي أن نصف أرقام دليل
 * الأطباء المعلن في المنصة كان غير قابل للتسجيل أصلاً.
 *
 * ملاحظة على الصيغ: كل المدخلات تُحوَّل أولاً إلى "أرقام وطنية"
 * (بصفر بادئ، بلا رمز دولة، بلا مسافات)، ثم يُصنَّف النوع من الطول
 * ومن الرقم الثالث. هذا يوحّد كل الصيغ — 213... و +213... و 00213...
 * و 066... و 661... — في مسار واحد بدل سلسلة شروط متضاربة.
 */
'use strict';
const ALGERIA_CC = '213';
/** بادئات الهواتف النقالة في الجزائر */
const MOBILE_PREFIXES = ['5', '6', '7'];
/** بادئات الهواتف الثابتة: 03 للشرق ووسط الجزائر، 04 للهضاب العليا */
const LANDLINE_PREFIXES = ['3', '4'];
/** عدد الأرقام بعد رمز الدولة في كل نوع (بلا الصفر البادئ) */
const LOCAL_LENGTH = { mobile: 9, landline: 8 };
/**
 * يحوّل أي صيغة مدخلات إلى أرقام وطنية: صفر بادئ + أرقام، بلا رمز دولة.
 *   "0661998877"     → "0661998877"
 *   "+213661998877"  → "0661998877"
 *   "00213661998877" → "0661998877"
 *   "661998877"      → "0661998877"   (محلي بلا صفر)
 *   "036 92 45 10"   → "036924510"
 *
 * @param {*} input
 * @returns {string} سلسلة أرقام وطنية، أو سلسلة فارغة إن لم يوجد رقم
 */
function toNationalDigits(input) {
  let digits = String(input == null ? '' : input).replace(/[^\d]/g, '');
  if (!digits) return '';
  // بادئة 00 الدولية
  if (digits.startsWith('00')) digits = digits.slice(2);
  // رمز الدولة: الصيغة الدولية بلا صفر بائد، فنعيده
  if (digits.startsWith(ALGERIA_CC)) {
    const rest = digits.slice(ALGERIA_CC.length);
    return rest.length ? `0${rest}` : '';
  }
  if (digits.startsWith('0')) return digits;
  // محلي بلا صفر: المطابقة على الطول تميّز النقّال عن الثابت
  if (digits.length === LOCAL_LENGTH.mobile && MOBILE_PREFIXES.includes(digits[0])) {
    return `0${digits}`;
  }
  if (digits.length === LOCAL_LENGTH.landline && LANDLINE_PREFIXES.includes(digits[0])) {
    return `0${digits}`;
  }
  return digits;
}
/**
 * يصنّف رقماً جزائرياً بعد تحويله إلى أرقام وطنية.
 * @returns {{ ok: true, kind: 'mobile'|'landline', national: string, e164: string }
 *         | { ok: false, reason: string }}
 */
function classifyAlgerianNumber(input, label) {
  const what = label || 'رقم الهاتف';
  const national = toNationalDigits(input);
  if (!national) {
    return { ok: false, reason: `${what} مطلوب` };
  }
  const local = national.slice(1); // بلا الصفر البادئ
  const prefix = local[0];
  if (MOBILE_PREFIXES.includes(prefix) && local.length === LOCAL_LENGTH.mobile) {
    if (/^(\d)\1{8}$/.test(local)) {
      return { ok: false, reason: `${what} غير صالح: أرقام متكررة` };
    }
    return { ok: true, kind: 'mobile', national, e164: `+${ALGERIA_CC}${local}` };
  }
  if (LANDLINE_PREFIXES.includes(prefix) && local.length === LOCAL_LENGTH.landline) {
    if (/^(\d)\1{7}$/.test(local)) {
      return { ok: false, reason: `${what} غير صالح: أرقام متكررة` };
    }
    return { ok: true, kind: 'landline', national, e164: `+${ALGERIA_CC}${local}` };
  }
  return {
    ok: false,
    reason:
      `${what} غير صالح. مثال على نقّال: 0661234567 — ` +
      'ومثال على هاتف ثابت للعيادة: 036 92 45 10',
  };
}
/**
 * تطبيع رقم الهاتف الشخصي — نقّال فقط.
 * السبب: هذا الرقم معرّف دخول. قبول رقم ثابت هنا يعني أن شخصاً قد
 * يسجّل حساباً برقم لا يملكه.
 *
 * @param {string} input
 * @returns {{ ok: true, e164: string } | { ok: false, reason: string }}
 */
function normalizeAlgerianPhone(input) {
  const result = classifyAlgerianNumber(input, 'رقم الهاتف');
  if (!result.ok) {
    if (result.reason.includes('ثابت')) {
      return {
        ok: false,
        reason: 'رقم الحساب يجب أن يكون نقّالاً (05 أو 06 أو 07). هاتف العيادة الثابت يُسجَّل في خانة هاتف العيادة.',
      };
    }
    return result;
  }
  if (result.kind !== 'mobile') {
    return {
      ok: false,
      reason: 'رقم الحساب يجب أن يكون نقّالاً (05 أو 06 أو 07). هاتف العيادة الثابت يُسجَّل في خانة هاتف العيادة.',
    };
  }
  return { ok: true, e164: result.e164 };
}
/**
 * رقم هاتف عيادة — نقّال أو ثابت.
 * ---------------------------------------------------------------------------
 * حدّ منفصل عن تطبيع الهاتف الشخصي عن قصد: رقم العيادة يُعرض على
 *
 * @param {string} input
 * @returns {{ ok: true, e164: string, mobile: boolean } | { ok: false, reason: string }}
 */
function normalizeAlgerianClinicPhone(input) {
  const result = classifyAlgerianNumber(input, 'هاتف العيادة');
  if (!result.ok) return result;
  return { ok: true, e164: result.e164, mobile: result.kind === 'mobile' };
}
/** نسخة صامتة من تطبيع الهاتف الشخصي، ترجع null عند الفشل */
function toE164(input) {
  const result = normalizeAlgerianPhone(input);
  return result.ok ? result.e164 : null;
}
/** نسخة صامتة من تطبيع هاتف العيادة، ترجع null عند الفشل */
function toClinicE164(input) {
  const result = normalizeAlgerianClinicPhone(input);
  return result.ok ? result.e164 : null;
}
/**
 * تنسيق للعرض بصيغة وطنية مقروءة.
 *   0661998877   →  06 61 99 88 77
 *   036 92 45 10 →  036 92 45 10
 * Anything unrecognised is returned unchanged rather than mangled.
 */
function formatForDisplay(value) {
  const national = toNationalDigits(value);
  if (!national.startsWith('0')) return String(value || '');
  const local = national.slice(1);
  if (local.length === LOCAL_LENGTH.mobile) {
    return `0${local[0]} ${local.slice(1, 3)} ${local.slice(3, 5)} ${local.slice(5, 7)} ${local.slice(7)}`;
  }
  if (local.length === LOCAL_LENGTH.landline) {
    return `0${local.slice(0, 2)} ${local.slice(2, 4)} ${local.slice(4, 6)} ${local.slice(6)}`;
  }
  return String(value || '');
}
/**
 * مقارنة سريعة بين رقمين بصيغ مختلفة — تُستعمل للتحقق من ملكية الحساب
 * (هل هذا الرقم هو نفسه الذي سجّل به؟)
 */
function samePhone(a, b) {
  const x = toE164(a);
  const y = toE164(b);
  return Boolean(x && y && x === y);
}
module.exports = {
  normalizeAlgerianPhone,
  normalizeAlgerianClinicPhone,
  classifyAlgerianNumber,
  toNationalDigits,
  toE164,
  toClinicE164,
  formatForDisplay,
  samePhone,
  ALGERIA_CC,
  MOBILE_PREFIXES,
  LANDLINE_PREFIXES,
};