/**
 * routes/doctors.js — دليل الأطباء والعيادات
 * -----------------------------------------------------------------------------
 * كل هذه المسارات عامة للقراءة: المريض يبحث عن طبيب قبل أن يكون لديه حساب.
 * لا تُرجَع أي بيانات شخصية هنا — الأسماء والعناوين والأوقات فقط.
 */

'use strict';

const express = require('express');
const db = require('../db');
const { doctorFilterSchema, availabilityQuerySchema, updateClinicSchema, formatZodError, doctorIdSchema } = require('../lib/validation');
const { asyncHandler, authenticate, requireClinicRole } = require('../middleware/auth');
const { AppError } = require('../middleware/errors');
const { availableSlots, upcomingDates, isWorkingDay } = require('../lib/slots');
const { COMMUNES, SPECIALTIES } = require('../lib/constants');

const router = express.Router();

/** الأعمدة المسموح إرجاعها للأطباء — قائمة بيضاء صريحة */
const DOCTOR_COLUMNS = `
  d.id, d.name, d.title, d.specialty_id, d.commune_id, d.address,
  d.lat, d.lng, d.phone, d.price, d.rating, d.reviews_count,
  d.has_chifa, d.work_hours, d.available_days, d.slot_minutes, d.is_demo, d.accepting_bookings
`;

const FROM_CLAUSE = `
  FROM public.doctors d
  JOIN public.specialties s ON s.id = d.specialty_id
  JOIN public.communes   c ON c.id = d.commune_id
`;

// ---------------------------------------------------------------------------
// GET /api/doctors/meta — البلديات والتخصصات (لبناء قوائم الفلترة)
// ---------------------------------------------------------------------------
let cachedMeta = null;
let cachedMetaTime = 0;
let pendingMetaPromise = null;
const META_CACHE_TTL = 60 * 1000;

router.get('/meta', asyncHandler(async (req, res) => {
  const now = Date.now();
  if (cachedMeta && (now - cachedMetaTime < META_CACHE_TTL)) {
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json(cachedMeta);
  }

  if (pendingMetaPromise) {
    const data = await pendingMetaPromise;
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json(data);
  }

  pendingMetaPromise = (async () => {
    try {
      const [communes, specialties] = await Promise.all([
        db.query(`SELECT id, name_ar, sort_order FROM public.communes ORDER BY sort_order, name_ar`),
        db.query(`SELECT id, name_ar, icon, sort_order FROM public.specialties ORDER BY sort_order, name_ar`),
      ]);

      cachedMeta = {
        communes: communes.map((r) => ({ id: r.id, name: r.name_ar })),
        specialties: specialties.map((r) => ({ id: r.id, name: r.name_ar, icon: r.icon })),
      };
      cachedMetaTime = Date.now();
      return cachedMeta;
    } finally {
      pendingMetaPromise = null;
    }
  })();

  const data = await pendingMetaPromise;
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json(data);
}));

let cachedDefaultDoctors = null;
let cachedDefaultDoctorsTime = 0;
let pendingDefaultDoctorsPromise = null;
const DOCTORS_CACHE_TTL = 10 * 1000;

router.get('/', asyncHandler(async (req, res) => {
  const parsed = doctorFilterSchema.safeParse(req.query);
  if (!parsed.success) {
    throw AppError.badRequest('معايير الفلترة غير صالحة', formatZodError(parsed.error).details);
  }

  const { specialty, commune, search, hasChifa, sort, page, limit } = parsed.data;
  const isDefaultQuery = (!specialty || specialty === 'all') && (!commune || commune === 'all') && !search && hasChifa !== 'true' && page === 1;

  const now = Date.now();
  if (isDefaultQuery && cachedDefaultDoctors && (now - cachedDefaultDoctorsTime < DOCTORS_CACHE_TTL)) {
    res.setHeader('Cache-Control', 'public, max-age=10');
    return res.json(cachedDefaultDoctors);
  }

  if (isDefaultQuery && pendingDefaultDoctorsPromise) {
    const data = await pendingDefaultDoctorsPromise;
    res.setHeader('Cache-Control', 'public, max-age=10');
    return res.json(data);
  }

  const where = ['d.is_active = TRUE'];
  const params = [];

  if (specialty && specialty !== 'all') {
    params.push(specialty);
    where.push(`d.specialty_id = $${params.length}`);
  }
  if (commune && commune !== 'all') {
    params.push(commune);
    where.push(`d.commune_id = $${params.length}`);
  }
  if (hasChifa === 'true') {
    where.push('d.has_chifa = TRUE');
  }
  if (search) {
    // الحقول المبحوث عنها: الاسم، العنوان المعلن، اسم التخصص، اسم البلدية.
    // بدون s.name_ar لا يجد البحث عن "أطفال" الطبيب المتخصص في طب الأطفال،
    // لأن عنوانه المعلن قد لا يحتوي الكلمة نفسها حرفياً.
    const pattern = `%${search.replace(/[%_]/g, (m) => '\\' + m)}%`;
    params.push(pattern);
    const p = `$${params.length}`;
    where.push(
      `(d.name ILIKE ${p} OR d.title ILIKE ${p} OR d.address ILIKE ${p} OR s.name_ar ILIKE ${p} OR c.name_ar ILIKE ${p})`
    );
  }

  let orderBySql = 'd.rating DESC, d.reviews_count DESC, d.name';
  if (sort === 'price_asc') {
    orderBySql = 'd.price ASC, d.rating DESC';
  } else if (sort === 'price_desc') {
    orderBySql = 'd.price DESC, d.rating DESC';
  } else if (sort === 'geo') {
    orderBySql = '((d.lat - 36.19)*(d.lat - 36.19) + (d.lng - 5.41)*(d.lng - 5.41)) ASC';
  } else if (sort === 'rating') {
    orderBySql = 'd.rating DESC, d.reviews_count DESC';
  }

  const fetchDefaultDoctors = async () => {
    const whereSql = where.join(' AND ');
    const offset = (page - 1) * limit;

    const rows = await db.query(
      `SELECT ${DOCTOR_COLUMNS}, s.name_ar AS specialty_name, c.name_ar AS commune_name,
              COUNT(*) OVER() AS total_count
         ${FROM_CLAUSE}
        WHERE ${whereSql}
        ORDER BY ${orderBySql}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    const total = rows.length ? Number(rows[0].total_count) : 0;

    const payload = {
      doctors: rows.map(({ total_count, ...d }) => ({
        ...d,
        price: Number(d.price),
        rating: Number(d.rating),
        specialtyName: d.specialty_name,
        communeName: d.commune_name,
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };

    if (isDefaultQuery) {
      cachedDefaultDoctors = payload;
      cachedDefaultDoctorsTime = Date.now();
    }
    return payload;
  };

  if (isDefaultQuery) {
    pendingDefaultDoctorsPromise = (async () => {
      try {
        return await fetchDefaultDoctors();
      } finally {
        pendingDefaultDoctorsPromise = null;
      }
    })();
    const payload = await pendingDefaultDoctorsPromise;
    res.setHeader('Cache-Control', 'public, max-age=10');
    return res.json(payload);
  }

  const payload = await fetchDefaultDoctors();
  res.json(payload);
}));

// ---------------------------------------------------------------------------
// GET /api/doctors/:id — ملف طبيب واحد
// ---------------------------------------------------------------------------
router.get('/:id', asyncHandler(async (req, res) => {
  const id = doctorIdSchema.safeParse(req.params.id);
  if (!id.success) throw AppError.notFound('الطبيب غير موجود');

  const row = await db.queryOne(
    `SELECT ${DOCTOR_COLUMNS}, s.name_ar AS specialty_name, c.name_ar AS commune_name
       ${FROM_CLAUSE}
      WHERE d.id = $1 AND d.is_active = TRUE`,
    [id.data]
  );

  if (!row) throw AppError.notFound('الطبيب غير موجود');

  res.json({
    doctor: {
      ...row,
      price: Number(row.price),
      rating: Number(row.rating),
      specialtyName: row.specialty_name,
      communeName: row.commune_name,
    },
  });
}));

// ---------------------------------------------------------------------------
// GET /api/doctors/:id/availability?date=YYYY-MM-DD
// الخانات المتاحة = النظرية − المحجوزة − المنتهية
// ---------------------------------------------------------------------------
router.get('/:id/availability', asyncHandler(async (req, res) => {
  const id = doctorIdSchema.safeParse(req.params.id);
  if (!id.success) throw AppError.notFound('الطبيب غير موجود');

  const q = availabilityQuerySchema.safeParse(req.query);
  if (!q.success) throw AppError.badRequest('التاريخ غير صالح', formatZodError(q.error).details);

  const doctor = await db.queryOne(
    'SELECT id, work_hours, available_days, slot_minutes, accepting_bookings FROM public.doctors WHERE id = $1 AND is_active = TRUE',
    [id.data]
  );
  if (!doctor) throw AppError.notFound('الطبيب غير موجود');

  const { date, leadMinutes } = q.data;

  if (doctor.accepting_bookings === false) {
    return res.json({
      date,
      slotMinutes: doctor.slot_minutes,
      booked: [],
      isWorkingDay: true,
      availableDays: doctor.available_days || '',
      available: [],
      acceptingBookings: false,
      message: 'العيادة متوقفة عن استقبال المواعيد حالياً (اكتمل العدد)',
    });
  }

  const booked = await db.query(
    `SELECT to_char(appt_time, 'HH24:MI') AS t
       FROM public.appointments
      WHERE doctor_id = $1 AND appt_date = $2 AND status <> 'cancelled'`,
    [id.data, date]
  );

  const bookedTimes = booked.map((r) => r.t);

  res.json({
    date,
    slotMinutes: doctor.slot_minutes,
    booked: bookedTimes,
    // يوم راحة أو عطلة: الواجهة تعرض رسالة واضحة بدل قائمة فارغة غامضة
    isWorkingDay: isWorkingDay(date, doctor.available_days),
    availableDays: doctor.available_days || '',
    available: availableSlots({
      workHours: doctor.work_hours,
      availableDays: doctor.available_days,
      slotMinutes: doctor.slot_minutes,
      date,
      bookedTimes,
      leadMinutes,
    }),
  });
}));

// ---------------------------------------------------------------------------
// GET /api/doctors/:id/days — الأيام التي يمكن الحجز فيها فعلاً
// ---------------------------------------------------------------------------
router.get('/:id/days', asyncHandler(async (req, res) => {
  const id = doctorIdSchema.safeParse(req.params.id);
  if (!id.success) throw AppError.notFound('الطبيب غير موجود');

  const doctor = await db.queryOne(
    'SELECT available_days FROM public.doctors WHERE id = $1 AND is_active = TRUE',
    [id.data]
  );
  if (!doctor) throw AppError.notFound('الطبيب غير موجود');

  // نُرجع فقط الأيام التي يعمل فيها الطبيب فعلاً: عرض أيام مغلقة في
  // منتقي التاريخ يجعل المريض يختار ثم يكتشف أنه لا توجد مواعيد
  const dates = upcomingDates(14).filter((d) => isWorkingDay(d, doctor.available_days));

  res.json({
    dates,
    availableDays: doctor.available_days || '',
    allDays: upcomingDates(14),
  });
}));

// ---------------------------------------------------------------------------
// PUT /api/doctors/me — تحديث ملف العيادة (لحساب الطبيب فقط)
// ---------------------------------------------------------------------------
router.put('/me', authenticate, requireClinicRole, asyncHandler(async (req, res) => {
  const clinic = await db.queryOne('SELECT id FROM public.doctors WHERE profile_id = $1', [req.user.id]);
  if (!clinic) {
    throw new AppError(404, 'no_clinic', 'لا توجد عيادة مرتبطة بهذا الحساب. تواصل مع الإدارة.');
  }

  // تحقق كامل قبل أي كتابة: الاسم والعنوان يظهران لاحقاً عبر innerHTML،
  // فقبول HTML هنا يعيد فتح ثغرة XSS على كل زوّار صفحة الأطباء.
  const parsed = updateClinicSchema.safeParse(req.body || {});
  if (!parsed.success) {
    const formatted = formatZodError(parsed.error);
    throw new AppError(400, 'invalid_input', formatted.message, formatted.details);
  }

  const payload = parsed.data;
  const updates = [];
  const params = [clinic.id];

  for (const [key, value] of Object.entries(payload)) {
    params.push(value);
    updates.push(`${key} = $${params.length}`);
  }

  if (updates.length === 0) throw AppError.badRequest('لا يوجد ما يتم تحديثه');

  const updated = await db.queryOne(
    `UPDATE public.doctors SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING ${DOCTOR_COLUMNS.replace(/\bd\./g, '')}`,
    params
  );

  // نُرجع نفس الشكل العام المخصص للعرض — لا RETURNING * الذي كان
  // يكشف profile_id وعلاقات داخلية لا تخص المريض.
  res.json({ message: 'تم تحديث بيانات العيادة', clinic: updated });
}));

module.exports = router;
