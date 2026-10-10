/**
 * tests/wiring.test.js — فحوص تماسك الواجهة
 * ============================================================================
 * ليست اختبارات منطق: هي فحوص البنية التي لا يلتقطها أي متصفح ولا أي
 * استجابة HTTP. كل واحدة منها تلتقط خللاً حقيقياً حدث في هذه المنصة:
 *
 *  1. معالج مضمّن (`onclick=`)   → CSP فيه `script-src-attr 'none'` يقتله
 *                                  بصمت. حدث مرتين: 42 زراً ميتاً، والنماذج
 *                                  كانت تُرسِل الصفحة إلى `/?` فتضيع بيانات
 *                                  المريض.
 *  2. `getElementById` بلا هدف   → `null.textContent` يرمي استثناءً قبل أي
 *                                  طلب. حدث في `handleUpdateProfile`.
 *  3. `data-ui` غير مسجَّل        → زر لا يفعل شيئاً ولا خطأ في الـ console
 *                                  يصعب تتبّعه.
 *  4. تلوّث النصوص العربية       → حروف روسية/صينية بدل الكلمات العربية،
 *                                  من أداة التحرير على أسطر RTL مختلطة.
 *
 * التشغيل:  node --test tests/wiring.test.js
 * ============================================================================
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ---------------------------------------------------------------------------
// أدوات
// ---------------------------------------------------------------------------

/** يزيل تعليقات JavaScript حتى لا يُحسب شرح السطر كسمة في الشيفرة */
function stripJsComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** كل الملفات البرمجية في المشروع، بلا node_modules */
function codeFiles() {
  const out = [];
  const skip = new Set(['node_modules', '.git', 'tests']);
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|html|css|sql)$/.test(entry.name)) out.push(path.relative(ROOT, full));
    }
  })(ROOT);
  return out;
}

const HTML = ['index.html', 'patient.html', 'doctor.html', 'admin.html'].map(read).join('\n');
/** وحدات الواجهة (مقسّمة من app.js) — تُقرأ مجمّعةً لفحوص التماسك */
const JS_MODULES = [
  'js/core.js', 'js/ui.js', 'js/doctors.js', 'js/booking.js', 'js/queue.js',
  'js/dashboard.js', 'js/billing.js', 'js/auth.js', 'js/admin.js',
  'js/portal.js', 'js/init.js', 'js/init-patient.js', 'js/init-doctor.js', 'js/init-admin.js',
];
const APP = JS_MODULES.map(read).join('\n');

/** المعرّفات المعلَنة في index.html */
const HTML_IDS = new Set(
  [...HTML.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
);

/** ما يمرّره app.js إلى DOM فعلياً */
const USED_IDS = new Set(
  [...APP.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1])
);

/** الدوال المسجَّلة في القائمة البيضاء للتفويض (من كل ملفات التهيئة) */
const REGISTERED_ACTIONS = new Set(
  [...APP.matchAll(/const UI_ACTIONS = Object\.freeze\(\{([\s\S]*?)\}\);/g)]
    .flatMap((m) => m[1].split('\n'))
    .map((line) => {
      // shorthand: `name,` أو `name,` — أو `key: ...` أو `key: (...) => ...`
      const mm = line.match(/^\s*([A-Za-z_$][\w$]*)\s*(?::|,|$)/);
      return mm ? mm[1] : null;
    })
    .filter(Boolean)
);

// ---------------------------------------------------------------------------

test('لا معالجات سمات HTML مضمّنة في أي ملف', () => {
  // `on*=` في index.html أو داخل قالب HTML في JS = زر ميت تحت CSP الحالي
  const ATTR = /\son(click|submit|change|load|error|focus|blur|input|mouseover)\s*=\s*["']/g;
  const offenders = [];

  for (const rel of codeFiles()) {
    let content = read(rel);
    if (rel.endsWith('.js')) content = stripJsComments(content);
    if (rel.endsWith('.html')) content = content.replace(/<!--[\s\S]*?-->/g, ' ');

    const hits = content.match(ATTR);
    if (hits) offenders.push(`${rel}: ${[...new Set(hits)].join(', ')}`);
  }

  assert.deepStrictEqual(
    offenders, [],
    'معالجات مضمّنة تُبطلها script-src-attr:\n' + offenders.join('\n')
  );
});

test('كل معرّف يقرأه app.js موجود في index.html', () => {
  const missing = [...USED_IDS].filter((id) => !HTML_IDS.has(id)).sort();

  assert.deepStrictEqual(
    missing, [],
    'app.js يقرأ عناصر غير موجودة — كل قراءة تُنتج null:\n' + missing.map((m) => '  #' + m).join('\n')
  );
});

test('كل data-ui مسجَّل في القائمة البيضاء', () => {
  const used = [...new Set([...HTML.matchAll(/data-ui="([^"]+)"/g)].map((m) => m[1]))];
  const unregistered = used.filter((name) => name !== 'print' && !REGISTERED_ACTIONS.has(name));

  assert.deepStrictEqual(
    unregistered, [],
    'أزرار لا تفعل شيئاً — أضف الدالة إلى UI_ACTIONS:\n' + unregistered.join('\n')
  );
});

test('كل data-submit يقابل دالة حقيقية في app.js', () => {
  const used = [...new Set([...HTML.matchAll(/data-submit="([^"]+)"/g)].map((m) => m[1]))];
  const orphans = used.filter(
    (name) => !new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).test(APP)
  );

  assert.deepStrictEqual(
    orphans, [],
    'نماذج بلا معالج — الإرسال الافتراضي يمسح ما كتبه المستخدم:\n' + orphans.join('\n')
  );
});

test('كل data-change مسجَّل في القائمة البيضاء', () => {
  const used = [...new Set([...HTML.matchAll(/data-change="([^"]+)"/g)].map((m) => m[1]))];
  const unregistered = used.filter((name) => !REGISTERED_ACTIONS.has(name));

  assert.deepStrictEqual(unregistered, [], 'أزرار تغيير غير مسجّلة:\n' + unregistered.join('\n'));
});

test('قوائم النماذج لا تحمل قيماً منقوطة ولا سمات ملتصقة', () => {
  // خطأ تكرار في أداة التحويل: data-arg="'all'" بدل data-arg="all"
  assert.ok(!/data-arg="''/.test(HTML), 'قيم data-arg ملفوفة بعلامات تنصيص');
  assert.ok(!/"data-(ui|submit|change|arg)=/.test(HTML), 'سمات ملتصقة بسابقة الفاصلة');
  assert.ok(!/\sdata-arg=""/g.test(HTML), 'data-arg فارغ — القيمة ستُرسل كـ null');
});

test('لا قوائم مرجعية ثابتة بالأسماء العربية', () => {
  // commune_id و specialty_id مفتاحان أجنبيان. إرسال الاسم العربي
  // كان يرجع 400 bad_reference عند كل تسجيل.
  const hardcoded = [...HTML.matchAll(/<option value="(?!")([^"]*[؀-ۿ][^"]*)"/g)];
  const allowed = new Set(['print', 'none']);
  const offenders = hardcoded.map((m) => m[1]).filter((v) => !allowed.has(v));

  assert.deepStrictEqual(
    offenders, [],
    'قيم عربية في value حيث يُتوقع معرّف من الخادم:\n' + offenders.join('\n')
  );
});

test('لا تلوّث نصّي في الملفات العربية', () => {
  // حروف روسية/صينية/يابانية بدل كلمات — نتيجة تلف التعليقات على أسطر RTL
  const BAD = /[\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF]/;
  const offenders = [];

  // يشمل خادم الجلسات لا الواجهة وحدها: التلوّث حدث في server/ أيضاً،
  // وفحص الواجهة وحدها كان سيمرّ بينما الملف فيه نص تالف مقروء.
  for (const rel of codeFiles()) {
    read(rel).split(/\r?\n/).forEach((line, i) => {
      if (BAD.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 60)}`);
    });
  }

  assert.deepStrictEqual(offenders, [], 'تعليقات تالفة:\n' + offenders.join('\n'));
});

test('لا دالة معرَّفة مرتين في الملف نفسه', () => {
  // JavaScript لا يصرخ عند التعريف المكرر: الدالة التالية تبتلع السابقة
  // في app.js كانت هناك نسختان من showToast:
  //   1) الكامل: تمييز + تهريب + أقونات + وعاء #toast-container
  //   2) أبسطها: صندوق أسود يُلحق بـ document.body يتجاهل الوسيط الثاني
  // النسخة الثانية كانت هي التي تعمل، فكل رسائل الخطأ والتأكيد كانت
  // تظهر بلا تمييز ولا محاذاة. لم يلتقطها أي فحص ولا المتصفح: زر يعمل،
  // رسالة تظهر. لكن الرسالة الخاطئة تصل للمستخدم عند فشل حجز.
  const targets = [...JS_MODULES, 'js/api.js', 'server/routes/auth.js', 'server/routes/doctors.js'];
  const duplicates = [];

  for (const rel of targets) {
    const seen = new Map();
    read(rel).split(/\r?\n/).forEach((line, i) => {
      const m = line.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
      if (!m) return;
      if (!seen.has(m[1])) seen.set(m[1], []);
      seen.get(m[1]).push(i + 1);
    });
    for (const [name, lines] of seen) {
      if (lines.length > 1) duplicates.push(`${rel}: ${name} -> ${lines.join(', ')}`);
    }
  }

  assert.deepStrictEqual(duplicates, [], 'دوال مكررة (الأخيرة تبتلع السابقة):\n' + duplicates.join('\n'));
});

test('رسائل التنبيه تصل إلى وعاء واحد متناسق', () => {
  // showToast المعتمدة تكتب في #toast-container وتقبل نوعاً (success/error/info).
  // نسخة مبسطة كانت تكتب مباشرة في body وتتجاهل النوع، فلا يميّز الخطأ
  // عن النجاح. نتحقق أن لا يوجد كاتب ثانٍ ينشئ عناصر توست خاصة به.
  const fn = APP.match(/^function showToast\([\s\S]*?^}/m);
  assert.ok(fn, 'لم يُعثر على showToast');
  assert.ok(/getElementById\('toast-container'\)/.test(fn[0]),
    'showToast لا تستخدم الوعاء الموحّد #toast-container');
  assert.ok(/type\s*=\s*'success'/.test(fn[0]),
    'showToast لا تقبل نوع الرسالة (success/error/info)');
  assert.ok(/api\.escape\(/.test(fn[0]),
    'showToast لا تهرّب الرسالة — رسالة من الخادم قد تحوي HTML');

  const shadowWriters = APP.split(/\r?\n/)
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /body\.appendChild\(\s*(toast|el|div)\s*\)/.test(line));
  assert.deepStrictEqual(
    shadowWriters.map(({ n, line }) => `${n}: ${line.trim()}`),
    [],
    'تنبيهات تُلحق مباشرة بـ body بدل الوعاء الموحّد'
  );
});

test('رسالة تحمل ⚠️ لا تُعرض بلون النجاح', () => {
  // showToast الافتراضي 'success' أي أخضر بعلامة صح. ترك رسالة تحذير
  // على هذا الافتراضي يجعل «تعذّر الحجز» يبدو «تم الحجز» — وهذا أخطر
  // من غياب الرسالة. كل استدعاء يحمل ⚠️ يجب أن يصرّح بنوعه.
  // الاستثناء الوحيد المسموح: 'error' أو 'info' صراحةً في الاستدعاء.
  const offenders = [];
  APP.split(/\r?\n/).forEach((line, i) => {
    if (!/showToast\(/.test(line)) return;
    if (/function showToast/.test(line)) return;
    if (!/\u26a0/.test(line)) return;                 // لا تحذير في النص
    if (/,\s*'(error|info)'\s*\)/.test(line)) return; // مُصنَّف بشكل صحيح
    offenders.push(`${i + 1}: ${line.trim()}`);
  });

  assert.deepStrictEqual(
    offenders, [],
    'رسائل تحذير بلا نوع — ستظهر خضراء بعلامة صح:\n' + offenders.join('\n')
  );
});


test('حالة العيادة محفوظة مع الجلسة وتُقرأ من الخادم', () => {
  // السبب:
  // كان setSession(token, user) يخزّن المستخدم فقط، فيضيع كائن العيادة
  // المرسل من الخادم. النتيجة: عيادة مسجّلة وبانتظار مراجعة الإدارة كانت
  // تُدخل الطبيب إلى لوحة تحكم عادية فارغة بلا أي تفسير، فيظنّ أن عيادته
  // معطّلة، أو أسوأ: يظنّ أنها تعمل ولا يجد مرضى.
  const apiSrc = read('js/api.js');

  assert.ok(/setSession\(\s*token\s*,\s*user\s*,\s*clinic\s*\)/.test(apiSrc),
    'setSession لا يقبل حالة العيادة — تضيع عند كل تسجيل دخول');

  assert.ok(/getClinic\(\)/.test(apiSrc),
    'لا يوجد قارئ لحالة العيادة المخزّنة');

  // كل نقطة كتابة للجلسة تمرّر العيادة صراحةً، والدخول بحساب بلا عيادة
  // يمسح أي عيادة قديمة حتى لا تتسرّب من جلسة سابقة.
  const calls = APP.split(/\r?\n/)
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /api\.setSession\(/.test(line));
  assert.ok(calls.length >= 4, 'عدد غير متوقع من نداءات setSession: ' + calls.length);

  for (const { n, line } of calls) {
    const tail = line.slice(line.indexOf('api.setSession('));
    assert.match(
      tail,
      /(result\.clinic|state\.currentUser|me\.user|,\s*clinic\s*\))/,
      'L' + n + ': setSession بلا حالة العيادة — ستضيع أو تبقى قديمة'
    );
  }

  // الخروج وانتهاء الجلسة يمسحان العيادة
  const logout = APP.match(/function handleLogout\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(logout && /state\.clinic = null/.test(logout[0]),
    'handleLogout لا يمسح state.clinic');
  assert.ok(
    /shifa:session-expired[\s\S]{0,400}?state\.clinic = null/.test(APP),
    'انتهاء الجلسة لا يمسح state.clinic'
  );

  // الإقلاع يسأل الخادم: حالة العيادة تتغيّر من طرفه عبر أداة التفعيل،
  // فقيمة localStorage قد تكون قديمة.
  assert.ok(/async function refreshClinicState\(\)/.test(APP),
    'لا توجد دالة لتحديث حالة العيادة من الخادم');
  const refresh = APP.match(/async function refreshClinicState\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(refresh && /api\.me\(\)/.test(refresh[0]),
    'refreshClinicState لا تسأل الخادم — الواجهة تخمّن');
  assert.ok(/await refreshClinicState\(\)/.test(APP),
    'refreshClinicState لا تُستدعى عند الإقلاع');

  // والواجهة تُظهر ذلك صراحةً (في واجهة الطبيب)
  assert.ok(/id="clinic-pending-banner"/.test(read('doctor.html')),
    'لا توجد شارة "بانتظار المراجعة" في واجهة الطبيب');
  assert.match(
    APP,
    /isPendingDoctor[\s\S]{0,200}?pendingBanner\.style\.display = isPendingDoctor \? 'flex' : 'none'/,
    'الشارة لا تُعرض أو تُخفى حسب حالة العيادة'
  );
});

test('تسجيل الدخول يُرجع حالة العيادة مثل /api/auth/me', () => {
  // السبب:
  // /api/auth/me كان يُرجع العيادة بحالة التفعيل، أما /api/auth/login فلا.
  // فحفظ العميل الحالة فارغةً بعد الدخول، وبقيت فارغةً حتى الإقلاع التالي،
  // والطبيب المعلَّق يرى لوحة فارغة بلا تفسير.
  const auth = read('server/routes/auth.js');

  const login = auth.match(/router\.post\('\/login'[\s\S]*?\n\}\)\);/);
  assert.ok(login, 'لم يُعثر على مسار تسجيل الدخول');
  assert.match(login[0], /clinic:\s*await clinicForProfile\(/,
    '/login لا يُرجع حالة العيادة');

  // /me يستخدم نفس الدالة حتى لا تختلف الصيغة بين المسارين
  const me = auth.match(/router\.get\('\/me'[\s\S]*?\n\}\)\);/);
  assert.ok(me, 'لم يُعثر على مسار /me');
  assert.match(me[0], /clinic:\s*clinicForProfile|await clinicForProfile\(/,
    '/me لا يستخدم clinicForProfile');

  // الدالة نفسها موجودة وتُشتق pending من is_active
  const helper = auth.match(/async function clinicForProfile\([\s\S]*?\n\}/);
  assert.ok(helper, 'الدالة clinicForProfile غير موجودة');
  assert.match(helper[0], /pending:\s*!clinic\.is_active/,
    'clinicForProfile لا تُشتق pending من is_active');
  assert.match(helper[0], /is_demo:/,
    'clinicForProfile لا تُرجع is_demo');
  // لا نسخة مُكرّرة من استعلام العيادة خارج الدالة
  const queries = (auth.match(/FROM public\.doctors WHERE profile_id/g) || []).length;
  assert.strictEqual(queries, 1,
    'استعلام عيادة الحساب مكرّر ' + queries + ' مرة — ليمرّ عبر clinicForProfile وحدها');
});
// ---------------------------------------------------------------------------
// ترحيلات قاعدة البيانات
// ---------------------------------------------------------------------------
// كل ما تحت هذا القسم سببه حادثة واحدة حقيقية، وليست تخوّفاً نظرياً:
//
//   حدث أن كانت جداول التطبيق موجودة بينما جدول _migrations كان فارغاً.
//   عندها ظنّ `npm run migrate` أن كل الترحيلات جديدة، فنفّذ
//   000_drop_legacy.sql — وهو "DROP TABLE IF EXISTS appointments" صِرف —
//   على قاعدة فيها بيانات. النتيجة: ضاع كل جدول المواعيد وكل محتواه.
//
//   الفحصان أدناه يمنعان تكرارها من جهتين:
//     1) الحارس داخل الملف نفسه: لا يُسقط جدولاً غير فارغ أبداً.
//     2) الحارس داخل المُشغّل: يرفض العمل إذا وجد جداول بلا سجل.
// ---------------------------------------------------------------------------

test('ترحيل 000 لا يُسقط جدولاً غير فارغ أبداً', () => {
  const sql = read('server/db/migrations/000_drop_legacy.sql');

  // كل سطر ينفّذ DROP. الشرط الحاكم: لا بدّ أن يكون عبر EXECUTE داخل
  // كتلة شرطية، فالسطر الأول أدناه كان "DROP TABLE IF EXISTS" صِرفاً.
  const dropLines = sql
    .split(/\r?\n/)
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /\bDROP\s+TABLE\b/i.test(line) && !/^\s*--/.test(line));

  assert.ok(dropLines.length > 0, 'لم يُعثر على أي DROP TABLE — هل تغيّر الملف؟');

  const unsafe = dropLines.filter(({ line }) => !/EXECUTE\s+'DROP TABLE/i.test(line.trim()));
  assert.deepStrictEqual(
    unsafe.map(({ n, line }) => `${n}: ${line.trim()}`),
    [],
    'أسطر إسقاط تُنفَّذ بلا فحص سابق على عدد الصفوف'
  );

  // الفحص نفسه: عدد الصفوف > 0 يعني "هذا جدول الإنتاج، لا الجدول القديم"
  assert.ok(/row_count\s*>\s*0/.test(sql), 'لا يوجد شرط يمنع إسقاط جدول غير فارغ');
  // و existance الجدول نفسه شرط قبل أي قراءة
  assert.ok(/to_regclass/.test(sql), 'لا يوجد فحص لوجود الجدول أصلاً');
});

test('مُشغّل الترحيلات يرفض العمل على قاعدة بلا سجل', () => {
  const migrate = read('server/db/migrate.js');

  assert.ok(
    /assertNoOrphanSchema/.test(migrate),
    'migrate.js لا يحرس ضد حالة "الجداول موجودة والسجل فارغ"'
  );
  assert.ok(
    /to_regclass|_migrations/.test(migrate) && /process\.exit\(1\)/.test(migrate),
    'الحارس يجب أن يوقف التنفيذ ويشرح السبب'
  );

  // الحارس يجب أن يُستدعى قبل قراءة قائمة الملفات المعلّقة وتنفيذها
  const guardCall = migrate.indexOf('await assertNoOrphanSchema(');
  const runStart = migrate.indexOf('await db.transaction(');
  assert.ok(guardCall > 0, 'الحارس غير مستدعى');
  assert.ok(guardCall < runStart, 'الحارس يُستدعى بعد بدء تنفيذ الترحيلات — متأخر جداً');
});

test('تسجيل الطبيب يملأ كل أعمدة doctors الإلزامية', () => {
  // كل عمود NOT NULL بلا افتراضي يجب أن comes من نموذج التسجيل،
  // وإلاطبيب ينتهي حساباً بلا عيادة ولا يظهر أبداً.
  const auth = read('server/routes/auth.js');
  const insert = auth.match(/INSERT INTO public\.doctors[\s\S]*?VALUES[\s\S]*?\);/);

  assert.ok(insert, 'لم يُعثر على إدراج في جدول doctors داخل مسار التسجيل');
  const body = insert[0];

  for (const column of ['specialty_id', 'commune_id', 'address', 'lat', 'lng', 'phone', 'name', 'title']) {
    assert.ok(
      body.includes(column),
      `العمود ${column} غير مذكور في إدراج العيادة — سيُنشأ حساب طبيب بلا عيادة`
    );
  }

  // العيادة الجديدة معطّلة: لا تنشر عيادة غير موثّقة للعامة
  assert.ok(/is_active\s*,\s*is_demo/i.test(body) || /FALSE,\s*FALSE/i.test(body),
    'يجب إنشاء العيادة مع is_active = FALSE و is_demo = FALSE');
  assert.ok(/is_demo/i.test(body), 'يجب تحديد is_demo صراحةً عند الإنشاء');
});

// ---------------------------------------------------------------------------
// حقول تسجيل الطبيب في الواجهة
// ---------------------------------------------------------------------------

test('نموذج تسجيل الطبيب يطلب تخصصاً وعنواناً وهاتف عيادة', () => {
  for (const id of ['signup-specialty', 'signup-address', 'signup-clinic-phone']) {
    assert.ok(HTML.includes(`id="${id}"`), `index.html ينقص الحقل #${id}`);
    assert.ok(
      APP.includes(`getElementById('${id}')`),
      `app.js لا يقرأ #${id} — الحقل يُملأ ولا يُرسَل`
    );
  }

  // الخادم يرفض الطلب إن غابت، فلا بدّ أن يقرأها app.js ويرسلها.
  // النقش يتوقف عند قوس الإغلاق في بداية السطر (نهاية الدالة) لا عند
  // أول قوس داخلي — وهو ما كان يجعل الفحص يمرّ على نصف الدالة فقط.
  const handler = APP.match(/async function handleSignupSubmit[\s\S]*?^\}/m);
  assert.ok(handler, 'لم يُعثر على handleSignupSubmit');
  // كل حقل: يُقرأ من النموذج، ثم يُرسَل داخل payload
  const FIELD_IDS = { specialtyId: 'signup-specialty', address: 'signup-address', clinicPhone: 'signup-clinic-phone' };
  for (const [field, elementId] of Object.entries(FIELD_IDS)) {
    assert.ok(
      handler[0].includes(`getElementById('${elementId}')`),
      `الحقل ${field} لا يُقرأ من النموذج (#${elementId})`
    );
    assert.ok(
      new RegExp(`payload\\.${field}\\s*=`).test(handler[0]),
      `الحقل ${field} لا يُرسَل إلى الخادم`
    );
  }

  // النص في الواجهة كان يقول 6 محارف والخادم يقبل 8: مستخدم يكتب 7
  // فيمرّ من النموذج ثم يُرفض بلا سبب مفهوم.
  assert.ok(
    !/minlength="6"/.test(HTML),
    'النموذج يسمح بـ 6 محارف بينما الخادم يشترط 8'
  );
});

// ---------------------------------------------------------------------------
// شفافية البيانات التجريبية
// ---------------------------------------------------------------------------

test('العيادات التجريبية موسومة ومُعلَنة في الواجهة', () => {
  // 1) العمود موجود في القاعدة
  assert.ok(
    /ADD COLUMN IF NOT EXISTS is_demo/.test(read('server/db/migrations/003_doctor_onboarding.sql')),
    'لا يوجد عمود is_demo — الواجهة لن تستطيع تمييز البيانات التجريبية'
  );

  // 2) يُ reaching العمود من الخادم (قائمة بيضاء صريحة، لا SELECT *)
  assert.ok(/d\.is_demo/.test(read('server/routes/doctors.js')),
    'is_demo ليس ضمن الأعمدة المُرجَعة للواجهة');

  // 3) يصل إلى كائن الطبيب في المتصفح
  assert.ok(/isDemo:/.test(read('js/api.js')), 'normalizeDoctor لا يمرّر isDemo');

  // 4) تظهر للمستخدم، لا في الكود فقط
  assert.ok(/doc-demo-badge/.test(APP), 'لا شارة "بيانات تجريبية" على بطاقة الطبيب');
  assert.ok(/demo-data-notice/.test(APP), 'لا تنبيه يشرح أن القائمة بيانات تجريبية');
  assert.ok(/doc-demo-badge/.test(read('css/style.css')), 'لا تنسيق للشارة');
});

test('الوثائق لا تَعِد بميزات غير موجودة', () => {
  // اقتباسات وردت في توثيق سابق عن بوابة دفع وRealtime لا وجود لهما
  const forbidden = [
    { re: /Supabase Realtime/i, must: /لا\s+(?:يوجد|توجد)|غير\s+موجود|ليس/, label: 'Supabase Realtime' },
    { re: /بوابة\s+دفع/, must: /لا\s+(?:يوجد|توجد)|غير\s+موجود|ليس|مؤجّل|تؤجّل/, label: 'بوابة دفع' },
  ];

  for (const rel of ['README.md', 'AGENT_HANDOVER.md']) {
    const lines = read(rel).split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const { re, must, label } of forbidden) {
        if (re.test(line) && !must.test(line)) {
          assert.fail(`${rel}:${i + 1} يذكر ${label} بلا نفي — ${line.trim().slice(0, 80)}`);
        }
      }
    });
  }
});
test('نظام التقييمات مكتمل: migration + API + واجهة', () => {
  // 1) migration موجود
  const mig = read('server/db/migrations/008_reviews.sql');
  assert.ok(/CREATE TABLE.*reviews/.test(mig), 'لا جدول reviews في migration 008');
  assert.ok(/refresh_doctor_rating/.test(mig), 'لا دالة تحديث التقييم');

  // 2) API endpoints
  const routes = read('server/routes/doctors.js');
  assert.ok(/\/:id\/reviews/.test(routes), 'لا مسار GET /:id/reviews');
  assert.ok(/router\.post\('\/:id\/reviews'/.test(routes), 'لا مسار POST /:id/reviews');

  // 3) دوال الواجهة
  const doctorsJs = read('js/doctors.js');
  assert.ok(/function renderStars/.test(doctorsJs), 'لا دالة renderStars');
  assert.ok(/function openReviewModal/.test(doctorsJs), 'لا دالة openReviewModal');
  assert.ok(/function submitReview/.test(doctorsJs), 'لا دالة submitReview');

  // 4) النافذة في patient.html
  const patientHtml = read('patient.html');
  assert.ok(/id="review-modal"/.test(patientHtml), 'لا نافذة review-modal');
  assert.ok(/data-submit="submitReview"/.test(patientHtml), 'لا نموذج submitReview');
});

test('نظام i18n: قاموس عربي/فرنسي وزر التبديل', () => {
  const i18n = read('js/i18n.js');
  assert.ok(/I18N_STRINGS/.test(i18n), 'لا قاموس I18N_STRINGS');
  assert.ok(/\bar:\s*\{/.test(i18n), 'لا قاموس عربي');
  assert.ok(/\bfr:\s*\{/.test(i18n), 'لا قاموس فرنسي');
  assert.ok(/function setLang/.test(i18n), 'لا دالة setLang');
  assert.ok(/function toggleLang/.test(i18n), 'لا دالة toggleLang');

  for (const page of ['patient.html', 'doctor.html']) {
    const html = read(page);
    assert.ok(/js\/i18n\.js/.test(html), `${page}: لا تحميل i18n.js`);
    // قرار 2026-10-09: زر التبديل مُزال مؤقتاً (ترجمة جزئية أسوأ من لا ترجمة)
    // — البنية تبقى محمّلة حتى تكتمل الترجمة الكاملة في مشروع لاحق.
    assert.ok(!/data-ui="toggleLang"/.test(html), `${page}: زر toggleLang يجب أن يبقى مُزالاً مؤقتاً`);
  }
});
