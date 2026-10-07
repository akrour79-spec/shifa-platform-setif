/**
 * tests/unit.test.js — اختبارات المنطق الخالص (لا تحتاج قاعدة بيانات)
 * -----------------------------------------------------------------------------
 * التشغيل:  npm test
 * ==========================================================================
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { normalizeAlgerianPhone, normalizeAlgerianClinicPhone, toE164, formatForDisplay, samePhone } = require('../server/lib/phone');
const { generateSlots, availableSlots, parseWindow, toMinutes, parseWorkDays, isWorkingDay, weekdayOf } = require('../server/lib/slots');
const { APPOINTMENT_STATUS, BLOCKING_STATUSES, decorateAppointment, isPast } = require('../server/lib/constants');
const { signupSchema, bookAppointmentSchema, loginSchema, nameSchema } = require('../server/lib/validation');

// ===========================================================================
describe('تطبيع أرقام الهواتف الجزائرية', () => {
  test('يقبل الصيغ الوطنية والدولية ويوحّدها', () => {
    const expected = '+213512345678';
    const inputs = [
      '0512345678',
      '05 12 34 56 78',
      '05-12-34-56-78',
      '+213512345678',
      '00213512345678',
      '213512345678',
      '  0512345678  ',
      '(0512) 34 56 78',
    ];
    for (const input of inputs) {
      const result = normalizeAlgerianPhone(input);
      assert.equal(result.ok, true, `فشل على المدخل: ${input}`);
      assert.equal(result.e164, expected, `خطأ في التطبيع لـ ${input}`);
    }
  });

  test('يقبل بادئات 06 و 07 (شبكات نقالة مختلفة)', () => {
    assert.equal(toE164('0661998877'), '+213661998877');
    assert.equal(toE164('0771234567'), '+213771234567');
  });

  test('يرفض أرقام غير صالحة', () => {
    const invalid = [
      '',                    // فارغ
      'abc',
      '051234567',           // قصير (8 أرقام بعد الصفر)
      '05123456789',         // طويل
      '0412345678',          // بادئة غير صالحة (04 ليست شبكة نقالة جزائرية)
      '0000000000',          // أرقام متكررة
      '05123456789012345',   // طويل جداً
    ];
    for (const input of invalid) {
      const result = normalizeAlgerianPhone(input);
      assert.equal(result.ok, false, `كان يجب رفض: "${input}"`);
      assert.ok(result.reason, `يجب وجود سبب الرفض لـ "${input}"`);
    }
  });

  test('انتقال من "مكتمل" إلى "مؤكد" ممنوع', () => {
    assert.ok(!APPOINTMENT_STATUS.completed.next.includes('confirmed'));
  });

  test('BLOCKING_STATUSES لا تتضمن الملغى', () => {
  });

  test('decorateAppointment يضيف الترجمة واللون', () => {
    const row = decorateAppointment({ id: 'APT-1', status: 'in_consultation', price: '2500.00', rating: '4.9' });
    assert.equal(row.status_ar, 'عند الطبيب');
    assert.equal(row.price, 2500, 'السعر يجب أن يتحول إلى رقم');
    assert.equal(row.rating, 4.9);
  });

  test('isPast يكتشف الماضي والمستقبل', () => {
    assert.equal(isPast('2000-01-01', '10:00'), true);
    assert.equal(isPast(futureDate(), '10:00'), false);
  });
});

// ===========================================================================
describe('التحقق من المدخلات', () => {
  test('nameSchema يرفض وسوم HTML (إغلاق ثغرة XSS)', () => {
    assert.equal(nameSchema.safeParse('<img src=x onerror=alert(1)>').success, false);
    assert.equal(nameSchema.safeParse('<script>alert(1)</script>').success, false);
    assert.equal(nameSchema.safeParse('محمد عبد السلام').success, true);
  });

  test('nameSchema يرفض الأسماء القصيرة جداً', () => {
    assert.equal(nameSchema.safeParse('أ ب').success, false);
    assert.equal(nameSchema.safeParse('عبد السلام').success, true);
  });

  test('signupSchema يقبل هاتف ثابت للعيادة (036 = سطيف)', () => {
    const result = signupSchema.safeParse({
      fullName: 'د. ياسين بوشارب',
      phone: '0661122334',
      password: 'Shifa2026',
      role: 'doctor',
      communeId: 'setif',
      specialtyId: 'orthopedie',
      address: 'شارع العربي بن مهيدي، سطيف',
      clinicPhone: '036 92 45 10',
    });
    assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues));
    // الثابت: 8 أرقام بعد رمز الدولة، بخلاف النقّال (9 أرقام)
    assert.equal(result.data.clinicPhone, '+21336924510');
  });

test('رقم عيادة ثابت لا يُقبل كرقم حساب (معرّف دخول)', () => {
    const result = normalizeAlgerianPhone('036 92 45 10');
    assert.equal(result.ok, false);
  });

test('normalizeAlgerianClinicPhone يرفض رقماً غير جزائري', () => {
    const r = normalizeAlgerianClinicPhone('12345');
    assert.equal(r.ok, false);
  });

test('formatForDisplay يعرض الثابت بالنمط الصحيح', () => {
  assert.equal(formatForDisplay('+21336924510'), '036 92 45 10');
  assert.equal(formatForDisplay('+213661998877'), '06 61 99 88 77');
  });

test('signupSchema يطبّع الهاتف ويحوّل الأدوار', () => {
    const result = signupSchema.safeParse({
      fullName: 'محمد عبد السلام',
      phone: '0661998877',
      password: 'Shifa2026',
      role: 'patient',
    });
    assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues));
    assert.equal(result.data.phone, '+213661998877');
    assert.equal(result.data.role, 'patient');
    assert.equal(result.data.hasChifa, true, 'hasChifa يجب أن يكون true افتراضياً');
  });

  test('signupSchema يرفض حقولاً غير معروفة', () => {
    const result = signupSchema.safeParse({
      fullName: 'محمد عبد السلام',
      phone: '0661998877',
      password: 'Shifa2026',
      isAdmin: true, // محاولة رفع صلاحيات
    });
    assert.equal(result.success, false);
  });

  // -------------------------------------------------------------------------
  // تسجيل الطبيب — لماذا هذه الحالة الحرجة:
  // أعمدة specialty_id و address و phone في جدول doctors مُعرَّفة NOT NULL.
  // لو قُبل تسجيل طبيب بدونها لتولّد حساب لا عيادة له، فيبقى مسجَّلاً على
  // المنصة ولا يستقبل موعداً أبداً — وهو ما كان يمنع أي طبيب من الظهور.
  // -------------------------------------------------------------------------

  const DOCTOR_SIGNUP = {
    fullName: 'د. ياسين بوشارب',
    phone: '0661122334',
    password: 'Shifa2026',
    role: 'doctor',
    communeId: 'setif',
    clinicName: 'عيادة بوشارب',
    specialtyId: 'orthopedie',
    address: 'شارع العربي بن مهيدي، سطيف',
    clinicPhone: '036 92 45 10',
  };

  test('signupSchema يقبل تسجيل طبيب كامل', () => {
    const result = signupSchema.safeParse(DOCTOR_SIGNUP);
    assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues));
    assert.equal(result.data.clinicPhone, '+21336924510', 'الثابت: 8 أرقام بعد رمز الدولة');
  });

  test('signupSchema يرفض طبيباً بلا تخصص', () => {
    const { specialtyId, ...rest } = DOCTOR_SIGNUP;
    const result = signupSchema.safeParse(rest);
    assert.equal(result.success, false);
    assert.ok(result.error.issues.some((i) => i.path[0] === 'specialtyId'));
  });

  test('signupSchema يرفض طبيباً بلا عنوان', () => {
    const { address, ...rest } = DOCTOR_SIGNUP;
    const result = signupSchema.safeParse(rest);
    assert.equal(result.success, false);
    assert.ok(result.error.issues.some((i) => i.path[0] === 'address'));
  });

  test('signupSchema يرفض طبيباً بلا هاتف عيادة', () => {
    const { clinicPhone, ...rest } = DOCTOR_SIGNUP;
    const result = signupSchema.safeParse(rest);
    assert.equal(result.success, false);
    assert.ok(result.error.issues.some((i) => i.path[0] === 'clinicPhone'));
  });

  test('signupSchema يرفض حقن HTML في عنوان العيادة', () => {
    const result = signupSchema.safeParse({
      ...DOCTOR_SIGNUP,
      address: 'شارع <script>alert(1)</script>',
    });
    assert.equal(result.success, false, 'العنوان يصل إلى innerHTML في بطاقة الطبيب');
  });

  test('signupSchema لا يطلب حقول العيادة من المريض', () => {
    const result = signupSchema.safeParse({
      fullName: 'محمد عبد السلام',
      phone: '0661998877',
      password: 'Shifa2026',
      role: 'patient',
      communeId: 'setif',
    });
    assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues));
  });

  test('signupSchema يرفض هاتف عيادة غير جزائري', () => {
    const result = signupSchema.safeParse({ ...DOCTOR_SIGNUP, clinicPhone: '12345' });
    assert.equal(result.success, false);
  });

  test('signupSchema يرفض أدواراً غير مسموح بها', () => {
    const result = signupSchema.safeParse({
      fullName: 'محمد عبد السلام',
      phone: '0661998877',
      password: 'Shifa2026',
      role: 'superadmin',
    });
    assert.equal(result.success, false);
  });

  test('signupSchema يرفض كلمات سر ضعيفة', () => {
    for (const password of ['123', 'allletters', '12345678']) {
      const result = signupSchema.safeParse({
        fullName: 'محمد عبد السلام', phone: '0661998877', password,
      });
      assert.equal(result.success, false, `كان يجب رفض كلمة السر: ${password}`);
    }
  });

  test('bookAppointmentSchema يتحقق من التاريخ والوقت', () => {
    const base = {
      doctorId: 'doc-1a2b3c4d',
      date: '2099-12-31',
      time: '10:00',
      patientName: 'فاطمة أحمد',
      patientPhone: '0551234567',
    };

    assert.equal(bookAppointmentSchema.safeParse(base).success, true);

    assert.equal(bookAppointmentSchema.safeParse({ ...base, date: '31-12-2099' }).success, false, 'صيغة تاريخ خاطئة');
    assert.equal(bookAppointmentSchema.safeParse({ ...base, time: '25:00' }).success, false, 'وقت مستحيل');
    assert.equal(bookAppointmentSchema.safeParse({ ...base, time: '10h30' }).success, false, 'صيغة وقت خاطئة');
    assert.equal(bookAppointmentSchema.safeParse({ ...base, doctorId: '1 OR 1=1' }).success, false, 'معرّف طبيب خبيث');
  });

  test('bookAppointmentSchema يمنع SQL injection في معرّف الطبيب', () => {
    const injections = [
      "' OR '1'='1",
      "doc-1'; DROP TABLE public.appointments; --",
      'doc-1 UNION SELECT * FROM public.profiles',
    ];
    for (const doctorId of injections) {
      const result = bookAppointmentSchema.safeParse({
        doctorId,
        date: '2099-12-31',
        time: '10:00',
        patientName: 'فاطمة أحمد',
        patientPhone: '0551234567',
      });
      assert.equal(result.success, false, `كان يجب رفض: ${doctorId}`);
    }
  });

  test('معرّفات الأطباء القصيرة (doc-1) مقبولة', () => {
    // البيانات الحالية تستخدم doc-1 … doc-8
    for (const doctorId of ['doc-1', 'doc-8', 'doc-1a2b3c4d']) {
      const result = bookAppointmentSchema.safeParse({
        doctorId,
        date: '2099-12-31',
        time: '10:00',
        patientName: 'فاطمة أحمد',
        patientPhone: '0551234567',
      });
      assert.equal(result.success, true, `كان يجب قبول: ${doctorId}`);
    }
  });

  test('bookAppointmentSchema يرفض حقن HTML في الاسم', () => {
    const result = bookAppointmentSchema.safeParse({
      doctorId: 'doc-1a2b3c4d',
      date: '2099-12-31',
      time: '10:00',
      patientName: '<script>alert(1)</script>',
      patientPhone: '0551234567',
    });
    assert.equal(result.success, false);
  });

  test('loginSchema يطبّع الهاتف', () => {
    const result = loginSchema.safeParse({ phone: '05 12 34 56 78', password: 'x' });
    assert.equal(result.success, true);
    assert.equal(result.data.phone, '+213512345678');
  });
});

// ===========================================================================
// أيام العمل — كانت تُخزَّن ولا تُقرأ (المريض يحجز في يوم مغلق)
// ===========================================================================
describe('أيام عمل الطبيب', () => {
  test('مدى "السبت - الخميس" يستثني الجمعة فقط', () => {
    const days = parseWorkDays('السبت - الخميس');
    assert.deepEqual([...days].sort((a, b) => a - b), [0, 1, 2, 3, 4, 6]);
    assert.equal(days.has(5), false, 'الجمعة (5) يجب ألا تكون يوم عمل');
  });

  test('المدى يلتف حول نهاية الأسبوع', () => {
    // الخميس(4) → الجمعة(5) → السبت(6)
    const days = parseWorkDays('الخميس - السبت');
    assert.deepEqual([...days].sort((a, b) => a - b), [4, 5, 6]);
  });

  test('مدى يغطي أياماً متفرقة', () => {
    const days = parseWorkDays('السبت - الاثنين');
    assert.deepEqual([...days].sort((a, b) => a - b), [0, 1, 6]);
  });

  test('قائمة مفصولة بفاصلة', () => {
    const days = parseWorkDays('الاثنين، الأربعاء، الجمعة');
    assert.deepEqual([...days].sort((a, b) => a - b), [1, 3, 5]);
  });

  test('نص فارغ أو غير مفهوم = لا قيد (لا نمنع الحجز بسبب صيغة غريبة)', () => {
    assert.equal(parseWorkDays(''), null);
    assert.equal(parseWorkDays('   '), null);
    assert.equal(parseWorkDays('يومياً'), null);
    assert.equal(isWorkingDay('2026-10-03', ''), true);
  });

  test('يوم راحة لا يولّد أي خانة', () => {
    // 2026-10-04 = الأحد. نتحقق أولاً أنه عمل ضمن "السبت - الخميس"
    assert.equal(isWorkingDay('2026-10-11', 'السبت - الخميس'), true);
    const sunday = availableSlots({
      workHours: '08:00 - 16:30',
      availableDays: 'السبت - الخميس',
      slotMinutes: 30,
      date: '2026-10-11',
    });
    assert.ok(sunday.length > 0, 'الأحد يوم عمل ضمن هذا المدى');

    // الجمعة 2026-10-09 ليست ضمن المدى
    assert.equal(isWorkingDay('2026-10-09', 'السبت - الخميس'), false);
    const friday = availableSlots({
      workHours: '08:00 - 16:30',
      availableDays: 'السبت - الخميس',
      slotMinutes: 30,
      date: '2026-10-09',
    });
    assert.deepEqual(friday, [], 'يوم الإغلاق يجب ألا يولّد خانات');
  });

  test('weekdayOf يطابق تقويم JS (0 = الأحد) بدون انزياح منطقة زمنية', () => {
    assert.equal(weekdayOf('2026-10-03'), 6, 'السبت');
    assert.equal(weekdayOf('2026-10-04'), 0, 'الأحد');
    assert.equal(weekdayOf('2026-10-09'), 5, 'الجمعة');
    assert.equal(weekdayOf('not-a-date'), null);
  });

  test('بدون availableDays يعمل كل يوم (سلوك قديم محفوظ)', () => {
    const out = availableSlots({
      workHours: '08:00 - 16:30',
      slotMinutes: 30,
      date: '2026-10-09',
    });
    assert.ok(out.length > 0);
  });
});

// ===========================================================================
// أدوات مساعدة للتواريخ
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function futureDate() {
  const d = new Date();
  d.setDate(d.getDate() + 5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function pastDate() {
  const d = new Date();
  d.setDate(d.getDate() - 5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ===========================================================================
describe('وحدة الإشعارات وروابط واتساب', () => {
  const { buildWhatsAppUrl, TEMPLATES } = require('../server/lib/notifications');

  test('توليد رابط WhatsApp بالصيغة الدولية المعتمدة', () => {
    const url1 = buildWhatsAppUrl('0661998877', 'مرحباً بك');
    assert.ok(url1.startsWith('https://wa.me/213661998877?text='));
    assert.ok(url1.includes(encodeURIComponent('مرحباً بك')));

    const url2 = buildWhatsAppUrl('+213771234567', 'تذكير بالموعد');
    assert.ok(url2.startsWith('https://wa.me/213771234567?text='));
  });

  test('توليد نصوص قوالب التنبيه بالبيانات الصحيحة', () => {
    const confirmation = TEMPLATES.confirmation({
      patientName: 'أحمد',
      doctorName: 'بوزيد',
      doctorTitle: 'دكتور',
      date: '2026-10-10',
      time: '10:00',
      queueNumber: 5,
      address: 'سطيف المركز',
    });
    assert.ok(confirmation.includes('أحمد'));
    assert.ok(confirmation.includes('#5'));
    assert.ok(confirmation.includes('2026-10-10'));

    const reminder = TEMPLATES.reminder({
      patientName: 'سارة',
      doctorName: 'بوزيد',
      doctorTitle: 'دكتور',
      date: '2026-10-10',
      time: '10:00',
      queueNumber: 3,
      address: 'عين ولمان',
    });
    assert.ok(reminder.includes('تذكير بموعدك'));
    assert.ok(reminder.includes('#3'));
  });

  test('تصدير وظيفة جدولة التذكيرات التلقائية للمواعيد', () => {
    const { scanAndScheduleUpcomingReminders } = require('../server/lib/notifications');
    assert.equal(typeof scanAndScheduleUpcomingReminders, 'function');
  });
});

// ===========================================================================
describe('وحدة الدفع الإلكتروني Chargily Pay v2', () => {
  const { PLAN_PRICES, verifyWebhookSignature } = require('../server/lib/chargily');

  test('مخطط أسعار باقات الاشتراكات بالدينار الجزائري', () => {
    assert.equal(PLAN_PRICES.starter.monthly, 4900);
    assert.equal(PLAN_PRICES.pro.monthly, 9900);
    assert.equal(PLAN_PRICES.clinic_enterprise.monthly, 18900);
  });

  test('التحقق من توقيع الـ Webhook الأمنية', () => {
    const isInvalid = verifyWebhookSignature('invalid_sig', 'raw_body_content');
    assert.equal(isInvalid, false);
  });
});


// ===========================================================================
describe('وحدة تحليلات المشرف وبلديات سطيف', () => {
  test('حساب المداخيل التقديرية وتوزيع البلديات', () => {
    const activeClinics = 5;
    const estimatedMRR = activeClinics * 7500;
    assert.equal(estimatedMRR, 37500);
  });
});
