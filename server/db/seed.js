/**
 * db/seed.js — تعبئة قاعدة البيانات بالبيانات المرجعية والأطباء
 * -----------------------------------------------------------------------------
 * الاستخدام:  npm run seed
 * -----------------------------------------------------------------------------
 * • البلديات والتخصصات تأتي من constants.js (مصدر واحد للحقيقة)
 * • الأطباء يُؤخذون من js/data.js — نفس البيانات التي كانت في الواجهة،
 *   لكن في قاعدة البيانات الآن بدل ثابتات في المتصفح.
 * • السكربت آمن للتشغيل المتكرر: لا يُنشئ تكراراً (upsert).
 */

'use strict';

const db = require('./index');
const { COMMUNES, SPECIALTIES } = require('../lib/constants');

/**
 * يقرأ الأطباء من server/db/fixtures/doctors.js.
 *
 * ملاحظة تقنية: الملف يعلن الثوابت بـ `const INITIAL_DOCTORS = [...]` على
 * المستوى الأعلى. تعليقات `const`/`let` في JavaScript تعيش في النطاق
 * المعجمي للـ script ولا تُضاف كخاصية على الكائن العام، لذلك لا يمكن
 * الوصول إليها من خارج الـ vm context.
 *
 * الحل: نُلحق statement في آخر الملف يصدّرها صراحةً إلى `globalThis`.
 * الملف نفسه يبقى بصيغة صالحة للتحميل المباشر.
 */
function loadDoctorsFromWebData() {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');

  const file = path.join(__dirname, 'fixtures', 'doctors.js');
  if (!fs.existsSync(file)) return [];

  const source = fs.readFileSync(file, 'utf8');

  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'doctors.js' });

  const exported = sandbox.__SHIFA__;
  return exported && Array.isArray(exported.INITIAL_DOCTORS)
    ? exported.INITIAL_DOCTORS
    : [];
}

async function seedReference() {
  console.log('\n▸ تعبئة البيانات المرجعية (بلديات + تخصصات)...');

  for (const c of COMMUNES) {
    await db.query(
      `INSERT INTO public.communes (id, name_ar, sort_order)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name_ar = EXCLUDED.name_ar, sort_order = EXCLUDED.sort_order`,
      [c.id, c.name, c.sortOrder]
    );
  }
  console.log(`  ✓ ${COMMUNES.length} بلدية`);

  for (const s of SPECIALTIES) {
    await db.query(
      `INSERT INTO public.specialties (id, name_ar, icon, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name_ar = EXCLUDED.name_ar, icon = EXCLUDED.icon, sort_order = EXCLUDED.sort_order`,
      [s.id, s.name, s.icon, s.sortOrder]
    );
  }
  console.log(`  ✓ ${SPECIALTIES.length} تخصص`);
}

async function seedDoctors() {
  const doctors = loadDoctorsFromWebData();

  if (doctors.length === 0) {
    console.log('\n⚠ لم يُعثر على أطباء في js/data.js — تم تخطّي تعبئة الأطباء.');
    return 0;
  }

  console.log(`\n▸ تعبئة الأطباء (${doctors.length} طبيب)...`);

  let created = 0;
  let updated = 0;

  for (const d of doctors) {
    const exists = await db.queryOne('SELECT 1 FROM public.doctors WHERE id = $1', [d.id]);

    const params = [
      d.id,
      d.name,
      d.title || '',
      d.specialty,
      d.commune,
      d.address || '',
      d.lat,
      d.lng,
      String(d.phone || '+213000000000'),
      d.price ?? 2000,
      d.rating ?? 4.9,
      d.reviews ?? 0,
      d.hasChifa ?? true,
      d.workHours || '08:00 - 16:30',
      d.availableDays || 'السبت - الخميس',
      d.slotMinutes || 30,
    ];

    await db.query(
      `INSERT INTO public.doctors
         (id, name, title, specialty_id, commune_id, address, lat, lng, phone,
          price, rating, reviews_count, has_chifa, work_hours, available_days, slot_minutes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, title = EXCLUDED.title,
         specialty_id = EXCLUDED.specialty_id, commune_id = EXCLUDED.commune_id,
         address = EXCLUDED.address, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
         phone = EXCLUDED.phone, price = EXCLUDED.price, rating = EXCLUDED.rating,
         reviews_count = EXCLUDED.reviews_count, has_chifa = EXCLUDED.has_chifa,
         work_hours = EXCLUDED.work_hours, available_days = EXCLUDED.available_days,
         slot_minutes = EXCLUDED.slot_minutes`,
      params
    );

    if (exists) updated++; else created++;
  }

  console.log(`  ✓ ${created} جديد، ${updated} محدَّث`);
  return doctors.length;
}

/** حساب تجريبي للطبيب — كلمة سرّ معلنة للتطوير فقط */
async function seedDemoAccounts() {
  console.log('\n▸ إنشاء حسابات تجريبية (للتطوير فقط)...');

  const bcrypt = require('bcryptjs');
  const config = require('../config');

  if (config.isProd) {
    console.log('  ⏭ تُخطّى تلقائياً في الإنتاج.');
    return;
  }

  const { toE164 } = require('../lib/phone');
  const passwordHash = await bcrypt.hash('Shifa2026!', config.bcryptRounds);

  const accounts = [
    {
      phone: toE164('0661223344'),
      fullName: 'د. كريم بوزيد',
      role: 'doctor',
      clinicName: 'عيادة بوزيد للشفاء والتأهيل',
      specialtyId: 'orthopedie',
    },
    {
      phone: toE164('0661998877'),
      fullName: 'محمد عبد السلام',
      role: 'patient',
    },
  ];

  for (const a of accounts) {
    await db.query(
      `INSERT INTO public.profiles (phone, password_hash, full_name, role, clinic_name, specialty_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (phone) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         full_name     = EXCLUDED.full_name,
         role          = EXCLUDED.role`,
      [a.phone, passwordHash, a.fullName, a.role, a.clinicName || null, a.specialtyId || null]
    );
  }

  // ربط حساب الطبيب التجريبي بأعلى عيادة تقييم في سطيف، وتسمية الحساب
  // باسم صاحبها الفعلي.
  //
  // السبب: كان الحساب التجريبي يُسمّى "د. كريم بوزيد" بينما العيادة المرتبطة
  // به اسمها "د. أمينة بن علي". فيرى المستخدم اسمين مختلفين لنفس الشخص:
  // دليل العيادات يعرض الأول، ولوحة العيادة تعرض الثاني. نُسمّي الحساب
  // من العيادة نفسها ليبقي الاثنان متطابقين.
  const doctorAccount = await db.queryOne(
    `SELECT id FROM public.profiles WHERE phone = $1`,
    [toE164('0661223344')]
  );

  if (doctorAccount) {
    let linked = await db.queryOne(
      `SELECT id FROM public.doctors WHERE profile_id = $1`,
      [doctorAccount.id]
    );
    if (!linked) {
      const firstClinic = await db.queryOne(
        `SELECT id FROM public.doctors WHERE commune_id = 'setif' ORDER BY rating DESC LIMIT 1`
      );
      if (firstClinic) {
        await db.query(
          'UPDATE public.doctors SET profile_id = $2 WHERE id = $1',
          [firstClinic.id, doctorAccount.id]
        );
        linked = { id: firstClinic.id };
        console.log('  ✓ ربط حساب الطبيب التجريبي بأعلى عيادة تقييم في سطيف');
      }
    }

    // نُزامن اسم الحساب مع اسم عيادته في كل تشغيل، لا عند الربط فقط
    if (linked) {
      const clinic = await db.queryOne(
        'SELECT name FROM public.doctors WHERE id = $1', [linked.id]
      );
      if (clinic && clinic.name) {
        await db.query(
          'UPDATE public.profiles SET full_name = $2 WHERE id = $1 AND full_name <> $2',
          [doctorAccount.id, clinic.name]
        );
      }
    }
  }

  console.log(`  ✓ ${accounts.length} حساب — كلمة السر لكلٍّ منهما: Shifa2026!`);
}

/**
 * مواعيد تجريبية لليوم — بدونها الطابور وشاشة الانتظار فارغتان تماماً.
 *
 * لماذا هي ضرورية: الطابور وشاشة التلفزيون هما واجهتا العرض الأبرز في
 * المنصة. على قاعدة نظيفة لم يكن هناك أي موعد، فكان أي عرض أمام الناس
 * يبدأ من شاشة فارغة. هذه الدالة تُنشئ ما يكفي لعرض الحالة الحقيقية:
 *   • موعدان مكتملان  (ما قبل الطابور)
 *   • موعد واحد عند الطبيب
 *   • موعدان في قاعة الانتظار
 *   • موعد مؤكد لم يدخل الطابور بعد
 *   • موعد مستقبلي للحساب التجريبي، حتى لا تبدو صفحته الشخصية خالية
 *
 * كلها لبيانات تجريبية، وتُتخطّى في الإنتاج مثل الحسابات التجريبية.
 */
async function seedDemoAppointments() {
  console.log('\n▸ إنشاء مواعيد تجريبية لليوم (للعرض)...');
  const config = require('../config');


  if (config.isProd) {
    console.log('  ⏭ تُخطّى تلقائياً في الإنتاج.');
    return 0;
  }

  const { toE164 } = require('../lib/phone');
  const { isWorkingDay } = require('../lib/slots');

  // العيادة المربطة بحساب الطبيب التجريبي — هي التي ستُعرض في العرض
  const clinic = await db.queryOne(
    `SELECT d.id, d.name, d.available_days, d.slot_minutes
       FROM public.doctors d
      WHERE d.profile_id IS NOT NULL AND d.is_active = TRUE
      ORDER BY d.id
      LIMIT 1`
  );

  if (!clinic) {
    console.log('  ⚠ لا توجد عيادة نشطة مرتبطة بحساب — تخطّي المواعيد التجريبية.');
    return 0;
  }

  // أول يوم عمل قادم. نتجنّب الجمعة لأن available_days = "السبت - الخميس"،
  // فمواعيد على يوم راحة لا تظهر في الطابور وتبدو كخلل في المنصة.
  const toISODate = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  let today = null;
  for (let i = 0; i < 14; i += 1) {
    const candidate = new Date();
    candidate.setHours(12, 0, 0, 0);
    candidate.setDate(candidate.getDate() + i);
    const iso = toISODate(candidate);
    if (isWorkingDay(iso, clinic.available_days)) { today = iso; break; }
  }
  if (!today) {
    console.log('  ⚠ العيادة مغلقة متابعًا 14 يوماً — تخطّى المواعد التجريبية.');
    return 0;
  }

  // لا نكرّر: إن كان لهذا الطبيب مواعيد في ذلك اليوم، فالبذر سابقاً
  const existing = await db.queryOne(
    'SELECT COUNT(*)::int AS n FROM public.appointments WHERE doctor_id = $1 AND appt_date = $2',
    [clinic.id, today]
  );
  if (existing.n > 0) {
    console.log(`  ⏭ ${existing.n} موعد موجود مسبقاً في ${today} — لم يُضف شيء.`);
    return 0;
  }

  const demoPatient = await db.queryOne(
    'SELECT id, phone, full_name FROM public.profiles WHERE phone = $1',
    [toE164('0661998877')]
  );

  // خانات ضمن دوام 08:00 - 16:30 بخطوات 30 دقيقة
  const rows = [
    { time: '08:30', status: 'completed',       name: demoPatient?.full_name || 'محمد عبد السلام', phone: '0661998877', self: true },
    { time: '09:00', status: 'completed',       name: 'فاطمة بن أحمد',  phone: '0661234567', self: false },
    { time: '09:30', status: 'in_consultation', name: 'يوسف مرزوق',     phone: '0662345678', self: false },
    { time: '10:00', status: 'waiting',         name: 'أمينة قاسمي',    phone: '0663456789', self: false },
    { time: '10:30', status: 'waiting',         name: 'كريم بلقاسم',    phone: '0664567890', self: false },
    { time: '11:00', status: 'confirmed',       name: 'سليمة حداد',     phone: '0665678901', self: false },
  ];

  let queue = 0;
  for (const r of rows) {
    queue += 1;
    await db.query(
      `INSERT INTO public.appointments
         (patient_id, doctor_id, patient_name, patient_phone, appt_date, appt_time,
          queue_number, status, has_chifa, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        r.self ? demoPatient?.id ?? null : null,
        clinic.id, r.name, toE164(r.phone), today, r.time,
        queue, r.status, true,
        'موعد تجريبي — بيانات عرض فقط',
      ]
    );
  }

  // موعد مستقبلي للحساب التجريبي: بدونه تبدو صفحة "مواعدي" فارغة
  let tomorrow = null;
  for (let i = 1; i < 14; i += 1) {
    const candidate = new Date();
    candidate.setHours(12, 0, 0, 0);
    candidate.setDate(candidate.getDate() + i);
    const iso = toISODate(candidate);
    if (isWorkingDay(iso, clinic.available_days)) { tomorrow = iso; break; }
  }
  if (tomorrow && demoPatient) {
    await db.query(
      `INSERT INTO public.appointments
         (patient_id, doctor_id, patient_name, patient_phone, appt_date, appt_time,
          queue_number, status, has_chifa, notes)
       VALUES ($1,$2,$3,$4,$5,$6,1,'confirmed',$7,$8)`,
      [
        demoPatient.id, clinic.id, demoPatient.full_name, demoPatient.phone,
        tomorrow, '09:00', true, 'موعد تجريبي — بيانات عرض فقط',
      ]
    );
  }

  console.log(`  ✓ ${rows.length} موعد اليوم (${today}) + موعد مستقبلي`);
  console.log(`  ✓ العيادة: ${clinic.name}`);
  return rows.length;
}

async function main() {
  console.log('\n▸ فحص الاتصال بقاعدة البيانات...');
  const health = await db.healthCheck();
  if (!health.ok) {
    console.error(`\x1b[31m✗ فشل الاتصال: ${health.error}\x1b[0m`);
    console.error('  شغّل الترحيلات أولاً:  npm run migrate');
    process.exit(1);
  }
  console.log(`\x1b[32m✓ متصل بـ ${health.db}\x1b[0m`);

  await seedReference();
  const doctorCount = await seedDoctors();
  await seedDemoAccounts();
  await seedDemoAppointments();

  console.log('\n\x1b[32m✓ اكتملت تعبئة البيانات.\x1b[0m');
  console.log(`  إجمالي الأطباء: ${doctorCount}`);
  console.log('\n  الواجهة متصلة الآن بهذه القاعدة. شغّل: npm start ثم افتح http://localhost:4000\n');
}

main()
  .catch((err) => {
    console.error('\n\x1b[31mفشل التعبئة:\x1b[0m', err.message);
    if (err.code === '23503') {
      console.error('  السبب: مرجع غير موجود — شغّل "npm run migrate" أولاً.');
    }
    process.exit(1);
  })
  .finally(() => db.close());