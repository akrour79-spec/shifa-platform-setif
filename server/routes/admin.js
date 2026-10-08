/**
 * server/routes/admin.js — لوحة تحكم المشرف والتحليلات لولاية سطيف
 * -----------------------------------------------------------------------------
 * توفر بيانات إحصائية شاملة لقطاع الصحة بالولاية:
 *  - توزيع الحجوزات والعيادات حسب بلديات سطيف (سطيف المركز، العلمة، إلخ)
 *  - التخصصات الأكثر طلباً ونشاطاً
 *  - مؤشرات MRR وحالة اعتماد العيادات الجدد
 */

'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { optionalAuth, asyncHandler } = require('../middleware/auth');

let cachedAnalytics = null;
let cachedAnalyticsTime = 0;
let pendingAnalyticsPromise = null;
const ANALYTICS_CACHE_TTL = 15 * 1000; // 15 ثانية

/**
 * GET /api/admin/analytics — جلب التحليلات الشاملة لقطاع الصحة والمواعيد بولاية سطيف
 */
router.get('/analytics', optionalAuth, asyncHandler(async (req, res) => {
  const now = Date.now();
  if (cachedAnalytics && (now - cachedAnalyticsTime < ANALYTICS_CACHE_TTL)) {
    return res.json(cachedAnalytics);
  }

  if (pendingAnalyticsPromise) {
    const data = await pendingAnalyticsPromise;
    return res.json(data);
  }

  pendingAnalyticsPromise = (async () => {
    try {
      const kpiRow = await db.queryOne(`
        SELECT
          (SELECT COUNT(*) FROM public.doctors WHERE is_active = TRUE) AS total_active_clinics,
          (SELECT COUNT(*) FROM public.doctors WHERE is_active = FALSE) AS total_pending_clinics,
          (SELECT COUNT(*) FROM public.profiles WHERE role = 'patient') AS total_patients,
          (SELECT COUNT(*) FROM public.appointments) AS total_appointments,
          (SELECT COUNT(*) FROM public.appointments WHERE status = 'completed') AS completed_appointments,
          (SELECT COUNT(*) FROM public.appointments WHERE status IN ('confirmed', 'waiting')) AS active_appointments,
          (SELECT COUNT(*) FROM public.appointments WHERE status = 'cancelled') AS cancelled_appointments,
          (SELECT COUNT(*) FROM public.appointments WHERE status = 'no_show') AS no_show_appointments
      `);

      const communeStats = await db.query(`
        SELECT 
          c.id AS commune_id,
          c.name_ar AS commune_name,
          COUNT(DISTINCT d.id) AS clinic_count,
          COUNT(a.id) AS booking_count
        FROM public.communes c
        LEFT JOIN public.doctors d ON d.commune_id = c.id AND d.is_active = TRUE
        LEFT JOIN public.appointments a ON a.commune_id = c.id OR a.doctor_id = d.id
        GROUP BY c.id, c.name_ar
        ORDER BY booking_count DESC, clinic_count DESC, c.sort_order ASC
      `);

      const specialtyStats = await db.query(`
        SELECT
          s.id AS specialty_id,
          s.name_ar AS specialty_name,
          s.icon,
          COUNT(DISTINCT d.id) AS clinic_count,
          COUNT(a.id) AS booking_count
        FROM public.specialties s
        LEFT JOIN public.doctors d ON d.specialty_id = s.id AND d.is_active = TRUE
        LEFT JOIN public.appointments a ON a.doctor_id = d.id
        GROUP BY s.id, s.name_ar, s.icon
        ORDER BY booking_count DESC, clinic_count DESC, s.sort_order ASC
      `);

      const peakTimeStats = await db.query(`
        SELECT
          CASE
            WHEN extract(hour from appt_time) < 12 THEN 'الفترة الصباحية (08:00 - 12:00)'
            ELSE 'الفترة المسائية (12:00 - 17:00)'
          END AS time_slot,
          COUNT(*) AS count
        FROM public.appointments
        GROUP BY time_slot
        ORDER BY count DESC
      `);

      const pendingClinics = await db.query(`
        SELECT
          d.id,
          d.name,
          d.title,
          d.phone,
          d.price,
          d.created_at,
          s.name_ar AS specialty_name,
          c.name_ar AS commune_name
        FROM public.doctors d
        LEFT JOIN public.specialties s ON s.id = d.specialty_id
        LEFT JOIN public.communes c ON c.id = d.commune_id
        WHERE d.is_active = FALSE
        ORDER BY d.created_at DESC
      `);

      const activeClinicsCount = parseInt(kpiRow?.total_active_clinics || 0, 10);
      const estimatedMRR = activeClinicsCount * 7500;

      // نسبة الغياب: ملغاة + لم يحضر، من إجمالي المواعيد — مؤشر جودة للعيادات
      const totalAppts = parseInt(kpiRow?.total_appointments || 0, 10);
      const missed = parseInt(kpiRow?.cancelled_appointments || 0, 10)
        + parseInt(kpiRow?.no_show_appointments || 0, 10);
      const noShowRate = totalAppts > 0 ? Math.round((missed / totalAppts) * 1000) / 10 : 0;

      const payload = {
        kpis: {
          activeClinics: activeClinicsCount,
          pendingClinics: parseInt(kpiRow?.total_pending_clinics || 0, 10),
          totalPatients: parseInt(kpiRow?.total_patients || 0, 10),
          totalAppointments: totalAppts,
          completedAppointments: parseInt(kpiRow?.completed_appointments || 0, 10),
          activeAppointments: parseInt(kpiRow?.active_appointments || 0, 10),
          cancelledAppointments: parseInt(kpiRow?.cancelled_appointments || 0, 10),
          noShowAppointments: parseInt(kpiRow?.no_show_appointments || 0, 10),
          noShowRate,
          estimatedMRR,
        },
        communes: communeStats.map(c => ({
          communeId: c.commune_id,
          communeName: c.commune_name,
          clinicCount: parseInt(c.clinic_count || 0, 10),
          bookingCount: parseInt(c.booking_count || 0, 10),
        })),
        specialties: specialtyStats.map(s => ({
          specialtyId: s.specialty_id,
          specialtyName: s.specialty_name,
          icon: s.icon,
          clinicCount: parseInt(s.clinic_count || 0, 10),
          bookingCount: parseInt(s.booking_count || 0, 10),
        })),
        peakTimes: peakTimeStats.map(p => ({
          slot: p.time_slot,
          count: parseInt(p.count || 0, 10),
        })),
        pendingClinics: pendingClinics.map(d => ({
          id: d.id,
          name: d.name,
          title: d.title,
          phone: d.phone,
          price: d.price,
          createdAt: d.created_at,
          specialtyName: d.specialty_name,
          communeName: d.commune_name,
        })),
      };

      cachedAnalytics = payload;
      cachedAnalyticsTime = Date.now();
      return payload;
    } finally {
      pendingAnalyticsPromise = null;
    }
  })();

  const data = await pendingAnalyticsPromise;
  res.json(data);
}));

/**
 * POST /api/admin/clinics/:id/approve — تفعيل وتوثيق عيادة مباشرة
 */
router.post('/clinics/:id/approve', optionalAuth, asyncHandler(async (req, res) => {
  cachedAnalytics = null; // Invalidate cache on clinic approval
  const doctorId = req.params.id;
  const updated = await db.queryOne(
    `UPDATE public.doctors SET is_active = TRUE, updated_at = NOW() WHERE id = $1 RETURNING id, name, title, phone`,
    [doctorId]
  );

  if (!updated) {
    return res.status(404).json({ error: 'clinic_not_found', message: 'العيادة غير موجودة' });
  }

  res.json({
    success: true,
    message: `تم اعتماد وتفعيل عيادة ${updated.name} بنجاح!`,
    clinic: updated,
  });
}));

module.exports = router;
