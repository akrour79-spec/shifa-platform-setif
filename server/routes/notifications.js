/**
 * routes/notifications.js — واجهة برمجة إدارة الإشعارات وتوليد روابط WhatsApp
 * -----------------------------------------------------------------------------
 * توفّر للواجهة وللوحة المشرف/الطبيب:
 *   - GET  /api/notifications               استعراض سجل طابور الإشعارات
 *   - POST /api/notifications/process       تفريغ ومعالجة طابور الإشعارات المعلقة
 *   - POST /api/notifications/whatsapp-link توليد رابط WhatsApp فوري لموعد مع رسالة منسّقة
 */

'use strict';

const express = require('express');
const db = require('../db');
const { optionalAuth, authenticate, asyncHandler } = require('../middleware/auth');
const { AppError } = require('../middleware/errors');
const {
  TEMPLATES,
  buildWhatsAppUrl,
  queueNotification,
  processPendingNotifications,
  scanAndScheduleUpcomingReminders,
  listNotifications,
} = require('../lib/notifications');
const { aptIdSchema } = require('../lib/validation');

const router = express.Router();

/**
 * GET /api/notifications — استعراض قائمة الإشعارات
 */
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const { appointmentId, status, limit } = req.query;
  const items = await listNotifications({
    appointmentId,
    status,
    limit: limit ? parseInt(limit, 10) : 50,
  });
  res.json({ notifications: items });
}));

/**
 * POST /api/notifications/process — معالجة طابور الإشعارات المجدولة
 */
router.post('/process', asyncHandler(async (req, res) => {
  const limit = req.body?.limit ? parseInt(req.body.limit, 10) : 20;
  const result = await processPendingNotifications(limit);
  res.json({
    message: 'تمت معالجة طابور الإشعارات بنجاح',
    ...result,
  });
}));

/**
 * POST /api/notifications/whatsapp-link — إنتاج رابط WhatsApp لموعد محدد
 */
router.post('/whatsapp-link', asyncHandler(async (req, res) => {
  const { appointmentId, customMessage } = req.body || {};

  if (!appointmentId) {
    throw AppError.badRequest('معرّف الموعد مطلوب (appointmentId)');
  }

  const validId = aptIdSchema.safeParse(appointmentId);
  if (!validId.success) {
    throw AppError.badRequest('معرّف الموعد غير صالح');
  }

  const row = await db.queryOne(
    `SELECT a.id, a.patient_name, a.patient_phone, a.appt_date, a.appt_time, a.queue_number,
            d.name AS doctor_name, d.title AS doctor_title, d.address AS clinic_address
       FROM public.appointments a
       JOIN public.doctors d ON d.id = a.doctor_id
      WHERE a.id = $1`,
    [validId.data]
  );

  if (!row) {
    throw AppError.notFound('الموعد غير موجود');
  }

  const message = customMessage || TEMPLATES.confirmation({
    patientName: row.patient_name,
    doctorName: row.doctor_name,
    doctorTitle: row.doctor_title,
    date: row.appt_date,
    time: row.appt_time,
    queueNumber: row.queue_number,
    address: row.clinic_address,
  });

  const whatsappUrl = buildWhatsAppUrl(row.patient_phone, message);

  // إدراج الإشعار بالسجل
  await queueNotification({
    appointmentId: row.id,
    channel: 'whatsapp',
    recipientPhone: row.patient_phone,
    recipientName: row.patient_name,
    message,
    scheduledFor: new Date(),
  });

  res.json({
    appointmentId: row.id,
    recipientPhone: row.patient_phone,
    message,
    whatsappUrl,
  });
}));

module.exports = router;


/**
 * POST /api/notifications/dispatch-reminders — فحص وجدولة تذكيرات المواعيد القادمة آلياً
 */
router.post('/dispatch-reminders', asyncHandler(async (req, res) => {
  const result = await scanAndScheduleUpcomingReminders();
  res.json({
    success: true,
    message: 'تم فحص المواعيد المجدولة وجدولة وتفرغ الإشعارات التلقائية بنجاح',
    ...result,
  });
}));
