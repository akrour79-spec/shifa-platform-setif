/**
 * Shifa Platform — core.js
 * ----------------------------------------------------------------------------
 * مقسّم من js/app.js إلى وحدات حسب الميزة (سكربتات كلاسيكية، نطاق عام مشترك).
 * يُحمَّل بالترتيب المذكور في index.html — لا تغيّر الترتيب.
 */

/**
 * Shifa Platform - Main Application Logic
 * منصة شفاء - المحرك التفاعلي للمواعيد، الخريطة، طابور الانتظار وبوابة الاشتراكات
 */

// =========================================================================
// ⚠️ تغيير أمني مهم — الاتصال بقاعدة البيانات عبر الخادم فقط
// =========================================================================
// كان هذا الملف يحتوي مفتاح Supabase anonHardcoded الذي كان يتيح لأي شخص
// قراءة وتعديل جدول المواعيد مباشرة من المتصفح. أُزيل بالكامل.
//
// كل البيانات الآن تمرّ عبر js/api.js ← الخادم Express ← قاعدة البيانات،
// والخادم هو من يتحقق من الهوية والصلاحيات.
// =========================================================================

// State Management
// -----------------------------------------------------------------------------
// ملاحظة أمنية: لا تُحمَّل بيانات المرضى من localStorage.
// كانت المواعيد تُحفظ محلياً بأسماء وأرقام هواتف، وهو خطأ بحد ذاته:
//   • البيانات موجودة على جهاز مشترك بدون تشفير
//   • لا تتزامن بين الأجهزة إطلاقاً
//   • يمكن للمريض تعديل حالة موعده بنفسه من المتصفح
// المواعيد الآن تأتي من الخادم عند refreshAppointments() فقط.
// ملاحظة: قائمة الأطباء تبدأ فارغة. المصدر الوحيد للحقيقة هو الخادم.
// INITIAL_DOCTORS لم تعد تُستخدم كبيانات عرض — فقط كقيمة احتياطية إن
// فشل الخادم، وحينها نعرض رسالة خطأ صريحة بدل تمثيل بيانات ثابتة كأنها حقيقية.
const state = {
    doctors: [],
    appointments: [],
    selectedDoctor: null,
    selectedSlot: null,
    currentQueueNumber: 0,
    activeTab: 'patient',
    // قائمة الاشتراكات تُملأ من الخادم لاحقاً مع بوابة الدفع.
    // حتى ذلك الحين تبقى فارغة بدل عرض بيانات تجريبية كأنها حقيقية.
    subscriptions: [],
    map: null,
    markers: [],
    activeDoctorId: null,
    doctorsLoaded: false,
    currentUser: api.getUser(),
    // عيادة الحساب الحالي كما وصفها الخادم: منها نعرف `pending` (بانتظار
    // مراجعة الإدارة). بدونها يرى الطبيب المعلَّق لوحة فارغة بلا تفسير.
    clinic: api.getClinic(),
    // القوائم المرجعية (بلديات/تخصصات) من الخادم — تُستخدم في الفلاتر
    // والتسجيل وتعديل الملف، وتُخزَّن هنا للترجمة من معرّف إلى اسم
    communes: [],
    specialties: []
};

function runUiAction(name, element, event) {
    // دالة الطباعة هي طريقة على window لا دالة معلنة
    if (name === 'print') { window.print(); return; }

    const fn = Object.prototype.hasOwnProperty.call(UI_ACTIONS, name) ? UI_ACTIONS[name] : null;
    if (!fn) {
        console.warn('إجراء واجهة غير معروف:', name);
        return;
    }

    // الوسيط الثاني هو العنصر نفسه (كان `this` في الكود القديم)،
    // والأول هو data-arg إن وُجد
    const result = fn.call(element, element.dataset.arg || '', element);
    if (result && typeof result.catch === 'function') {
        result.catch((err) => console.error('فشل إجراء الواجهة ' + name + ':', err));
    }
}

function initUiDelegation() {
    // إغلاق النوافذ عند النقر على الخلفية المعتمة خارج المحتوى
    document.addEventListener('click', (event) => {
        if (event.target && event.target.classList && event.target.classList.contains('modal-overlay')) {
            event.target.classList.remove('open');
        }
    });
    document.addEventListener('click', (event) => {
        const el = event.target.closest('[data-ui]');
        if (!el) return;
        // زر معطّل لا يستجيب
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') return;
        event.preventDefault();
        runUiAction(el.dataset.ui, el, event);
    });

    // النماذج: منع الإرسال الافتراضي ثم الاستدعاء
    document.addEventListener('submit', (event) => {
        const form = event.target.closest('form[data-submit]');
        if (!form) return;
        event.preventDefault();

        const name = form.dataset.submit;
        const fn = Object.prototype.hasOwnProperty.call(FORM_ACTIONS, name) ? FORM_ACTIONS[name] : null;
        if (!fn) {
            console.warn('معالج نموذج غير معروف:', name);
            return;
        }
        const result = fn.call(form, event);
        if (result && typeof result.catch === 'function') {
            result.catch((err) => console.error('فشل معالج ' + name + ':', err));
        }
    });

    // أزرار الاختيار (راديو/أزرار دور)
    document.addEventListener('change', (event) => {
        const el = event.target.closest('[data-change]');
        if (!el) return;
        runUiAction(el.dataset.change, el, event);
    });
}

// ---------------------------------------------------------------------------
// تحميل الأطباء من الخادم
// ---------------------------------------------------------------------------
/**
 * يجلب الأطباء من /api/doctors ويحوّلهم لصيغة الواجهة.
 * الفلاتر تُرسل للخادم بدل الترشيح في المتصفح: مع عشرات الأطباء
 * يصبح إرسال الكل تنزيلاً بلا داعٍ، ومع مئات يصبح ترشيح المتصفح بطيئاً
 * وغير قابل للترقيد.
 *
 * ملاحظة مهمة: `state.doctors` يُستبدل بالكامل في كل نداء، بينما
 * `loadSlotsForDoctors()` يعمل على الكائنات القديمة في الخلفية. لو لم
 * ننقل حالة الخانات، الضربة الثانية على `loadDoctors` (بعد وصول قوائم
 * الفلترة) كانت تُبطل نتائج الجولة الأولى وتبقى البطاقات فارغة.
 */
let lastDoctorsRequestId = 0;

async function loadDoctors(filters = {}) {
    const requestId = ++lastDoctorsRequestId;
    try {
        // هيكل تحميل فوري قبل وصول البيانات من الخادم
        renderDoctorsSkeleton();
        // خانات سبق تحميلها، مفهرسة بالمعرّف
        const previousSlots = new Map(
            state.doctors.map((d) => [d.id, {
                availableSlots: d.availableSlots,
                slotsForDate: d.slotsForDate,
                slotsLoaded: d.slotsLoaded,
            }])
        );

        const sortVal = filters.sort || document.getElementById('select-doctor-sort')?.value || 'rating';
        const result = await api.listDoctors({ sort: sortVal, ...filters, limit: 50 });
        if (requestId !== lastDoctorsRequestId) return state.doctors;
        const fresh = api.normalizeDoctors(result.doctors || result);

        state.doctors = fresh.map((doc) => {
            const prev = previousSlots.get(doc.id);
            // ننقل الحالة فقط إن كانت الخانات فعلاً محمَّلة؛ غير ذلك
            // تُعاد المحاولة في الجولة التالية
            return prev && prev.slotsLoaded ? { ...doc, ...prev } : doc;
        });

        state.doctorsLoaded = true;
        renderDoctors(state.doctors);
        updateMapMarkers(state.doctors);

        // الخانات: نطلبها لكل طبيب لم تُحمَّل بعد. الدالة تتخطّى من له
        // خانات محمّلة، فاستدعاؤها بعد كل فلترة رخيص. بدون هذا تفقد
        // البطاقات خاناتها: الفلترة إلى بلدية تُخرج ستة أطباء من
        // القائمة، والعودة إلى "الكل" تُعيد ثمانية أطباء بلا خانات.
        loadSlotsForDoctors();

        return state.doctors;
    } catch (err) {
        state.doctorsLoaded = false;
        renderDoctorsError(err.message);
        throw err;
    }
}

    /** تاريخ اليوم بصيغة محلية — toISOString() ينقص يوماً بعد منتصف الليل */
function localISODate(d) {
    const day = d || new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** "2026-10-06" → "الثلاثاء 06/10" — للاستخدام في البطاقات فقط */
const AR_WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function formatShortDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return iso || '';
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(d.getTime())) return iso;
    return `${AR_WEEKDAYS[d.getDay()]} ${m[3]}/${m[2]}`;
}

/**
 * يجلب أقرب خانات متاحة لكل طبيب — بالتوازي لا بالتتابع.
 * -----------------------------------------------------------------------------
 * نسأل عن اليوم أولاً، فإن لم تكن هناك خانات (الدوام انتهى، أو العيادة
 * مغلقة اليوم) ننتقل لليوم التالي الذي يعمل فيه. بدون هذا تفتح المنصة
 * الساعة 2 فجراً فتظهر كل البطاقات بلا خانات، وتبدو كأن الخادم معطّل.
 */
async function loadSlotsForDoctors() {
    const today = new Date();

    await Promise.all(
        state.doctors.map(async (doc) => {
            // لا نعيد طلب الخانات إن كانت محمَّلة أصلاً: `loadDoctors` قد
            // يكون أعاد رسم القائمة بين الجولات
            if (doc.slotsLoaded) return;

            doc.slotsLoaded = false;
            doc.slotsForDate = localISODate(today);

            try {
                let result = await api.availability(doc.id, doc.slotsForDate);

                // لا خانات اليوم → جرّب الأيام التالية حتى نجد يوم عمل
                if (!result.available || !result.available.length) {
                    for (let i = 1; i <= 7 && !result.available?.length; i++) {
                        const probe = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
                        const iso = localISODate(probe);
                        if (!result.isWorkingDay) continue;   // العيادة مغلقة
                        result = await api.availability(doc.id, iso);
                        if (result.available?.length) doc.slotsForDate = iso;
                    }
                }

                doc.availableSlots = (result.available || []).slice(0, 6);
                doc.availableToday = doc.slotsForDate === localISODate(today)
                    ? doc.availableSlots.length > 0
                    : false;
                doc.slotsLoaded = true;

                // نكتب النتيجة على الكائن المعروض حالياً لا على `doc`:
                // `loadDoctors` قد يكون استبدل القائمة أثناء الانتظار،
                // فتصبح النتيجة على كائن يتيم لا يظهر في الصفحة.
                const live = state.doctors.find((x) => x.id === doc.id);
                if (live && live !== doc) {
                    live.availableSlots = doc.availableSlots;
                    live.availableToday = doc.availableToday;
                    live.slotsForDate = doc.slotsForDate;
                    live.slotsLoaded = true;
                }
            } catch (e) {
                doc.availableSlots = [];
                doc.availableToday = false;
                doc.slotsLoaded = true;
                const live = state.doctors.find((x) => x.id === doc.id);
                if (live && live !== doc) {
                    live.availableSlots = [];
                    live.availableToday = false;
                    live.slotsLoaded = true;
                }
            }
        })
    );

    renderDoctors(state.doctors);
}

function renderDoctorsError(message) {
    const container = document.getElementById('doctors-container');
    if (!container) return;
    container.innerHTML = `
        <div style="grid-column: 1/-1; text-align:center; padding:3.5rem; background:white; border-radius:20px; box-shadow:var(--shadow-sm);">
            <i data-lucide="wifi-off" style="width:54px; height:54px; color:#ef4444; margin:0 auto 1rem;"></i>
            <h3 style="font-weight:800; font-size:1.15rem; margin-bottom:0.5rem;">تعذّر تحميل قائمة الأطباء</h3>
            <p style="color:#64748b; margin-bottom:1rem;">${api.escape(message)}</p>
            <button class="btn-primary" data-ui="loadDoctors">
                <i data-lucide="refresh-cw" style="width:16px; height:16px;"></i>
                إعادة المحاولة
            </button>
        </div>`;
    if (window.lucide) lucide.createIcons();
}

// ---------------------------------------------------------------------------
// Emergency Pharmacies & Services Engine
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PWA Install (متاح في كل الصفحات)
// ---------------------------------------------------------------------------
let deferredPWAPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPWAPrompt = e;
  const banner = document.getElementById('pwa-install-banner');
  if (banner && !sessionStorage.getItem('pwa_dismissed')) {
    banner.style.display = 'block';
  }
});

function installPWA() {
  if (!deferredPWAPrompt) {
    if (typeof showToast === 'function') {
      showToast('التطبيق مثبت بالفعل أو أن متصفحك لا يدعم التثبيت المباشر', 'info');
    }
    return;
  }
  deferredPWAPrompt.prompt();
  deferredPWAPrompt.userChoice.then((choiceResult) => {
    if (choiceResult.outcome === 'accepted') {
      console.log('[PWA] User accepted install prompt');
    }
    deferredPWAPrompt = null;
    dismissPWABanner();
  });
}

function dismissPWABanner() {
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.style.display = 'none';
  try { sessionStorage.setItem('pwa_dismissed', 'true'); } catch (e) {}
}
