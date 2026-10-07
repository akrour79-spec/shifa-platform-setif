/**
 * routes/appointments.js — حجز المواعيد وإدارتها (جانب المريض)
 * -----------------------------------------------------------------------------
 * عملية الحجز تجري داخل معاملة واحدة مع قفل صف الطبيب، لأننا نحتاج
 * شيئين ذريّين معاً:
 *   1) منع حجز نفس التوقيت مرتين  → فهرس فريد uniq_doctor_slot
 *   2) ترقيم الدور بالتسلسل       → COALESCE(MAX(queue_number),0)+1
 */

'use strict';

const express = require('express');
const db = require('../db');
const {
  bookAppointmentSchema, listAppointmentsSchema, updateAppointmentStatusSchema,
  formatZodError, doctorIdSchema, aptIdSchema, dateSchema,
} = require('../lib/validation');
const { authenticate, optionalAuth, asyncHandler } = require('../middleware/auth');
const { AppError } = require('../middleware/errors');
const { decorateAppointment, APPOINTMENT_STATUS, isPast } = require('../lib/constants');
const { parseWindow, toMinutes, generateSlots, isWorkingDay } = require('../lib/slots');
const { queueNotification, TEMPLATES, buildWhatsAppUrl } = require('../lib/notifications');

const router = express.Router();

/**
 * الحقول التي تُرجَع للمريض.
 * patient_id لا يُرجَع — معرّف داخلي لا داعي لعرضه.
 */
const APPOINTMENT_SELECT = `
  SELECT a.id, a.patient_id, a.doctor_id, a.patient_name, a.patient_phone,
         a.commune_id, a.appt_date, a.appt_time, a.status, a.queue_number,
         a.has_chifa, a.notes, a.created_at, a.updated_at,
         d.name AS doctor_name, d.title AS doctor_title, d.address AS clinic_address,
         d.lat, d.lng, s.name_ar AS specialty_name, c.name_ar AS commune_name
    FROM public.appointments a
    JOIN public.doctors     d ON d.id = a.doctor_id
    JOIN public.specialties s ON s.id = d.specialty_id
    JOIN public.communes    c ON c.id = d.commune_id
`;

const shape = (row) => {
  const { patient_id, ...rest } = decorateAppointment(row);
  // نُرجع الرقم بصيغة E.154 فقط إن كان صاحب الموعد هو نفسه
  return {
    ...rest,
    appt_date: formatDate(row.appt_date),
    appt_time: formatTime(row.appt_time),
  };
};

const formatDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));
const formatTime = (t) => (t instanceof Date ? t.toISOString().slice(0, 11) : String(t).slice(0, 5));

// ---------------------------------------------------------------------------
// POST /api/appointments — حجز موعد (يمكن للزائر، لكن للحساب تُملأ بياناته)
// ---------------------------------------------------------------------------
router.post('/', authenticate, asyncHandler(async (req, res) => {
  const parsed = bookAppointmentSchema.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest('بيانات الحجز غير صالحة', formatZodError(parsed.error).details);
  }

  const { doctorId, date, time, patientName, patientPhone, hasChifa, notes } = parsed.data;

  // تاريخ في الماضي → رفض فوري قبل لمس قاعدة البيانات
  if (isPast(date, time)) {
    throw AppError.badRequest('لا يمكن الحجز في وقت سابق. اختر موعداً مستقبلياً.');
  }

  const created = await db.transaction(async (client) => {
    // 1) قفل صف الطبيب: يضمن ألا يحجز مرضان على نفس الخانة في نفس اللحظة،
    //    ويمنع تصادم ترقيم الدور.
    const doctor = (
      await client.query(
        `SELECT id, name, work_hours, available_days, slot_minutes, is_active, accepting_bookings
           FROM public.doctors WHERE id = $1 FOR UPDATE`,
        [doctorId]
      )
    ).rows[0];

    if (!doctor) throw AppError.notFound('الطبيب غير موجود');
    if (!doctor.is_active) throw AppError.badRequest('هذا الطبيب غير متاح للحجز حالياً');
    if (doctor.accepting_bookings === false) {
      throw AppError.badRequest('اعتذار: العيادة متوقفة عن استقبال المواعيد حالياً (اكتمل العدد)');
    }

    // 2) يوم العمل: العيادة مغلقة الجمعة مثلاً. available_days كانت
    //    مخزَّنة ولا تُقرأ، فكان الحجز ممكناً في يوم راحة.
    if (!isWorkingDay(date, doctor.available_days)) {
      throw AppError.badRequest(
        `العيادة مغلقة في هذا اليوم (دوامها: ${doctor.available_days || 'غير محدد'}). اختر يوم عمل آخر.`
      );
    }

    // 3) الوقت ضمن دوام الطبيب (لا يكفي الاعتماد على توليد الواجهة)
    const { start, end } = parseWindow(doctor.work_hours);
    const t = toMinutes(time);
    if (t < toMinutes(start) || t + doctor.slot_minutes > toMinutes(end)) {
      throw AppError.badRequest(
        `الوقت المختار خارج دوام العمل (${doctor.work_hours}). اختر وقتاً داخل هذه الفترة.`
      );
    }

    // 3-bis) الوقت على شبكة الخانات: دوام 08:00-16:30 بخطوات 30 يعني
    //    08:00، 08:30 … و 08:15 غير موجود. بدون هذا يفتح باب لوقت
    //    بين الخانات ينتج موعدان متجاوران يتراكبان على بعضهما.
    const grid = generateSlots(doctor.work_hours, doctor.slot_minutes);
    if (!grid.includes(time)) {
      throw AppError.badRequest(
        `الوقت ${time} ليس ضمن خانات الحجز. الخانات كل ${doctor.slot_minutes} دقيقة.`
      );
    }

    // 4) الخانة محجوزة؟ الفهرس الفريد سيمنعها أيضاً — هذا فحص مبكر لرسالة أوضح
    const clash = (
      await client.query(
        `SELECT 1 FROM public.appointments
          WHERE doctor_id = $1 AND appt_date = $2 AND appt_time = $3 AND status <> 'cancelled'
          LIMIT 1`,
        [doctorId, date, time]
      )
    ).rows[0];

    if (clash) {
      throw new AppError(409, 'slot_taken',
        'هذا الموعد محجوز بالفعل. اختر وقتاً آخر من الخانات المتاحة.');
    }

    // 5) رقم الدور التالي لهذا الطبيب في هذا اليوم
    const { next_number } = (
      await client.query(
        `SELECT COALESCE(MAX(queue_number), 0) + 1 AS next_number
           FROM public.appointments
          WHERE doctor_id = $1 AND appt_date = $2`,
        [doctorId, date]
      )
    ).rows[0];

    // 6) الإدراج
    const row = (
      await client.query(
        `INSERT INTO public.appointments
           (patient_id, doctor_id, patient_name, patient_phone, appt_date, appt_time, queue_number, has_chifa, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, patient_id, doctor_id, patient_name, patient_phone, appt_date, appt_time,
                   status, queue_number, has_chifa, notes, created_at`,
        [
          req.user?.id ?? null, doctorId, patientName, patientPhone,
          date, time, next_number, hasChifa, notes ?? null,
        ]
      )
    ).rows[0];

    // 7) إدراج إشعار تأكيد فوري في طابور الإشعارات (WhatsApp & SMS)
    const msgText = TEMPLATES.confirmation({
      patientName,
      doctorName: doctor.name,
      doctorTitle: doctor.title,
      date,
      time,
      queueNumber: next_number,
      address: doctor.address,
    });

    await queueNotification({
      appointmentId: row.id,
      channel: 'whatsapp',
      recipientPhone: patientPhone,
      recipientName: patientName,
      message: msgText,
      scheduledFor: new Date(),
    }, client);

    const waUrl = buildWhatsAppUrl(patientPhone, msgText);

    return { appointment: row, doctorName: doctor.name, whatsappUrl: waUrl, messageText: msgText };
  });

  res.status(201).json({
    message: 'تم حجز الموعد بنجاح',
    appointment: {
      ...created.appointment,
      appt_date: date,
      appt_time: time,
      doctor_name: created.doctorName,
      status_ar: APPOINTMENT_STATUS.confirmed.ar,
      whatsapp_url: created.whatsappUrl,
      notification_text: created.messageText,
    },
  });
}));

// ---------------------------------------------------------------------------
// GET /api/appointments — مواعيد المستخدم الحالي
// scope=doctor يعرض مواعيد عيادة الطبيب (يتطلب حساب عيادة)
// ---------------------------------------------------------------------------
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const parsed = listAppointmentsSchema.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('معايير التصفية غير صالحة', formatZodError(parsed.error).details);

  const { date, from, to, status, scope, limit } = parsed.data;

  let rows;
  if (scope === 'doctor') {
    const clinic = await db.queryOne('SELECT id FROM public.doctors WHERE profile_id = $1', [req.user.id]);
    if (!clinic) throw new AppError(403, 'forbidden', 'هذا الحساب غير مرتبط بعيادة');

    const params = [clinic.id];
    const where = ['a.doctor_id = $1'];

    if (date) { params.push(date); where.push(`a.appt_date = $${params.length}`); }
    if (from) { params.push(from); where.push(`a.appt_date >= $${params.length}`); }
    if (to)   { params.push(to);   where.push(`a.appt_date <= $${params.length}`); }
    if (status) { params.push(status); where.push(`a.status = $${params.length}`); }

    params.push(limit);
    rows = await db.query(
      `${APPOINTMENT_SELECT} WHERE ${where.join(' AND ')}
        ORDER BY a.appt_date DESC, a.queue_number ASC LIMIT $${params.length}`,
      params
    );
  } else {
    const params = [req.user.id];
    const where = ['a.patient_id = $1'];

    if (date) { params.push(date); where.push(`a.appt_date = $${params.length}`); }
    if (from) { params.push(from); where.push(`a.appt_date >= $${params.length}`); }
    if (to)   { params.push(to);   where.push(`a.appt_date <= $${params.length}`); }
    if (status) { params.push(status); where.push(`a.status = $${params.length}`); }

    params.push(limit);
    rows = await db.query(
      `${APPOINTMENT_SELECT} WHERE ${where.join(' AND ')}
        ORDER BY a.appt_date DESC, a.queue_number ASC LIMIT $${params.length}`,
      params
    );
  }

  res.json({ appointments: rows.map(shape) });
}));

// ---------------------------------------------------------------------------
// GET /api/appointments/:id — موعد واحد (المريض صاحبه أو عيادة الطبيب)
// ---------------------------------------------------------------------------
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const id = aptIdSchema.safeParse(req.params.id);
  if (!id.success) throw AppError.notFound('الموعد غير موجود');

  const row = await db.queryOne(`${APPOINTMENT_SELECT} WHERE a.id = $1`, [id.data]);
  if (!row) throw AppError.notFound('الموعد غير موجود');

  const isOwner = row.patient_id === req.user.id;
  const isClinic = await db.queryOne(
    'SELECT 1 FROM public.doctors WHERE profile_id = $1 AND id = $2',
    [req.user.id, row.doctor_id]
  );

  if (!isOwner && !isClinic) throw AppError.forbidden('ليس من حقك عرض هذا الموعد');

  res.json({ appointment: shape(row) });
}));

// ---------------------------------------------------------------------------
// PATCH /api/appointments/:id/status — تغيير الحالة
// ---------------------------------------------------------------------------
router.patch('/:id/status', authenticate, asyncHandler(async (req, res) => {
  const id = aptIdSchema.safeParse(req.params.id);
  if (!id.success) throw AppError.notFound('الموعد غير موجود');

  const parsed = updateAppointmentStatusSchema.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('حالة غير صالحة', formatZodError(parsed.error).details);

  const { status } = parsed.data;

  const current = await db.queryOne(
    'SELECT id, patient_id, doctor_id, status FROM public.appointments WHERE id = $1',
    [id.data]
  );
  if (!current) throw AppError.notFound('الموعد غير موجود');

  const isOwner = current.patient_id === req.user.id;
  const clinic = await db.queryOne('SELECT id FROM public.doctors WHERE profile_id = $1', [req.user.id]);

  // المريض يستطيع الإلغاء فقط — لا يستطيع وضع نفسه "عند الطبيب"
  if (isOwner && !clinic) {
    if (status !== 'cancelled') {
      throw AppError.forbidden('يمكنك إلغاء الموعد فقط. تغييرات الحالة يقوم بها طاقم العيادة.');
    }
  } else if (!isOwner && !clinic) {
    throw AppError.forbidden('ليس من حقك تعديل هذا الموعد');
  }

  // التحقق من صحة الانتقال بين الحالات
  const meta = APPOINTMENT_STATUS[current.status];
  if (status !== current.status && meta && !meta.next.includes(status)) {
    throw AppError.conflict(
      `لا يمكن الانتقال من "${meta.ar}" إلى "${APPOINTMENT_STATUS[status]?.ar || status}"`,
      { from: current.status, allowed: meta.next }
    );
  }

  // التحديث داخل معاملة: نقرأ السطر الجديد بعد الكتابة مباشرة
  const row = await db.transaction(async (client) => {
    await client.query(
      'UPDATE public.appointments SET status = $2 WHERE id = $1',
      [id.data, status]
    );
    const { rows } = await client.query(`${APPOINTMENT_SELECT} WHERE a.id = $1`, [id.data]);
    return rows[0] || null;
  });

  res.json({ message: 'تم تحديث حالة الموعد', appointment: shape(row) });
}));

module.exports = router;