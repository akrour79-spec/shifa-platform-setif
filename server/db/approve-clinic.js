/**
 * db/approve-clinic.js — تفعيل عيادة مسجّلة حديثاً
 * -----------------------------------------------------------------------------
 * الاستخدام:
 *   npm run approve-clinic -- list
 *   npm run approve-clinic -- <هاتف الطبيب>
 *   npm run approve-clinic -- <هاتف الطبيب> --lat 36.19 --lng 5.41 --price 2500
 *   npm run approve-clinic -- <هاتف الطبيب> --hours "08:00 - 17:00" --days "السبت - الخميس"
 *   npm run approve-clinic -- <هاتف الطبيب> --yes
 *
 * لماذا هذه الأداة:
 *   التسجيل ينشئ العيادة معطّلة (is_active = FALSE) عمداً، حتى لا تظهر
 *   عيادة غير موثّقة أمام المرضى ولا تقبل حجزاً. لكن المنصة لم تكن
 *   تملك أي وسيلة لتفعيلها: لا لوحة إدارة، ولا مسار HTTP. فكان الخيار
 *   الوحيد SQL يدوي لا يستطيع تنفيذه إلا مبرمج.
 *
 * لماذا تأكيد قبل التنفيذ:
 *   التفعيل ينشر الاسم والتخصص والعنوان والهاتف للعامة، ويحوّل دبوس
 *   الخريطة من قيمة مؤقتة (مركز سطيف) إلى إحداثيات حقيقية. لذلك نطبع
 *   ما سيتغيّر أولاً، ونطلب Enter. الخيار --yes يتجاوز ذلك للسير العمل
 *   الآلي، وهو استثناء صريح لا سلوك افتراضي.
 */

'use strict';

const db = require('./index');
const { SETIF_CENTER } = require('../lib/constants');
const { normalizeAlgerianClinicPhone, toNationalDigits, formatForDisplay } = require('../lib/phone');

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function fail(msg, hint) {
  console.error(`\n${C.red}✗ ${msg}${C.reset}`);
  if (hint) console.error(`  ${C.dim}${hint}${C.reset}`);
  console.error('');
  process.exit(1);
}

/** يقرأ قيمة --key-value من process.argv */
function readFlag(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return argv[i + 1];
}

function parseNumber(value, label, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    fail(`${label} غير صالح: ${value}`, `المسموح بين ${min} و ${max}`);
  }
  return n;
}

const WORK_HOURS_RE = /^([01]\d|2[0-3]):[0-5]\d\s*-\s*([01]\d|2[0-3]):[0-5]\d$/;

// ---------------------------------------------------------------------------
// عرض القائمة
// ---------------------------------------------------------------------------

async function listClinics() {
  const rows = await db.query(
    `SELECT d.id, d.name, d.title, d.phone, d.is_active, d.is_demo,
            p.phone AS account_phone, p.full_name
       FROM public.doctors d
       LEFT JOIN public.profiles p ON p.id = d.profile_id
      ORDER BY d.is_active, d.name`
  );

  if (rows.length === 0) {
    console.log(`\n${C.yellow}لا توجد عيادات مسجّلة بعد.${C.reset}\n`);
    return;
  }

  const pending = rows.filter((r) => !r.is_active);

  console.log(`\n${C.bold}العيادات المسجّلة (${rows.length})${C.reset}`);
  console.log(`${C.dim}  ${'الاسم'.padEnd(24)}${'الحساب'.padEnd(16)}${'الحالة'.padEnd(10)}التخصص${C.reset}`);

  for (const r of rows) {
    const tag = r.is_active ? `${C.green}مفعّلة${C.reset}` : `${C.yellow}بانتظار${C.reset}`;
    const demo = r.is_demo ? ` ${C.dim}[تجريبية]${C.reset}` : '';
    const account = r.account_phone
      ? formatForDisplay(r.account_phone)
      : (r.phone ? formatForDisplay(r.phone) : 'بلا حساب');
    console.log(
      `  ${String(r.name).padEnd(22)}${account.padEnd(18)}${tag.padEnd(20)}${r.title}${demo}`
    );
  }

  if (pending.length > 0) {
    console.log(`\n${C.cyan}▸ لتفعيل عيادة:${C.reset} npm run approve-clinic -- <رقم حساب الطبيب>`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// التفعيل
// ---------------------------------------------------------------------------

async function approve(argv) {
  const assumeYes = argv.includes('--yes') || argv.includes('-y');
  const raw = argv.find((a) => /^[\d\s+]+$/.test(a));
  if (!raw) {
    fail('الاستخدام: npm run approve-clinic -- <هاتف الطبيب> [خيارات]');
  }

  // نقبل النقّال والثابت: عيادات سطيف تعلن أرقاماً ثابتة، والرقم المخزَّن
  // قد يكون دولياً (E.164) أو وطنياً بحسب مسار الإدخال الذي أنشأ الصف.
  const norm = normalizeAlgerianClinicPhone(raw);
  if (!norm.ok) fail(`رقم غير صالح: ${raw}`, norm.reason);

  // المطابقة على الأرقام لا على الصيغة. صفوف البذر خزّنت أرقامها وطنية
  // بمسافات، والتسجيل الجديد يخزّن دولياً. بحث نصّي على قيمة واحدة كان
  // يفشل بصمت على نصف العيادات.
  const national = toNationalDigits(raw);
  const clinic = await db.queryOne(
    `SELECT d.id, d.name, d.title, d.address, d.phone, d.is_active, d.lat, d.lng,
            d.price, d.work_hours, d.available_days,
            p.full_name, p.phone AS account_phone
       FROM public.doctors d
       LEFT JOIN public.profiles p ON p.id = d.profile_id
      WHERE p.phone = $1
         OR d.phone = $1
         OR regexp_replace(d.phone, '\\D', '', 'g') = $2
         OR regexp_replace(COALESCE(p.phone, ''), '\\D', '', 'g') = $2
      LIMIT 1`,
    [norm.e164, national]
  );

  if (!clinic) {
    fail(`لا توجد عيادة مرتبطة بالرقم ${norm.e164}`);
  }

  const latFlag = readFlag(argv, 'lat');
  const lngFlag = readFlag(argv, 'lng');
  const priceFlag = readFlag(argv, 'price');
  const hoursFlag = readFlag(argv, 'hours');
  const daysFlag = readFlag(argv, 'days');

  const nextLat = latFlag !== undefined ? parseNumber(latFlag, 'خط العرض', -90, 90) : Number(clinic.lat);
  const nextLng = lngFlag !== undefined ? parseNumber(lngFlag, 'خط الطول', -180, 180) : Number(clinic.lng);
  const nextPrice = priceFlag !== undefined ? parseNumber(priceFlag, 'السعر', 0, 1_000_000) : Number(clinic.price);
  const nextHours = hoursFlag || clinic.work_hours;
  const nextDays = daysFlag || clinic.available_days;

  if (!WORK_HOURS_RE.test(nextHours)) {
    fail(`ساعات العمل غير صالحة: ${nextHours}`, 'الصيغة المطلوبة: "08:00 - 16:30"');
  }
  if (nextHours.split('-')[0].trim() >= nextHours.split('-')[1].trim()) {
    fail(`بداية الدوام يجب أن تكون قبل نهايته: ${nextHours}`);
  }

  // القيمة الافتراضية للإحداثيات هي مركز سطيف. نشرها تعني أن كل مريض
  // سيصل على الخريطة إلى نقطة خاطئة — لذلك ننبّه ونطلب تمريرها صراحةً.
  const pinIsPlaceholder =
    nextLat === SETIF_CENTER.lat && nextLng === SETIF_CENTER.lng;

  console.log(`\n${C.bold}العيادة:${C.reset} ${clinic.name}`);
  console.log(`  ${C.dim}الحساب:${C.reset}    ${clinic.full_name || '(غير مرتبط بحساب)'}`);
  if (clinic.account_phone) {
    console.log(`  ${C.dim}الهاتف:${C.reset}    ${formatForDisplay(clinic.account_phone)}`);
  }
  console.log(`  ${C.dim}التخصص:${C.reset}    ${clinic.title}`);
  console.log(`  ${C.dim}العنوان:${C.reset}   ${clinic.address || '(غير محدد)'}`);
  console.log(`  ${C.dim}الحالة:${C.reset}    ${clinic.is_active ? 'مفعّلة' : 'بانتظار التفعيل'}`);

  console.log(`\n${C.bold}القيم بعد التفعيل:${C.reset}`);
  console.log(`  الإحداثيات : ${nextLat}, ${nextLng}`);
  console.log(`  السعر       : ${nextPrice} دج`);
  console.log(`  الدوام      : ${nextHours}`);
  console.log(`  أيام العمل  : ${nextDays}`);

  if (pinIsPlaceholder) {
    console.log(`\n  ${C.yellow}تحذير: الإحداثيات هي القيمة المؤقتة لمركز سطيف.${C.reset}`);
    console.log(`  ${C.dim}إن تُركت، ستظهر العيادة في مكان خاطئ على الخريطة.${C.reset}`);
    console.log(`  ${C.dim}لضبطها: --lat <رقم> --lng <رقم>${C.reset}`);
  }

  if (!clinic.is_active) {
    console.log(`\n  ${C.yellow}هذا يجعل العيادة ظاهرة للمرضى وتستقبل حجوزات حقيقية.${C.reset}`);
  }

  if (!(await confirm(assumeYes))) {
    console.log(`\n${C.dim}أُلغيت العملية. لم يتغيّر شيء.${C.reset}\n`);
    return;
  }

  const updated = await db.queryOne(
    `UPDATE public.doctors
        SET is_active = TRUE, lat = $2, lng = $3, price = $4,
            work_hours = $5, available_days = $6
      WHERE id = $1
      RETURNING id, name, is_active, is_demo, lat, lng, price`,
    [clinic.id, nextLat, nextLng, nextPrice, nextHours, nextDays]
  );

  console.log(`\n${C.green}✓ فُعّلت: ${updated.name}${C.reset}`);
  console.log(`  ${C.dim}المعرّف:${C.reset} ${updated.id}   ${C.dim}بيانات تجريبية:${C.reset} ${updated.is_demo}`);
  console.log(`  ${C.dim}يستطيع الطبيب الآن الدخول إلى الطابور ولوحة العيادة.${C.reset}\n`);
}

// ---------------------------------------------------------------------------
// التأكيد
// ---------------------------------------------------------------------------

/** Enter للتأكيد. بلا وحدة تحكّم تفاعلية: لا يُنفَّذ شيء بصمت. */
function confirm(assumeYes) {
  if (assumeYes) {
    console.log(`\n${C.yellow}--yes: تأكيد صريح من سطر الأوامر.${C.reset}`);
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const stdin = process.stdin;

    if (!stdin.isTTY) {
      console.error(`\n${C.red}لا يمكن التأكيد: لا توجد وحدة تحكّم تفاعلية.${C.reset}`);
      console.error(`${C.dim}هذا الإجراء يعلن العيادة للمريضين.${C.reset}`);
      console.error(`${C.dim}أضف --yes للتنفيذ من سطر الأوامر أو من سير عمل آلي.${C.reset}\n`);
      resolve(false);
      return;
    }

    console.log(`\n${C.cyan}اضغط Enter للتأكيد، أو أي مفتاح آخر للإلغاء...${C.reset}`);
    stdin.resume();
    stdin.setEncoding('utf8');

    const onData = (chunk) => {
      stdin.removeListener('data', onData);
      stdin.pause();
      resolve(chunk.trim() === '');
    };
    stdin.on('data', onData);
  });
}

// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  console.log('\n▸ فحص الاتصال بقاعدة البيانات...');

  const health = await db.healthCheck();
  if (!health.ok) {
    fail(`فشل الاتصال: ${health.error}`, 'تحقّق من DATABASE_URL في ملف .env');
  }
  console.log(`${C.green}✓ متصل بـ ${health.db}${C.reset}`);

  if (argv.length === 0 || argv[0] === 'list' || argv[0] === '--list') {
    await listClinics();
    return;
  }

  await approve(argv);
}

main()
  .catch((err) => fail(`خطأ غير متوقع: ${err.message}`))
  .finally(() => db.close());