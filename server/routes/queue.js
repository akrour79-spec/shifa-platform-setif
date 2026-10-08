/**
 * routes/queue.js — نظام قاعة الانتظار الحية
 * -----------------------------------------------------------------------------
 * هذه الميزة هي ما يميّز شفاء عن المنافسين المحليين: شاشة عرض تُركَّب في
 * قاعة الانتظار، تستدعي المريض التالي بصوت مسموع.
 *
 * كل المسارات هنا تتطلب حساب عيادة (طبيب/سكرتير) — عدا شاشة العرض العامة
 * في أسفل الملف، لأن تركيب التلفزيون يتم من داخل العيادة ولا يحتاج حساباً.
 */

'use strict';

const express = require('express');
const db = require('../db');
const { authenticate, requireClinicRole, asyncHandler } = require('../middleware/auth');
const { AppError } = require('../middleware/errors');
const { APPOINTMENT_STATUS, decorateAppointment } = require('../lib/constants');
const { dateSchema, formatZodError } = require('../lib/validation');

const router = express.Router();

/** استرجاع عيادة الحساب — كل المسارات تبدأ من هنا */
async function requireClinic(req) {
  // نقرأ العيادة بصرف النظر عن حالة التفعيل، لأن الحالتين تعنيان
  // أشياء مختلفة تماماً للطبيب:
  //   غير موجودة  → حساب مُسجَّل بلا عيادة (خلل أو حساب قديم)
  //   معطّلة      → عيادة جديدة بانتظار مراجعة الإدارة (الوضع الطبيعي
  //                  بعد التسجيل مباشرةً)
  // الرسالة الموحّدة "غير مرتبط بعيادة نشطة" كانت تخلط بينهما، فيظن
  // الطبيب أنه اتّهم خطأً بينما هو ينتظر الموافقة فقط.
  const clinic = await db.queryOne(
    'SELECT id, name, work_hours, slot_minutes, is_active FROM public.doctors WHERE profile_id = $1',
    [req.user.id]
  );

  if (!clinic) {
    throw new AppError(403, 'no_clinic', 'هذا الحساب غير مرتبط بأي عيادة. تواصل مع الإدارة.');
  }
  if (!clinic.is_active) {
    throw new AppError(
      403,
      'clinic_pending',
      `عيادة "${clinic.name}" مسجّلة وبانتظار تفعيل الإدارة. ستصبح ظاهرة للمرضى وتستقبل الحجوزات بعد المراجعة.`
    );
  }

  return clinic;
}

const SHAPE = `
  SELECT a.id, a.doctor_id, a.patient_name, a.patient_phone, a.appt_date, a.appt_time,
         a.status, a.queue_number, a.has_chifa, a.created_at,
         d.name AS doctor_name
    FROM public.appointments a
    JOIN public.doctors d ON d.id = a.doctor_id
`;

const shapeRow = (row) => {
  const d = decorateAppointment(row);
  return {
    ...d,
    appt_date: row.appt_date instanceof Date ? row.appt_date.toISOString().slice(0, 10) : String(row.appt_date),
    appt_time: row.appt_time instanceof Date ? row.appt_time.toISOString().slice(0, 11) : String(row.appt_time).slice(0, 5),
  };
};

// ---------------------------------------------------------------------------
// إسقاط الشاشة العامة: الشاشة نقطة عمومية بلا دخول (للتلفزيون داخل العيادة)،
// فلا يجوز أن تسرّب بيانات المرضى. تُرجع فقط ما يحتاجه التلفزيون فعلاً:
// رقم الدور + الاسم الأول (للعرض والنطق الصوتي) + الحالة.
// رقم الهاتف الكامل والاسم الكامل لا يظهران أبداً هنا — لوحة الطبيب
// (المسارات المحمية) هي الوحيدة التي تراهما.
// ---------------------------------------------------------------------------
const maskNameForScreen = (fullName) => {
  const first = String(fullName || '').trim().split(/\s+/)[0];
  return first || 'مريض';
};

const shapeScreenRow = (shaped) => ({
  id: shaped.id,
  queue_number: shaped.queue_number,
  patient_name: maskNameForScreen(shaped.patient_name),
  appt_date: shaped.appt_date,
  appt_time: shaped.appt_time,
  status: shaped.status,
  status_ar: shaped.status_ar,
  status_tone: shaped.status_tone,
  doctor_name: shaped.doctor_name,
});

/** دالة مشتركة: تقرأ تاريخ اليوم (أو تاريخاً محدداً) وتتحقق منه */
function readDate(req) {
  const raw = req.query.date;
  if (!raw) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const parsed = dateSchema.safeParse(raw);
  if (!parsed.success) throw AppError.badRequest('التاريخ غير صالح', formatZodError(parsed.error).details);
  return parsed.data;
}

// ---------------------------------------------------------------------------
// GET /api/queue/screen?date=... — شاشة العرض (تعمل بدون تسجيل دخول)
// تُرجع فقط ما يُعرض على التلفزيون: رقم الدور، الاسم الأول (مقنّع)، الحالة.
// لا تُرجع أرقام الهواتف ولا الأسماء الكاملة أبداً — نقطة عمومية بلا دخول.
// ---------------------------------------------------------------------------
const queueScreenCache = new Map();
const queueScreenPending = new Map();
const QUEUE_SCREEN_CACHE_TTL = 3000; // 3 ثوانٍ تخزين مؤقت للضغط العالي

router.get('/screen', asyncHandler(async (req, res) => {
  const clinicId = req.query.doctorId;

  if (!clinicId) {
    throw AppError.badRequest('doctorId مطلوب لعرض شاشة الطابور');
  }

  const date = readDate(req);
  const cacheKey = `${clinicId}:${date}`;
  const now = Date.now();

  if (queueScreenCache.has(cacheKey)) {
    const entry = queueScreenCache.get(cacheKey);
    if (now - entry.timestamp < QUEUE_SCREEN_CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, max-age=3');
      return res.json(entry.payload);
    }
  }

  if (queueScreenPending.has(cacheKey)) {
    const data = await queueScreenPending.get(cacheKey);
    res.setHeader('Cache-Control', 'public, max-age=3');
    return res.json(data);
  }

  const fetchPromise = (async () => {
    try {
      const clinic = await db.queryOne(
        'SELECT id, name FROM public.doctors WHERE id = $1 AND is_active = TRUE',
        [clinicId]
      );
      if (!clinic) throw AppError.notFound('العيادة غير موجودة');

      const rows = await db.query(
        `${SHAPE}
          WHERE a.doctor_id = $1 AND a.appt_date = $2
            AND a.status IN ('confirmed','waiting','in_consultation')
          ORDER BY a.queue_number ASC`,
        [clinicId, date]
      );

      // إسقاط مقنّع للشاشة العامة: الاسم الأول فقط، بلا أرقام هواتف
      const appointments = rows.map(shapeRow).map(shapeScreenRow);

      const total = await db.queryOne(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'completed')::int  AS done,
                COUNT(*) FILTER (WHERE status = 'no_show')::int    AS missed
           FROM public.appointments
          WHERE doctor_id = $1 AND appt_date = $2 AND status <> 'cancelled'`,
        [clinicId, date]
      );

      const current = appointments.find((a) => a.status === 'in_consultation') || null;
      const next = appointments.find((a) => a.status === 'waiting') || null;
      const waitingCount = appointments.filter((a) => a.status === 'waiting' || a.status === 'confirmed').length;

      const payload = {
        clinic: { id: clinic.id, name: clinic.name },
        date,
        current,
        next,
        waitingCount,
        stats: {
          total: total.total,
          done: total.done,
          missed: total.missed,
          remaining: Math.max(0, total.total - total.done - total.missed),
        },
        appointments,
        refreshAfterSeconds: 15,
      };

      queueScreenCache.set(cacheKey, { timestamp: Date.now(), payload });
      return payload;
    } finally {
      queueScreenPending.delete(cacheKey);
    }
  })();

  queueScreenPending.set(cacheKey, fetchPromise);
  const payload = await fetchPromise;
  res.setHeader('Cache-Control', 'public, max-age=3');
  res.json(payload);
}));

// ---------------------------------------------------------------------------
// GET /api/queue — قائمة انتظار العيادة (لوحة الطبيب)
// ---------------------------------------------------------------------------
router.get('/', authenticate, requireClinicRole, asyncHandler(async (req, res) => {
  const clinic = await requireClinic(req);
  const date = readDate(req);

  const rows = await db.query(
    `${SHAPE}
      WHERE a.doctor_id = $1 AND a.appt_date = $2
      ORDER BY a.queue_number ASC`,
    [clinic.id, date]
  );

  res.json({ clinic, date, queue: rows.map(shapeRow) });
}));

// ---------------------------------------------------------------------------
// POST /api/queue/call-next — استدعاء المريض التالي
// ينقل التالي من "مؤكد" إلى "في قاعة الانتظار"، ثم إلى "عند الطبيب"
// إن لم يكن أحد قيد الفحص أصلاً.
// ---------------------------------------------------------------------------
router.post('/call-next', authenticate, requireClinicRole, asyncHandler(async (req, res) => {
  const clinic = await requireClinic(req);
  const date = readDate(req);

  const result = await db.transaction(async (client) => {
    await client.query('SELECT id FROM public.doctors WHERE id = $1 FOR UPDATE', [clinic.id]);

    // من هو قيد الفحص الآن؟
    const inRoom = (
      await client.query(
        `SELECT id, patient_name, queue_number
           FROM public.appointments
          WHERE doctor_id = $1 AND appt_date = $2 AND status = 'in_consultation'
          LIMIT 1`,
        [clinic.id, date]
      )
    ).rows[0];

    // المريض التالي في الطابور
    const next = (
      await client.query(
        `SELECT id, patient_name, patient_phone, queue_number
           FROM public.appointments
          WHERE doctor_id = $1 AND appt_date = $2
            AND status IN ('confirmed','waiting')
          ORDER BY queue_number ASC
          LIMIT 1`,
        [clinic.id, date]
      )
    ).rows[0];

    if (!next) return { called: null, previous: inRoom || null };

    // الحالة الجديدة: إن كان العيادة خالية → "عند الطبيب"، وإلا → "في قاعة الانتظار"
    const newStatus = inRoom ? 'waiting' : 'in_consultation';

    await client.query('UPDATE public.appointments SET status = $2 WHERE id = $1', [next.id, newStatus]);

    const row = (
      await client.query(`${SHAPE} WHERE a.id = $1`, [next.id])
    ).rows[0];

    return {
      called: shapeRow(row),
      previous: inRoom ? { ...inRoom, status_ar: APPOINTMENT_STATUS.in_consultation.ar } : null,
    };
  });

  if (!result.called) {
    return res.json({
      message: 'لا يوجد مرضى في الطابور حالياً',
      called: null,
      previous: result.previous,
    });
  }

  res.json({
    message: `تم استدعاء المريض رقم ${result.called.queue_number}`,
    called: result.called,
    previous: result.previous,
  });
}));

// ---------------------------------------------------------------------------
// POST /api/queue/call/:appointmentId — استدعاء مريض محدد بالرقم
// ---------------------------------------------------------------------------
router.post('/call/:appointmentId', authenticate, requireClinicRole, asyncHandler(async (req, res) => {
  const clinic = await requireClinic(req);

  const row = await db.queryOne(
    `SELECT id, patient_name, queue_number, status FROM public.appointments
      WHERE id = $1 AND doctor_id = $2`,
    [req.params.appointmentId, clinic.id]
  );
  if (!row) throw AppError.notFound('الموعد غير موجود في هذه العيادة');

  if (!['confirmed', 'waiting'].includes(row.status)) {
    throw AppError.conflict(
      `لا يمكن استدعاء هذا الموعد: حالته "${APPOINTMENT_STATUS[row.status]?.ar || row.status}"`
    );
  }

  const hasOtherInRoom = await db.queryOne(
    `SELECT 1 FROM public.appointments
      WHERE doctor_id = $1 AND appt_date = CURRENT_DATE
        AND status = 'in_consultation' AND id <> $2`,
    [clinic.id, row.id]
  );

  const newStatus = hasOtherInRoom ? 'waiting' : 'in_consultation';
  await db.query('UPDATE public.appointments SET status = $2 WHERE id = $1', [row.id, newStatus]);

  const updated = await db.queryOne(`${SHAPE} WHERE a.id = $1`, [row.id]);

  res.json({
    message: `تم استدعاء ${row.patient_name} — رقم ${row.queue_number}`,
    called: shapeRow(updated),
  });
}));

// ---------------------------------------------------------------------------
// POST /api/queue/complete/:appointmentId — إنهاء المعاينة
// ---------------------------------------------------------------------------
router.post('/complete/:appointmentId', authenticate, requireClinicRole, asyncHandler(async (req, res) => {
  const clinic = await requireClinic(req);

  const row = await db.queryOne(
    `SELECT id, status FROM public.appointments WHERE id = $1 AND doctor_id = $2`,
    [req.params.appointmentId, clinic.id]
  );
  if (!row) throw AppError.notFound('الموعد غير موجود في هذه العيادة');

  if (!['waiting', 'in_consultation'].includes(row.status)) {
    throw AppError.conflict('يمكن إنهاء معاينة مريض في قاعة الانتظار أو مع الطبيب فقط');
  }

  await db.query(`UPDATE public.appointments SET status = 'completed' WHERE id = $1`, [row.id]);

  res.json({ message: 'تم إنهاء المعاينة', appointmentId: row.id });
}));

// ---------------------------------------------------------------------------
// POST /api/queue/walk-in — مريض بدون موعد مسبق (عابر)
// يأخذ رقم الدور التالي مباشرة.
// ---------------------------------------------------------------------------
router.post('/walk-in', authenticate, requireClinicRole, asyncHandler(async (req, res) => {
  const clinic = await requireClinic(req);
  const date = readDate(req);

  const patientName = String(req.body?.patientName || '').trim();
  const patientPhone = String(req.body?.patientPhone || '').trim();

  if (patientName.length < 3 || patientPhone.length < 8) {
    throw AppError.badRequest('اسم المريض ورقم هاتفه مطلوبان');
  }

  // نتحقق من صحة الرقم بنفس قواعد الخادم
  const { normalizeAlgerianPhone } = require('../lib/phone');
  const phoneResult = normalizeAlgerianPhone(patientPhone);
  if (!phoneResult.ok) throw AppError.badRequest(phoneResult.reason);

  const created = await db.transaction(async (client) => {
    await client.query('SELECT id FROM public.doctors WHERE id = $1 FOR UPDATE', [clinic.id]);

    // لا تعطِ رقماً مضاعفاً لمريض مسجّل اليوم لنفس الطبيب
    const duplicate = (
      await client.query(
        `SELECT id, queue_number FROM public.appointments
          WHERE doctor_id = $1 AND appt_date = $2
            AND patient_phone = $3 AND status NOT IN ('cancelled','completed')
          LIMIT 1`,
        [clinic.id, date, phoneResult.e164]
      )
    ).rows[0];

    if (duplicate) {
      throw new AppError(409, 'already_registered',
        `هذا المريض مسجّل مسبقاً اليوم برقم ${duplicate.queue_number}`);
    }

    const { next_number } = (
      await client.query(
        `SELECT COALESCE(MAX(queue_number), 0) + 1 AS next_number
           FROM public.appointments WHERE doctor_id = $1 AND appt_date = $2`,
        [clinic.id, date]
      )
    ).rows[0];

    const row = (
      await client.query(
        `INSERT INTO public.appointments
           (patient_id, doctor_id, patient_name, patient_phone, appt_date, appt_time, queue_number, has_chifa, notes)
         VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, queue_number`,
        [
          clinic.id, patientName, phoneResult.e164, date,
          new Date().toTimeString().slice(0, 5), next_number,
          req.body?.hasChifa ?? true,
          'مريض عابر (بدون موعد مسبق)',
        ]
      )
    ).rows[0];

    return row;
  });

  // نضعه مباشرة في الانتظار
  await db.query(
    `UPDATE public.appointments SET status = 'waiting' WHERE id = $1`,
    [created.id]
  );

  const row = await db.queryOne(`${SHAPE} WHERE a.id = $1`, [created.id]);

  res.status(201).json({
    message: `تم تسجيل المريض برقم دور ${created.queue_number}`,
    walkIn: shapeRow(row),
  });
}));

// ---------------------------------------------------------------------------
// DELETE /api/queue/:appointmentId — إلغاء موعد من طرف العيادة
// ---------------------------------------------------------------------------
router.delete('/:appointmentId', authenticate, requireClinicRole, asyncHandler(async (req, res) => {
  const clinic = await requireClinic(req);

  const row = await db.queryOne(
    'SELECT id, status FROM public.appointments WHERE id = $1 AND doctor_id = $2',
    [req.params.appointmentId, clinic.id]
  );
  if (!row) throw AppError.notFound('الموعد غير موجود في هذه العيادة');
  if (row.status === 'completed') throw AppError.conflict('لا يمكن إلغاء معاينة مكتملة');

  await db.query(`UPDATE public.appointments SET status = 'cancelled' WHERE id = $1`, [row.id]);

  res.json({ message: 'تم إلغاء الموعد وتحرير الخانة' });
}));

module.exports = router;
// للاختبارات: نكشف دوال التقنيع دون تغيير شكل التصدير
module.exports.maskNameForScreen = maskNameForScreen;
module.exports.shapeScreenRow = shapeScreenRow;
