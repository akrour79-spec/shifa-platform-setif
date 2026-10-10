/**
 * lib/notifications.js — وحدة إدارة وتوليد وطابور الإشعارات (WhatsApp & SMS)
 * -----------------------------------------------------------------------------
 * توفّر:
 *   1) توليد رسائل تنبيه وتأكيد بالعربية الفصحى لمرضى سطيف.
 *   2) إضافة الإشعارات إلى طابور notifications_outbox (الفوري والمجدول).
 *   3) معالجة طابور الإشعارات المعلقة (Pending Queue Processing).
 *   4) إنتاج روابط WhatsApp المباشرة بالصيغة الدولية المعتمدة لبرنامج wa.me.
 */

'use strict';

const db = require('../db');
const { classifyAlgerianNumber, toNationalDigits, ALGERIA_CC } = require('./phone');

/**
 * أنواع الرسائل وقوالب التنبيه
 */
const TEMPLATES = {
  confirmation: ({ patientName, doctorName, doctorTitle, date, time, queueNumber, address }) =>
    `مرحباً ${patientName}، تم تأكيد حجز موعدك لدى ${doctorTitle || 'الدكتور'} ${doctorName} بتاريخ ${date} الساعة ${time}.\n` +
    `رقم دورك: #${queueNumber}\n` +
    `العنوان: ${address}، سطيف.\n` +
    `يرجى الحضور قبل الموعد بـ 15 دقيقة وإحضار بطاقة الشفاء.`,

  reminder: ({ patientName, doctorName, doctorTitle, date, time, queueNumber, address }) =>
    `تذكير بموعدك: نذكرك بموعدك المجدول لدى ${doctorTitle || 'الدكتور'} ${doctorName} بتاريخ ${date} الساعة ${time}.\n` +
    `رقم الدور: #${queueNumber}\n` +
    `العنوان: ${address}.\n` +
    `نتمنى لك دوام الصحة والعافية — منصة شِـفَـاء سطيف.`,

  cancellation: ({ patientName, doctorName, date, time }) =>
    `تنبيه من منصة شِـفَـاء: تم إلغاء موعدك لدى الدكتور ${doctorName} المجدول بتاريخ ${date} الساعة ${time}. ` +
    `لإعادة الحجز يرجى زيارة المنصة.`,

  status_update: ({ patientName, doctorName, statusText, queueNumber }) =>
    `تحديث الموعد: حالة موعدك لدى الدكتور ${doctorName} (دورك #${queueNumber}) أصبحت الآن: [${statusText}].`,
};

/**
 * بناء رابط WhatsApp المباشر لإرسال الرسالة إلى رقم جزائري
 * @param {string} phone 
 * @param {string} message 
 * @returns {string} رابط wa.me
 */
function buildWhatsAppUrl(phone, message) {
  const digits = toNationalDigits(phone);
  let waPhone = digits;

  if (digits.startsWith('0')) {
    waPhone = `${ALGERIA_CC}${digits.slice(1)}`;
  } else if (!digits.startsWith(ALGERIA_CC) && digits.length >= 8) {
    waPhone = `${ALGERIA_CC}${digits}`;
  }

  const encodedMsg = encodeURIComponent(message || '');
  return `https://wa.me/${waPhone}?text=${encodedMsg}`;
}

/**
 * إضافة إشعار إلى طابور notifications_outbox
 */
async function queueNotification(options, client = null) {
  const {
    appointmentId,
    channel = 'whatsapp',
    recipientPhone,
    recipientName = '',
    message,
    scheduledFor = new Date(),
  } = options;

  if (!recipientPhone || !message) {
    throw new Error('رقم المستقبل والرسالة مطلوبان لإدراج الإشعار');
  }

  const executor = client || db;

  const sql = `
    INSERT INTO public.notifications_outbox
      (appointment_id, channel, recipient_phone, recipient_name, message, scheduled_for, status)
    VALUES ($1, $2, $3, $4, $5, $6, 'pending')
    RETURNING id, appointment_id, channel, recipient_phone, recipient_name, message, scheduled_for, status, created_at
  `;

  const params = [
    appointmentId || null,
    channel,
    recipientPhone,
    recipientName,
    message,
    scheduledFor instanceof Date ? scheduledFor.toISOString() : scheduledFor,
  ];

  if (client) {
    const res = await client.query(sql, params);
    return res.rows[0];
  } else {
    return await db.queryOne(sql, params);
  }
}

/**
 * معالجة وتفريغ طابور الإشعارات المعلقة (Pending Notification Dispatcher)
 */
async function processPendingNotifications(limit = 20) {
  const pending = await db.query(
    `SELECT id, appointment_id, channel, recipient_phone, recipient_name, message, scheduled_for
       FROM public.notifications_outbox
      WHERE status = 'pending' AND scheduled_for <= NOW()
      ORDER BY scheduled_for ASC
      LIMIT $1`,
    [limit]
  );

  // الإرسال الحقيقي — whatsapp.js يختار Cloud API إن كان مضبوطاً،
  // وإلا وضع السجل (لا يرمي خطأ في التطوير)
  // إصلاح 2026-10-10: دعم قوالب واتساب — الرسالة قد تكون JSON يحمل
  // {template, params, lang} فيُرسل كقالب معتمد (يفتح محادثة جديدة)،
  // وإلا تُرسل كنص حر (داخل نافذة 24 ساعة).
  const { sendWhatsApp, sendTemplateMessage } = require('./whatsapp');
  const processed = [];

  for (const item of pending) {
    try {
      let result;
      if (item.channel === 'whatsapp') {
        let tpl = null;
        try { tpl = JSON.parse(item.message); } catch (e) { /* نص حر */ }
        if (tpl && tpl.template) {
          result = await sendTemplateMessage(
            item.recipient_phone, tpl.template, tpl.params || [], tpl.lang || 'ar'
          );
        } else {
          result = await sendWhatsApp(item.recipient_phone, item.message);
        }
      } else {
        result = { ok: true, provider: `${item.channel}-log`, messageId: `log-${Date.now()}` };
      }

      if (!result.ok) throw new Error(result.error || 'send_failed');

      await db.query(
        `UPDATE public.notifications_outbox
            SET status = 'sent', sent_at = NOW(), updated_at = NOW(),
                provider_message_id = $2, provider = $3
          WHERE id = $1`,
        [item.id, result.messageId || null, result.provider || 'whatsapp']
      );

      processed.push({ ...item, status: 'sent', sent_at: new Date().toISOString() });
    } catch (err) {
      await db.query(
        `UPDATE public.notifications_outbox
            SET status = 'failed', error_message = $2, updated_at = NOW()
          WHERE id = $1`,
        [item.id, err.message]
      );
      processed.push({ ...item, status: 'failed', error_message: err.message });
    }
  }

  return { total: pending.length, processed };
}

/**
 * استرجاع قائمة الإشعارات لـ موعد أو للنظام عامة
 */
async function listNotifications({ appointmentId, status, limit = 50 } = {}) {
  let sql = `
    SELECT n.id, n.appointment_id, n.channel, n.recipient_phone, n.recipient_name,
           n.message, n.scheduled_for, n.status, n.error_message, n.sent_at, n.created_at
      FROM public.notifications_outbox n
  `;
  const conditions = [];
  const params = [];

  if (appointmentId) {
    params.push(appointmentId);
    conditions.push(`n.appointment_id = $${params.length}`);
  }

  if (status) {
    params.push(status);
    conditions.push(`n.status = $${params.length}`);
  }

  if (conditions.length > 0) {
    sql += ` WHERE ` + conditions.join(' AND ');
  }

  sql += ` ORDER BY n.created_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  return await db.query(sql, params);
}


/**
 * يفحص المواعيد المجدولة للغد التي لم يُنشأ لها تذكير بعد في الطابور ويقوم بإدراجها ومعالجتها آلياً
 */
async function scanAndScheduleUpcomingReminders() {
  const upcomingAppts = await db.queryMany(`
    SELECT 
      a.id AS appointment_id,
      a.patient_name,
      a.patient_phone,
      a.appt_date,
      a.appt_time,
      a.queue_number,
      d.name AS doctor_name,
      d.title AS doctor_title,
      d.address AS doctor_address
    FROM public.appointments a
    JOIN public.doctors d ON d.id = a.doctor_id
    WHERE a.status IN ('confirmed', 'waiting')
      AND a.appt_date = (CURRENT_DATE + INTERVAL '1 day')
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications_outbox n
        WHERE n.appointment_id = a.id
          AND n.message LIKE '%تذكير بموعدك%'
      )
  `);

  const enqueued = [];
  for (const appt of upcomingAppts) {
    const msg = TEMPLATES.reminder({
      patientName: appt.patient_name,
      doctorName: appt.doctor_name,
      doctorTitle: appt.doctor_title,
      date: appt.appt_date,
      time: appt.appt_time,
      queueNumber: appt.queue_number,
      address: appt.doctor_address,
    });

    const item = await queueNotification({
      appointmentId: appt.appointment_id,
      channel: 'whatsapp',
      recipientPhone: appt.patient_phone,
      recipientName: appt.patient_name,
      message: msg,
      scheduledFor: new Date(),
    });
    enqueued.push(item);
  }

  const dispatchResult = await processPendingNotifications(50);

  return {
    scanned: upcomingAppts.length,
    enqueued: enqueued.length,
    processed: dispatchResult.processed.length,
  };
}

module.exports = {
  TEMPLATES,
  buildWhatsAppUrl,
  queueNotification,
  processPendingNotifications,
  scanAndScheduleUpcomingReminders,
  listNotifications,
};
