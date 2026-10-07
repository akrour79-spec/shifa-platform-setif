/**
 * server/routes/patient_portal.js — بوابة حساب المريض والملف الشخصي
 * -----------------------------------------------------------------------------
 * تتيح للمريض المسجل استعراض كل مواعيده القادمة والسابقة، تنزيل تذاكره الرقمية،
 * والاطلاع على الفيشات والوصفات الطبية الخاصة به.
 */

'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, asyncHandler } = require('../middleware/auth');
const { normalizeAlgerianPhone } = require('../lib/phone');

/**
 * GET /api/patient/portal — جلب بيانات ملف المريض ومواعيده ووصفاته
 */
router.get('/portal', authenticate, asyncHandler(async (req, res) => {
  const patientId = req.user.id;
  const patientPhone = normalizeAlgerianPhone(req.user.phone);

  // 1. المواعيد القادمة
  const upcomingRows = await db.queryMany(
    `SELECT
       a.id, a.doctor_id, a.patient_name, a.patient_phone, a.appt_date, a.appt_time,
       a.status, a.queue_number, a.has_chifa, a.notes, a.created_at,
       d.name AS doctor_name, d.title AS doctor_title, d.address AS clinic_address,
       d.phone AS clinic_phone, s.name_ar AS specialty_name, c.name_ar AS commune_name,
       d.lat, d.lng
     FROM public.appointments a
     JOIN public.doctors d ON d.id = a.doctor_id
     LEFT JOIN public.specialties s ON s.id = d.specialty_id
     LEFT JOIN public.communes c ON c.id = d.commune_id
     WHERE (a.patient_id = $1 OR a.patient_phone = $2)
       AND a.status IN ('confirmed', 'waiting', 'in_consultation')
     ORDER BY a.appt_date ASC, a.appt_time ASC`,
    [patientId, patientPhone]
  );

  // 2. المواعيد السابقة (المكتملة أو الملغاة)
  const historyRows = await db.queryMany(
    `SELECT
       a.id, a.doctor_id, a.patient_name, a.patient_phone, a.appt_date, a.appt_time,
       a.status, a.queue_number, a.has_chifa, a.created_at,
       d.name AS doctor_name, d.title AS doctor_title, d.address AS clinic_address,
       s.name_ar AS specialty_name, c.name_ar AS commune_name
     FROM public.appointments a
     JOIN public.doctors d ON d.id = a.doctor_id
     LEFT JOIN public.specialties s ON s.id = d.specialty_id
     LEFT JOIN public.communes c ON c.id = d.commune_id
     WHERE (a.patient_id = $1 OR a.patient_phone = $2)
       AND a.status IN ('completed', 'cancelled', 'no_show')
     ORDER BY a.appt_date DESC, a.appt_time DESC
     LIMIT 50`,
    [patientId, patientPhone]
  );

  // 3. الفيشات والوصفات الطبية
  const medicalRecords = await db.queryMany(
    `SELECT
       r.id, r.diagnosis, r.symptoms, r.prescription_json, r.created_at,
       d.name AS doctor_name, d.title AS doctor_title, s.name_ar AS specialty_name
     FROM public.patient_medical_records r
     JOIN public.doctors d ON d.id = r.doctor_id
     LEFT JOIN public.specialties s ON s.id = d.specialty_id
     WHERE (r.patient_id = $1 OR r.patient_phone = $2)
     ORDER BY r.created_at DESC`,
    [patientId, patientPhone]
  );

  res.json({
    patient: {
      id: req.user.id,
      fullName: req.user.fullName,
      phone: req.user.phone,
      hasChifa: req.user.hasChifa,
      communeId: req.user.communeId,
    },
    upcoming: upcomingRows.map(r => ({
      id: r.id,
      doctorId: r.doctor_id,
      doctorName: r.doctor_name,
      doctorTitle: r.doctor_title,
      specialtyName: r.specialty_name,
      clinicAddress: r.clinic_address,
      clinicPhone: r.clinic_phone,
      communeName: r.commune_name,
      lat: Number(r.lat) || 0,
      lng: Number(r.lng) || 0,
      date: r.appt_date,
      time: r.appt_time,
      status: r.status,
      queueNumber: r.queue_number,
      hasChifa: r.has_chifa,
      notes: r.notes,
      createdAt: r.created_at,
    })),
    history: historyRows.map(r => ({
      id: r.id,
      doctorId: r.doctor_id,
      doctorName: r.doctor_name,
      doctorTitle: r.doctor_title,
      specialtyName: r.specialty_name,
      clinicAddress: r.clinic_address,
      communeName: r.commune_name,
      date: r.appt_date,
      time: r.appt_time,
      status: r.status,
      queueNumber: r.queue_number,
      hasChifa: r.has_chifa,
      createdAt: r.created_at,
    })),
    medicalRecords: medicalRecords.map(r => ({
      id: r.id,
      diagnosis: r.diagnosis,
      symptoms: r.symptoms,
      prescriptionJson: r.prescription_json,
      doctorName: r.doctor_name,
      doctorTitle: r.doctor_title,
      specialtyName: r.specialty_name,
      createdAt: r.created_at,
    })),
  });
}));

/**
 * POST /api/patient/cancel-appointment — إلغاء موعد المريض القادم
 */
router.post('/cancel-appointment', authenticate, asyncHandler(async (req, res) => {
  const { appointmentId } = req.body;
  if (!appointmentId) {
    return res.status(400).json({ error: 'missing_id', message: 'معرّف الموعد مطلوب' });
  }

  const updated = await db.queryOne(
    `UPDATE public.appointments
        SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1 AND (patient_id = $2 OR patient_phone = $3) AND status IN ('confirmed', 'waiting')
      RETURNING id, appt_date, appt_time`,
    [appointmentId, req.user.id, normalizeAlgerianPhone(req.user.phone)]
  );

  if (!updated) {
    return res.status(404).json({ error: 'not_found', message: 'الموعد غير موجود أو لا يمكن إلغاؤه' });
  }

  res.json({
    success: true,
    message: 'تم إلغاء الموعد بنجاح',
    appointment: updated,
  });
}));

module.exports = router;
