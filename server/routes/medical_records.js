/**
 * server/routes/medical_records.js — إدارة السجلات الطبية والفيشة الصحية للمرضى
 * -----------------------------------------------------------------------------
 * يسمح للأطباء بحفظ وقراءة التاريخ الطبي لكل مريض (التشخيص، العلامات الحيوية،
 * الوصفات السابقة والملاحظات الطبية السرية).
 */

'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireClinicRole, asyncHandler } = require('../middleware/auth');
const { normalizeAlgerianPhone } = require('../lib/phone');

/**
 * GET /api/medical-records/patient/:identifier
 * جلب جميع السجلات والزيارات الطبية السابقة لمريض معين بواسطة هاتفه أو UUID
 */
router.get('/patient/:identifier', authenticate, requireClinicRole, asyncHandler(async (req, res) => {
  const identifier = req.params.identifier;
  const isPhone = /^(0|\+?213)[5673]\d{8}$/.test(identifier);
  const phoneNormalized = isPhone ? normalizeAlgerianPhone(identifier) : null;

  let query = `
    SELECT
      r.id,
      r.patient_id,
      r.patient_phone,
      r.doctor_id,
      r.appointment_id,
      r.diagnosis,
      r.symptoms,
      r.prescription_json,
      r.doctor_notes,
      r.vital_signs,
      r.created_at,
      d.name AS doctor_name,
      d.title AS doctor_title,
      s.name_ar AS specialty_name
    FROM public.patient_medical_records r
    LEFT JOIN public.doctors d ON d.id = r.doctor_id
    LEFT JOIN public.specialties s ON s.id = d.specialty_id
    WHERE 
  `;

  const params = [];
  if (phoneNormalized) {
    query += ` r.patient_phone = $1 `;
    params.push(phoneNormalized);
  } else {
    query += ` r.patient_id = $1 OR r.patient_phone = $1 `;
    params.push(identifier);
  }

  query += ` ORDER BY r.created_at DESC `;

  const rows = await db.queryMany(query, params);

  // جلب اسم المريض والحالة العامة إن وجدت في ملفات المستخدم
  let patientProfile = null;
  if (phoneNormalized || identifier) {
    patientProfile = await db.queryOne(
      `SELECT id, full_name, phone, has_chifa FROM public.profiles WHERE phone = $1 OR id::text = $2`,
      [phoneNormalized || identifier, identifier]
    );
  }

  res.json({
    patient: patientProfile ? {
      id: patientProfile.id,
      fullName: patientProfile.full_name,
      phone: patientProfile.phone,
      hasChifa: patientProfile.has_chifa,
    } : null,
    totalVisits: rows.length,
    records: rows.map(r => ({
      id: r.id,
      patientId: r.patient_id,
      patientPhone: r.patient_phone,
      doctorId: r.doctor_id,
      doctorName: r.doctor_name,
      doctorTitle: r.doctor_title,
      specialtyName: r.specialty_name,
      appointmentId: r.appointment_id,
      diagnosis: r.diagnosis,
      symptoms: r.symptoms,
      prescriptionJson: r.prescription_json,
      doctorNotes: r.doctor_notes,
      vitalSigns: r.vital_signs,
      createdAt: r.created_at,
    })),
  });
}));

/**
 * POST /api/medical-records
 * حفظ الفيشة والسجل الطبي لزيارة المريض
 */
router.post('/', authenticate, requireClinicRole, asyncHandler(async (req, res) => {
  const {
    patientPhone,
    patientId,
    appointmentId,
    diagnosis,
    symptoms,
    prescriptionJson,
    doctorNotes,
    vitalSigns,
  } = req.body;

  if (!patientPhone && !patientId) {
    return res.status(400).json({ error: 'missing_field', message: 'رقم هاتف المريض أو معرّفه مطلوب' });
  }

  if (!diagnosis || !diagnosis.trim()) {
    return res.status(400).json({ error: 'missing_field', message: 'التشخيص الطبي مطلوب لحفظ السجل' });
  }

  // البحث عن الطبيب المرتبط بحساب المستعمل الحالي
  const doctor = await db.queryOne(
    `SELECT id FROM public.doctors WHERE profile_id = $1`,
    [req.user.id]
  );

  const doctorId = doctor ? doctor.id : (req.body.doctorId || 'doc-1');
  const normalizedPhone = patientPhone ? normalizeAlgerianPhone(patientPhone) : (req.user.phone || '0661000000');

  const inserted = await db.queryOne(
    `INSERT INTO public.patient_medical_records (
      patient_id, patient_phone, doctor_id, appointment_id,
      diagnosis, symptoms, prescription_json, doctor_notes, vital_signs
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, created_at`,
    [
      patientId || null,
      normalizedPhone,
      doctorId,
      appointmentId || null,
      diagnosis.trim(),
      symptoms ? symptoms.trim() : null,
      prescriptionJson ? (typeof prescriptionJson === 'string' ? prescriptionJson : JSON.stringify(prescriptionJson)) : null,
      doctorNotes ? doctorNotes.trim() : null,
      vitalSigns ? (typeof vitalSigns === 'string' ? vitalSigns : JSON.stringify(vitalSigns)) : null,
    ]
  );

  res.status(201).json({
    success: true,
    message: 'تم حفظ الفيشة الطبية والسجل في ملف المريض بنجاح',
    recordId: inserted.id,
    createdAt: inserted.created_at,
  });
}));

module.exports = router;
