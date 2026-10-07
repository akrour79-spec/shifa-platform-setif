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

// ---------------------------------------------------------------------------
 // تفويض الأحداث للعناصر الساكنة في index.html
// ---------------------------------------------------------------------------
/**
 * كان index.html يحمل 42 معالجاً مضمّناً (onclick / onsubmit / onchange).
 * كلها كانت ميتة: سياسة CSP تضع `script-src-attr 'none'`، وهو ما يمنع
 * معالجات السمات حتى مع `'unsafe-inline'` في script-src. النتيجة أن أزرار
 * الإغلاق وفلاتر التخصص والنماذج كلها لا تفعل شيئاً — والنماذج تُرسل
 * الصفحة إلى `/?` فتضيع بيانات المريض.
 *
 * الحل: مفوّض أحداث واحد على مستوى المستند. كل زر يحمل `data-ui="اسم"`،
 * ويمرّر المفوّض الاسم إلى دالة من قائمة بيضاء — لا ننفّذ نص HTML كجافاسكربت
 * أبداً، وهذا يزيل مسار حقن عبر السمات نهائياً.
 *
 * ملاحظة: لا نستخدم `data-action` هنا لأن الجداول الديناميكية (الطابور
 * ولوحة الطبيب) تستعمله أصلاً بأسماء مختلفة.
 */
const UI_ACTIONS = Object.freeze({
    openAuthModal,
    closeAuthModal,
    openCheckoutModal,
    closeCheckoutModal,
    toggleBillingCycle,
    submitSubscriptionOrder,
    closeBookingModal,
    closeTicketModal,
    closeWalkinModal,
    closeClinicSettings,
    closeProfileModal,
    openWalkinModal,
    openClinicSettings,
    toggleClinicTVMode,
    callNextPatientWithSpeech,
    repeatCurrentCallout,
    filterBySpecialtyPill,
    switchAuthTab,
    handleAuthRoleChange,
    togglePasswordVisibility,
    quickDemoLogin,
    showForgotPassword,
    loadDoctors,
    toggleTheme,
    openEmergencyModal,
    playQueueChime,
    openPrescriptionModal,
    closePrescriptionModal,
    addMedicationRow,
    removeMedicationRow,
    printPrescription,
    sendPrescriptionWhatsApp,
    closeEmergencyModal,
    filterEmergencyList,

    openBookingModalFromCard: (doctorId) => openBookingModal(doctorId),
    toggleBookingStatus,
    installPWA,
    dismissPWABanner,
    print,
    refreshAdminAnalytics,
    approveClinicDirect,
    openAdminAnalyticsModal,
    closeAdminAnalyticsModal,
    closePatientHistoryModal,
    openPatientHistoryModal,
    handleDoctorSortChange,
    loadPatientPortal,
    cancelAppointmentFromPortal: (arg) => cancelAppointmentFromPortal(arg),
});

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

const FORM_ACTIONS = Object.freeze({
    submitBooking: (...args) => submitBooking(...args),
    handleLoginSubmit: (...args) => handleLoginSubmit(...args),
    handleSignupSubmit: (...args) => handleSignupSubmit(...args),
    handleClinicSettingsSubmit: (...args) => handleClinicSettingsSubmit(...args),
    handleWalkinSubmit: (...args) => handleWalkinSubmit(...args),
    handleUpdateProfile: (...args) => handleUpdateProfile(...args),
});

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
function openEmergencyModal() {
    renderEmergencyList('all');
    document.getElementById('emergency-modal')?.classList.add('open');
}

function closeEmergencyModal() {
    document.getElementById('emergency-modal')?.classList.remove('open');
}

function filterEmergencyList(filterType, btnElement) {
    if (btnElement) {
        const container = document.getElementById('emergency-filter-pills');
        if (container) {
            container.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
        }
        btnElement.classList.add('active');
    }
    renderEmergencyList(filterType);
}

function renderEmergencyList(filterType = 'all') {
    const container = document.getElementById('emergency-list-container');
    if (!container) return;

    const list = typeof EMERGENCY_SERVICES !== 'undefined' ? EMERGENCY_SERVICES : [];
    const filtered = filterType === 'all'
        ? list
        : list.filter(item => item.type === filterType);

    if (!filtered.length) {
        container.innerHTML = `<div style="text-align:center; padding: 2rem; color: #94a3b8;">لا توجد خدمات مطابقة حالياً</div>`;
        return;
    }

    container.innerHTML = filtered.map(item => {
        const isHosp = item.type === 'hospital';
        const badgeColor = isHosp ? '#ef4444' : '#10b981';
        const badgeBg = isHosp ? '#fef2f2' : '#ecfdf5';

        return `
            <div style="background: var(--apple-card-bg); border: 1px solid var(--apple-border); border-radius: 16px; padding: 1rem 1.25rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem; transition: all 0.2s ease;">
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <div style="background: ${badgeBg}; color: ${badgeColor}; width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <i data-lucide="${item.icon || (isHosp ? 'building-2' : 'pill')}" style="width: 22px; height: 22px;"></i>
                    </div>
                    <div>
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 2px;">
                            <strong style="font-size: 1.05rem; color: var(--apple-text);">${api.escape(item.name)}</strong>
                            <span style="font-size: 0.72rem; background: ${badgeBg}; color: ${badgeColor}; padding: 2px 8px; border-radius: 999px; font-weight: 700;">${api.escape(item.badge)}</span>
                        </div>
                        <div style="font-size: 0.82rem; color: var(--apple-subtext);">
                            📍 ${api.escape(item.commune)} - ${api.escape(item.address)}
                        </div>
                        <div style="font-size: 0.78rem; color: var(--primary-emerald); font-weight: 600; margin-top: 2px;">
                            🕒 ${api.escape(item.hours)}
                        </div>
                    </div>
                </div>

                <div style="display: flex; gap: 0.5rem; flex-shrink: 0;">
                    <a href="tel:${item.phone.replace(/\s+/g, '')}" class="btn-primary" style="padding: 0.5rem 0.85rem; font-size: 0.85rem; background: linear-gradient(135deg, #10b981, #059669); text-decoration: none;">
                        <i data-lucide="phone" style="width: 14px; height: 14px;"></i>
                        اتصال
                    </a>
                </div>
            </div>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

function openTicketFromList(aptId) {
    const apt = state.appointments.find((a) => a.id === aptId);
    if (!apt) {
        showToast('لم يتم العثور على الموعد المطلوب', 'error');
        return;
    }
    const doc = state.doctors.find((d) => d.id === apt.doctorId) || {
        name: apt.doctorName || 'العيادة الطبية',
        address: apt.address || 'سطيف',
        title: apt.specialtyName || ''
    };
    showSuccessTicket(apt, doc);
}

// Glassmorphism Dark Mode System
function initTheme() {
    const savedTheme = localStorage.getItem('shifa-theme');
    const systemPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
    applyTheme(initialTheme);
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('shifa-theme', theme);

    const iconMoon = document.getElementById('theme-icon-moon');
    const iconSun = document.getElementById('theme-icon-sun');

    if (iconMoon && iconSun) {
        if (theme === 'dark') {
            iconMoon.style.display = 'none';
            iconSun.style.display = 'block';
        } else {
            iconMoon.style.display = 'block';
            iconSun.style.display = 'none';
        }
    }
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    showToast(next === 'dark' ? '🌙 تم تفعيل الوضع الداكن الزجاجي' : '☀️ تم تفعيل الوضع النهاري', 'info');
}

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initUiDelegation();
    initAuth();
    initNavigation();
    initFilters();
    renderStats();
    initMap();
    renderQueue();
    renderDoctorDashboard();
    renderSubscriptions();
    renderPricingCards();

    // قائمة الأطباء تأتي من الخادم — الواجهة ترسم بعد وصوله
    try {
        await loadDoctors();
        loadSlotsForDoctors();
    } catch (e) { /* renderDoctorsError عرض التفاصيل */ }

    // حالة العيادة (مفعّلة أم بانتظار المراجعة) تتغيّر في الخادم عبر أداة
    // التفعيل، لا في المتصفح. فقيمة localStorage قد تكون قديمة، فنسأل
    // الخادم عند كل إقلاع بدل الاعتماد على ما حُفظ آخر مرة.
    await refreshClinicState();

    refreshAppointments();
});

/**
 * يسأل الخادم عن حالة عيادة الحساب الحالي ويحدّث الواجهة.
 * عيادة كانت بانتظار المراجعة قد تكون فُعّلت في هذه الأثناء، والعكس.
 * الواجهة لا تخمّن — الخادم هو المرجع.
 */
async function refreshClinicState() {
    if (!api.isAuthenticated()) return;
    try {
        const me = await api.me();
        if (me && me.user) state.currentUser = me.user;
        // لا عيادة للحساب غير الطبي، ونمسح أي قيمة قديمة مخزّنة
        state.clinic = (me && me.clinic) || null;
        api.setSession(api.getToken(), state.currentUser, state.clinic);
        updateUserUI();
    } catch (e) {
        // تعذّر السؤال: نُبقي ما نعرفه ولا نُظهر تنبيهاً. إن كانت الجلسة
        // منتهية فمستمع shifa:session-expired يتكفّل بالمسؤولية.
    }
}

// عند انتهاء صلاحية الجلسة، نُظهر شاشة الدخول فوراً
document.addEventListener('shifa:session-expired', () => {
    state.currentUser = null;
    state.clinic = null;
    state.appointments = [];
    renderQueue();
    renderDoctorDashboard();
    updateUserUI();
    openAuthModal('login', 'patient');
    showToast('انتهت جلستك. يرجى تسجيل الدخول من جديد.', 'error');
});

// Navigation Tabs
function initNavigation() {
    const tabs = document.querySelectorAll('.nav-tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const view = tab.dataset.view;
            switchView(view);
        });
    });

    // دعم فتح التبويب مباشرة عبر الرابط (مثل http://localhost:4000/#monetization أو ?view=monetization)
    const hashView = window.location.hash.replace('#', '');
    const urlParams = new URLSearchParams(window.location.search);
    const targetView = urlParams.get('view') || hashView;
    const paymentStatus = urlParams.get('payment');
    const checkoutId = urlParams.get('checkout_id');
    if ((paymentStatus === 'demo_success' || paymentStatus === 'success') && checkoutId) {
        api.confirmDemoPayment(checkoutId).then(() => {
            showToast('💳 تم تأكيد وتسديد قيمة الاشتراك بنجاح بالبطاقة الذهبية (Chargily Pay)!', 'success');
            window.history.replaceState({}, document.title, window.location.pathname);
        }).catch(() => {});
    }

    if (targetView && ['patient', 'patient-portal', 'map', 'queue', 'doctor', 'monetization'].includes(targetView)) {
        const targetTabBtn = document.querySelector(`.nav-tab-btn[data-view="${targetView}"]`);
        if (targetTabBtn) {
            tabs.forEach(t => t.classList.remove('active'));
            targetTabBtn.classList.add('active');
            switchView(targetView);
        }
    }
}

function switchView(viewName) {
    state.activeTab = viewName;
    document.querySelectorAll('.view-panel').forEach(p => p.style.display = 'none');
    const target = document.getElementById(`view-${viewName}`);
    if (target) {
        target.style.display = 'block';
        // حركة دخول الشاشة: نعيد تشغيل الأنيميشن في كل تبديل
        target.classList.remove('view-enter');
        void target.offsetWidth;
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            target.classList.add('view-enter');
        }
        if (viewName === 'patient') {
            loadDoctors();
        } else if (viewName === 'patient-portal') {
            loadPatientPortal();
        } else if (viewName === 'monetization') {
            renderPricingCards();
            renderSubscriptions();
            loadAdminAnalytics();
        } else if (viewName === 'queue') {
            renderQueue();
        } else if (viewName === 'doctor') {
            renderDoctorDashboard();
        } else if (viewName === 'map') {
            requestAnimationFrame(() => {
                if (!state.map) {
                    initMap();
                } else {
                    state.map.invalidateSize();
                }
                setTimeout(() => {
                    if (state.map) state.map.invalidateSize();
                }, 150);
            });
        }

        if (window.lucide) {
            lucide.createIcons();
        }
    }
}

// ---------------------------------------------------------------------------
// البيانات المرجعية (البلديات والتخصصات)
// ---------------------------------------------------------------------------
/**
 * البلديات والتخصصات came من ملف في الواجهة الأمامية، فتحوّل
 * `profiles.commune_id` إلى نص عربي، وهو معرّف لا وجود له في جدول
 * `communes`. النتيجة: كل تسجيل جديد يرجع 400 `bad_reference`، ولا أحد
 * يستطيع تعديل بلديته من نافذة الملف الشخصي.
 *
 * الحل: مصدر واحد من الخادم (`/api/doctors/meta`) يملأ كل القوائم —
 * الفلاتر والتسجيل وتعديل الملف — بمعرّفات صالحة، ونحتفظ بالاسم العربي
 * محلياً للعرض فقط.
 */
let referenceDataPromise = null;

async function loadReferenceData() {
    if (!referenceDataPromise) {
        referenceDataPromise = api.doctorMeta().then((meta) => {
            state.communes = meta.communes || [];
            state.specialties = meta.specialties || [];
            populateReferenceSelects();
            return meta;
        }).catch((err) => {
            // نسمح بإعادة المحاولة: التزم الوعد الفاشل
            referenceDataPromise = null;
            throw err;
        });
    }
    return referenceDataPromise;
}

/** يملأ قوائم البلدية/التخصص التي لا تُملأ من الخادم مباشرة */
function populateReferenceSelects() {
    const fill = (selectId, items, placeholder) => {
        const select = document.getElementById(selectId);
        if (!select || select.options.length > 1) return; // مُملأ مسبقاً
        select.innerHTML = '';
        select.appendChild(new Option(placeholder, ''));
        items.forEach((item) => select.appendChild(new Option(item.name, item.id)));
    };

    fill('signup-commune', state.communes, 'اختر البلدية...');
    fill('prof-edit-commune', state.communes, 'اختر البلدية...');
    fill('signup-specialty', state.specialties, 'اختر التخصص...');
}

/** الاسم العربي لبلدية من معرّفها — للعرض في الترويسة ونافذة الملف */
function communeName(communeId) {
    const hit = state.communes.find((c) => c.id === communeId);
    return hit ? hit.name : (communeId || 'سطيف');
}

/** الاسم العربي لتخصص من معرّفه */
function specialtyName(specialtyId) {
    const hit = state.specialties.find((s) => s.id === specialtyId);
    return hit ? hit.name : (specialtyId || '');
}

// Search and Filter logic
function initFilters() {
    const communeSelect = document.getElementById('filter-commune');
    const specialtySelect = document.getElementById('filter-specialty');
    const searchInput = document.getElementById('search-query');
    const searchBtn = document.getElementById('btn-do-search');

    if (!communeSelect || !specialtySelect || !searchInput || !searchBtn) return;

    // القوائم تأتي من الخادم — مصدر واحد للحقيقة.
    // الفلاتر تُرسل للخادم بدل الترشيح في المتصفح.
    let filterTimer = null;

    const triggerFilter = () => {
        loadDoctors({
            commune: communeSelect.value,
            specialty: specialtySelect.value,
            search: searchInput.value.trim(),
        }).catch(() => { /* renderDoctorsError يعرض التفاصيل */ });
    };

    const debouncedFilter = () => {
        if (filterTimer) clearTimeout(filterTimer);
        // 350ms: ننتظر توقف الكتابة قبل إرسال طلب لكل حرف
        filterTimer = setTimeout(triggerFilter, 350);
    };

    // ملء القوائم من الخادم
    // مهم: نضيف خيار "الكل" أولاً. القوائم فارغة في HTML، فالمتصفح
    // يختار أول خيار تلقائياً عند تعبئتها لاحقاً — فيقول المستخدم
    // "طب الأطفال" بينما الفلتر الفعلي هو "الطب العام"، أو يختفي كل
    // طبيب عند أول نقرة على البلدية.
    const addOption = (select, value, label) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        select.appendChild(opt);
    };

    loadReferenceData().then(() => {
        addOption(communeSelect, 'all', 'كل بلديات سطيف');
        addOption(specialtySelect, 'all', 'كل التخصصات');

        state.communes.forEach((c) => addOption(communeSelect, c.id, c.name));
        state.specialties.forEach((s) => addOption(specialtySelect, s.id, s.name));

        // نعيد الرسم فقط — لا نعيد الجلب.
        // الطلب الأول في DOMContentLoaded بلا فلاتر، أي أنه أصلاً يعرض
        // "الكل"، وهو نفس ما تعرضه القائمتان الآن. إعادة الجلب هنا كانت
        // تستبدل كائنات الأطباء بينما جلب الخانات جارٍ عليها.
        renderDoctors(state.doctors);
    }).catch(() => {
        showToast('تعذّر تحميل قوائم الفلترة', 'error');
    });

    const dropdown = document.getElementById('instant-search-dropdown');

    const updateDropdown = (query) => {
        if (!query || query.length < 2) {
            if (dropdown) dropdown.classList.remove('open');
            return;
        }

        const matches = state.doctors.filter(d =>
            d.name.toLowerCase().includes(query) ||
            d.specialtyName.toLowerCase().includes(query) ||
            d.communeName.toLowerCase().includes(query)
        );

        if (!matches.length) {
            if (dropdown) dropdown.classList.remove('open');
            return;
        }

        dropdown.innerHTML = matches.map(doc => `
            <div class="dropdown-item" data-doc-id="${api.escape(doc.id)}" role="button" tabindex="0">
                <img src="${api.escape(doc.image)}" alt="${api.escape(doc.name)}" class="dropdown-avatar" />
                <div class="dropdown-info">
                    <div class="dropdown-name">${api.escape(doc.name)}</div>
                    <div class="dropdown-spec">${api.escape(doc.title)} - ${api.escape(doc.communeName)}</div>
                </div>
                <button class="btn-primary" style="padding: 0.4rem 0.9rem; font-size: 0.8rem;">حجز</button>
            </div>
        `).join('');

        // تفويض الأحداث: نقرأ المعرّف من data-* بدل حقنه داخل onclick
        dropdown.querySelectorAll('[data-doc-id]').forEach((item) => {
            const go = () => selectDoctorFromDropdown(item.dataset.docId);
            item.addEventListener('click', go);
            item.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
            });
        });

        dropdown.classList.add('open');
    };

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        debouncedFilter();
        updateDropdown(query);
    });

    document.addEventListener('click', (e) => {
        if (dropdown && !dropdown.contains(e.target) && e.target !== searchInput) {
            dropdown.classList.remove('open');
        }
    });

    searchBtn.addEventListener('click', () => { debouncedFilter(); });
    communeSelect.addEventListener('change', triggerFilter);
    specialtySelect.addEventListener('change', triggerFilter);
}

function selectDoctorFromDropdown(docId) {
    const dropdown = document.getElementById('instant-search-dropdown');
    if (dropdown) dropdown.classList.remove('open');
    openBookingModal(docId);
}

// Toast Notifications System
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    // type يتحكم في صنف CSS ولون الأيقونة: نقصره على ثلاث قيم معروفة
    // حتى لا يصبح الاسم نفسه ناقلاً لهجوم عبر صنف CSS خارجي.
    const variant = ['success', 'error', 'info'].includes(type) ? type : 'info';

    const toast = document.createElement('div');
    toast.className = `toast-item ${variant}`;
    const icon = variant === 'success' ? 'check-circle' : (variant === 'error' ? 'alert-circle' : 'info');

    // الرسالة قد تأتي من الخادم، فنهرّبها قبل الإدراج
    toast.innerHTML = `
        <i data-lucide="${icon}" style="width: 20px; height: 20px; color: ${variant === 'success' ? '#10b981' : (variant === 'error' ? '#ef4444' : '#0284c7')};"></i>
        <span>${api.escape(message)}</span>
    `;
    container.appendChild(toast);
    if (window.lucide) lucide.createIcons();

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-30px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// Quick Category Pill Filter
function filterBySpecialtyPill(specialtyId, btnElement) {
    document.querySelectorAll('.cat-pill').forEach(btn => btn.classList.remove('active'));
    if (btnElement) {
        btnElement.classList.add('active');
    }
    
    const specialtySelect = document.getElementById('filter-specialty');
    if (specialtySelect) {
        specialtySelect.value = specialtyId;
        specialtySelect.dispatchEvent(new Event('change'));
    }
    
    // التسمية تأتي من الخيار نفسه في القائمة — لا حاجة لثابت محلي
    const chosen = specialtySelect.options[specialtySelect.selectedIndex];
    const label = chosen ? chosen.textContent : 'الجميع';
    showToast(`عرض أطباء وسجلات: ${label}`, 'info');
}

// Render Doctors Cards
/* ============================================================
   SHIFA MOTION PACK — مساعدات الحركة
   ------------------------------------------------------------
   prefersReducedMotion: يحترم إعدادات المستخدم لتقليل الحركة
   animateCount: عدّ تصاعدي متحرك للعناصر العددية
   tickNumber: وميض رقم الطابور عند تغيّره فقط
   renderDoctorsSkeleton: هيكل تحميل لبطاقات الأطباء
   ============================================================ */
const prefersReducedMotion = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** عدّ تصاعدي متحرك لعنصر عددي */
function animateCount(el, to, duration = 600) {
    if (!el) return;
    const target = Number(to) || 0;
    if (prefersReducedMotion()) { el.textContent = target; el.dataset.countVal = target; return; }
    const from = Number(el.dataset.countVal || 0);
    el.dataset.countVal = target;
    if (from === target) { el.textContent = target; return; }
    const start = performance.now();
    const step = (now) => {
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(from + (target - from) * eased);
        if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

/** وميض رقم الطابور عند تغيّره فقط (لا يومض في كل تحديث) */
function tickNumber(el, text) {
    if (!el) return;
    if (el.textContent === text) return;
    el.textContent = text;
    if (prefersReducedMotion()) return;
    el.classList.remove('num-tick');
    void el.offsetWidth;
    el.classList.add('num-tick');
}

/** هيكل تحميل يحاكي بطاقة الطبيب أثناء جلب البيانات */
function renderDoctorsSkeleton(count = 6) {
    const container = document.getElementById('doctors-container');
    if (!container) return;
    container.innerHTML = Array.from({ length: count }, () => `
        <div class="doctor-card doctor-card-skel" aria-hidden="true">
            <div style="display: flex; gap: 12px; align-items: center;">
                <div class="skel" style="width: 64px; height: 64px; border-radius: 50%; flex-shrink: 0;"></div>
                <div style="flex: 1; display: flex; flex-direction: column; gap: 8px;">
                    <div class="skel" style="width: 70%;"></div>
                    <div class="skel" style="width: 45%;"></div>
                </div>
            </div>
            <div class="skel" style="width: 100%;"></div>
            <div class="skel" style="width: 85%;"></div>
            <div style="display: flex; gap: 8px; margin-top: auto;">
                <div class="skel" style="flex: 1; height: 38px;"></div>
                <div class="skel" style="flex: 1; height: 38px;"></div>
            </div>
        </div>`).join('');
}

function renderDoctors(doctorsList) {
    const container = document.getElementById('doctors-container');
    const resultsCount = document.getElementById('results-count');

    if (resultsCount) {
        resultsCount.textContent = `تم العثور على ${doctorsList.length} طبيب وعيادة في ولاية سطيف`;
    }

    // تنبيه شفافية البيانات: الأسماء المخيّلة تُعرض بلا تمييز فهي تبدو
    // أنان أحد شخصة نفسه لطبيب لم يوافق على الظهور.
    // لم يوافق على الظهور. يظهر فقط حين توجد عيادات تجريبية في النتائج.
    const demoCount = doctorsList.filter(d => d.isDemo).length;
    const banner = demoCount > 0 ? `
        <div class="demo-data-notice">
            <i data-lucide="flask-conical" style="width: 18px; height: 18px; flex-shrink: 0;"></i>
            <span>${demoCount === doctorsList.length
                ? 'كل الدرات في هذه القائمة بيانات تجريبية لأغراض العرض فقط، وليست عيادات حقيقية.'
                : `${demoCount} من هذه العيادات بيانات تجريبية لأغراض العرض فقط.`}</span>
        </div>` : '';

    if (!doctorsList.length) {
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 3.5rem; background: white; border-radius: 20px; box-shadow: var(--shadow-sm);">
                <i data-lucide="search-x" style="width: 54px; height: 54px; color: #94a3b8; margin: 0 auto 1rem;"></i>
                <h3 style="font-weight: 800; font-size: 1.25rem; margin-bottom: 0.5rem;">لم يتم العثور على أطباء وفق هذا البحث</h3>
                <p style="color: #64748b;">يرجى تجربة تغيير البلدية أو التخصص الطبي في سطيف.</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

container.innerHTML = banner + doctorsList.map((doc, i) => `
        <div class="doctor-card stagger-in" style="--i:${Math.min(i, 11)}">
            <div>
                <div class="doc-top">
                    <div class="doc-avatar-wrap">
                        <img src="${api.escape(doc.image)}" alt="${api.escape(doc.name)}" class="doc-avatar" />
                        <span class="status-dot ${doc.availableToday ? 'online' : 'offline'}" title="${doc.availableToday ? 'حضور حي بالعيادة اليوم' : 'المواعيد مسبقة'}"></span>
                    </div>
                    <div class="doc-details">
                        <div class="doc-badge-wrap">
                            <span class="doc-badge">${api.escape(doc.badge)}</span>
                            ${doc.acceptsChifaCard ? '<span class="doc-chifa-badge">💳 بطاقة الشفاء</span>' : ''}
                            ${(doc.accepting_bookings === false || doc.acceptingBookings === false) ? '<span class="badge-booking-closed">🔴 مكتمل / استقبال متوقف</span>' : ''}
                            ${doc.isDemo ? '<span class="doc-demo-badge" title="اسم ومعلومات خيالية أُضيفت للتجربة — ليست عيادة حقيقية">بيانات تجريبية</span>' : ''}
                        </div>
                        <h3 class="doc-name">${api.escape(doc.name)}</h3>
                        <div class="doc-specialty">${api.escape(doc.title)}</div>
                        <div class="doc-location">
                            <i data-lucide="map-pin" style="width: 14px; height: 14px; color: var(--primary);"></i>
                            <span>${api.escape(doc.communeName)} - ${api.escape(doc.address)}</span>
                        </div>
                    </div>
                </div>

                <div class="doc-meta">
                    <div class="doc-meta-item">
                        <span class="doc-meta-label">سعر الكشف / الفحص</span>
                        <span class="doc-meta-val" style="color: var(--primary);">${api.escape(doc.price)} دج</span>
                    </div>
                    <div class="doc-meta-item">
                        <span class="doc-meta-label">التقييم المعتمد</span>
                        <span class="doc-meta-val" style="color: #d97706;">⭐ ${api.escape(doc.rating)} (${api.escape(doc.reviewsCount)} تقييم)</span>
                    </div>
                    <div class="doc-meta-item" style="grid-column: 1/-1;">
                        <span class="doc-meta-label">المعلم القريب في سطيف</span>
                        <span class="doc-meta-val" style="font-size: 0.82rem; font-weight: 500;">📍 ${api.escape(doc.nearLandmark)}</span>
                    </div>
                </div>

                <div>
                    <div class="slots-label">
                        <span>${doc.slotsLoaded && doc.slotsForDate !== localISODate()
                            ? `أقرب مواعيد مفتوحة (${formatShortDate(doc.slotsForDate)}):`
                            : 'اختر توقيت الحضور المناسب:'}</span>
                        <span style="font-size: 0.75rem; color: var(--primary); font-weight: 600;">حجز فوري</span>
                    </div>
                    <div class="slots-pills" data-slots-for="${api.escape(doc.id)}">
                        ${(doc.accepting_bookings === false || doc.acceptingBookings === false)
                            ? '<div class="slots-closed-banner">⚠️ العيادة متوقفة عن استقبال المواعيد حالياً (اكتمل العدد)</div>'
                            : ((doc.availableSlots || []).map(slot => `
                                <button class="slot-pill" data-doc-id="${api.escape(doc.id)}" data-slot="${api.escape(slot)}">${api.escape(slot)}</button>
                            `).join('') || (doc.slotsLoaded
                                ? '<span style="font-size: 0.8rem; color: #94a3b8;">لا توجد خانات مفتوحة حالياً — اختر تاريخاً آخر في نافذة الحجز</span>'
                                : '<span style="font-size: 0.8rem; color: #94a3b8;">جارٍ تحميل الأوقات المتاحة…</span>'))}
                    </div>
                </div>
            </div>

            <div class="doc-footer">
                <button class="btn-primary doc-book-btn" style="flex: 1;" data-doc-id="${api.escape(doc.id)}">
                    <i data-lucide="calendar-check" style="width: 18px; height: 18px;"></i>
                    احجز تذكرتك الآن
                </button>
                <button class="btn-outline doc-locate-btn" data-lat="${api.escape(doc.lat)}" data-lng="${api.escape(doc.lng)}" data-name="${api.escape(doc.name)}" title="عرض في الخريطة">
                    <i data-lucide="map-pin" style="width: 18px; height: 18px;"></i>
                </button>
            </div>
        </div>
    `).join('');

    lucide.createIcons();

    // تفويض الأحداث: نقرأ البيانات من data-* بدل حقنها داخل onclick.
    // هذا يُغلق مسار XSS عبر سمات HTML (قيمة منقولة داخل JS داخل HTML).
    container.querySelectorAll('.slot-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            selectDoctorSlot(btn.dataset.docId, btn.dataset.slot, btn);
        });
    });

    container.querySelectorAll('.doc-book-btn').forEach(btn => {
        btn.addEventListener('click', () => openBookingModal(btn.dataset.docId));
    });

    container.querySelectorAll('.doc-locate-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            locateDoctorOnMap(
                Number(btn.dataset.lat),
                Number(btn.dataset.lng),
                btn.dataset.name
            );
        });
    });

    // Attach Apple 3D Tilt Perspective on Mouse Move
    document.querySelectorAll('.doctor-card').forEach(card => {
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left - rect.width / 2;
            const y = e.clientY - rect.top - rect.height / 2;
            const rotateX = (-y / rect.height) * 10;
            const rotateY = (x / rect.width) * 10;
            card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-8px)`;
        });
        card.addEventListener('mouseleave', () => {
            card.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0)`;
        });
    });
}

// Map Initialization
let mapResizeObserver = null;

function initMap() {
    const mapContainer = document.getElementById('setif-map');
    if (!mapContainer) return;

    if (state.map) {
        state.map.invalidateSize();
        return;
    }

    try {
        state.map = L.map('setif-map', {
            center: [36.1912, 5.4137],
            zoom: 13,
            scrollWheelZoom: true
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap | منصة شفاء سطيف'
        }).addTo(state.map);

        updateMapMarkers(state.doctors);

        if (window.ResizeObserver && !mapResizeObserver) {
            mapResizeObserver = new ResizeObserver(() => {
                if (state.map) {
                    state.map.invalidateSize();
                }
            });
            mapResizeObserver.observe(mapContainer);
        }

        setTimeout(() => {
            if (state.map) state.map.invalidateSize();
        }, 150);
        setTimeout(() => {
            if (state.map) state.map.invalidateSize();
        }, 400);
    } catch (e) {
        console.error("Map initialization error:", e);
    }
}

function updateMapMarkers(doctorsList) {
    if (!state.map) return;

    // Clear old markers
    state.markers.forEach(m => state.map.removeLayer(m));
    state.markers = [];

    doctorsList.forEach(doc => {
        // Custom HTML Pin that never breaks or depends on external image files
        const isLabOrImg = (doc.specialty === 'laboratoire' || doc.specialty === 'imagerie');
        const pinColor = isLabOrImg ? '#0284c7' : '#059669';
        const pinEmoji = isLabOrImg ? '🔬' : '🩺';

        const customPin = L.divIcon({
            className: 'shifa-map-pin',
            html: `
                <div style="background: ${pinColor}; color: white; width: 38px; height: 38px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.35); border: 2.5px solid #ffffff; cursor: pointer; transition: transform 0.2s;">
                    <span style="transform: rotate(45deg); font-size: 16px; line-height: 1;">${pinEmoji}</span>
                </div>
            `,
            iconSize: [38, 38],
            iconAnchor: [19, 38],
            popupAnchor: [0, -36]
        });

        const marker = L.marker([doc.lat, doc.lng], { icon: customPin }).addTo(state.map);
        marker.bindPopup(`
            <div style="direction: rtl; text-align: right; font-family: 'Tajawal', system-ui, sans-serif; min-width: 200px;">
                <div style="font-size: 0.75rem; background: #ecfdf5; color: #065f46; display: inline-block; padding: 2px 6px; border-radius: 4px; font-weight: bold; margin-bottom: 4px;">
                    ${doc.communeName}
                </div>
                <h4 style="color: #059669; font-size: 1rem; font-weight: 800; margin: 0 0 2px;">${doc.name}</h4>
                <div style="font-size: 0.8rem; color: #0284c7; font-weight: 600;">${doc.title}</div>
                <div style="font-size: 0.75rem; color: #64748b; margin: 4px 0;">📍 ${doc.address}</div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin: 6px 0 8px; border-top: 1px dashed #e2e8f0; padding-top: 4px;">
                    <span style="font-size: 0.75rem; color: #64748b;">الكشف:</span>
                    <strong style="color: #059669; font-size: 0.95rem;">${doc.price} دج</strong>
                </div>
                <button data-ui="openBookingModalFromCard" data-arg="${doc.id}" style="width: 100%; background: #059669; color: white; border: none; padding: 6px 10px; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 0.85rem; font-family: inherit;">
                    حجز موعد عند الطبيب
                </button>
            </div>
        `);
        state.markers.push(marker);
    });
}

function locateDoctorOnMap(lat, lng, name) {
    // 1. Switch to Map Tab
    document.querySelectorAll('.nav-tab-btn').forEach(t => {
        if (t.dataset.view === 'map') t.classList.add('active');
        else t.classList.remove('active');
    });
    switchView('map');

    // 2. Focus on Doctor Coordinates & open popup
    setTimeout(() => {
        if (state.map) {
            state.map.invalidateSize();
            state.map.setView([lat, lng], 16);
            const marker = state.markers.find(m => {
                const pos = m.getLatLng();
                return Math.abs(pos.lat - lat) < 0.001 && Math.abs(pos.lng - lng) < 0.001;
            });
            if (marker) marker.openPopup();
        }
    }, 250);
}

// Booking Modal
function selectDoctorSlot(docId, slot, btnElement) {
    state.selectedSlot = slot;
    const doc = state.doctors.find(d => d.id === docId);
    state.selectedDoctor = doc;

    if (btnElement) {
        const parent = btnElement.closest('.slots-pills');
        if (parent) {
            parent.querySelectorAll('.slot-pill').forEach(b => b.classList.remove('active'));
        }
        btnElement.classList.add('active');
    }

    showToast(`تم اختيار الموعد الساعة ${slot} عند ${doc ? doc.name : 'الطبيب'}`, 'info');
    openBookingModal(docId, null, slot);
}

/**
 * يفتح نافذة الحجز.
 * -----------------------------------------------------------------------------
 * الخانات تُجلب من الخادم بتاريخ محدَّد (لا قيم ثابتة في المتصفح)، لأنها
 * تختلف حسب اليوم وأيام عمل الطبيب وما حُجز فعلاً.
 *
 * @param {string}  docId       معرّف الطبيب
 * @param {string}  [presetDate] تاريخ يبدأ به المنتقي (YYYY-MM-DD)
 * @param {string}  [presetSlot] خانة يجب تحديدها — Coming من نقرة على خانة في البطاقة
 *                             خانة في بطاقة الطبيب. بدونها تفتح النافذة على أول
 *                             خيار وتتخاهل ما اختاره المستخدم.
 */
async function openBookingModal(docId, presetDate, presetSlot) {
    // 🔒 إلزام تسجيل الدخول / إنشاء حساب قبل حجز الموعد
    if (!API.isAuthenticated()) {
        if (typeof showToast === 'function') {
            showToast('يرجى تسجيل الدخول أو إنشاء حساب جديد أولاً حتى تتمكن من حجز موعدك', 'info');
        }
        if (typeof openAuthModal === 'function') {
            openAuthModal();
        }
        return;
    }
    const doc = state.doctors.find(d => d.id === docId);
    if (!doc) return;
    state.selectedDoctor = doc;
    state.selectedSlot = presetSlot || null;

    const nameEl = document.getElementById('modal-doc-name');
    const specEl = document.getElementById('modal-doc-specialty');
    const priceEl = document.getElementById('modal-doc-price');

    if (nameEl) nameEl.textContent = doc.name;
    if (specEl) specEl.textContent = `${doc.title} - ${doc.communeName}`;
    if (priceEl) priceEl.textContent = `${doc.price} دج`;



    // تاريخ محلي بدون انزياح UTC: toISOString() ينقص يوماً بعد منتصف الليل
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const localISO = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

    const dateInput = document.getElementById('booking-date');
    if (dateInput) dateInput.value = presetDate || localISO;
    if (dateInput) dateInput.min = localISO;

    const slotSelect = document.getElementById('booking-time-select');
    if (slotSelect) slotSelect.innerHTML = '<option value="">جارٍ التحميل…</option>';
    if (slotSelect) slotSelect.disabled = true;

    // تغيير التاريخ يُعيد جلب الخانات: التوفر يختلف كل يوم.
    // المستمع يُربط مرة واحدة فقط لا عند كل فتح للنافذة.
    if (dateInput && !dateInput.dataset.wired) {
        dateInput.dataset.wired = '1';
        dateInput.addEventListener('change', () => {
            if (!state.selectedDoctor) return;
            const sel = document.getElementById('booking-time-select');
            if (!sel) return;
            // يوم جديد: الخانة السابقة لا تُحدَّد له
            state.selectedSlot = null;
            sel.innerHTML = '<option value="">جارٍ التحميل…</option>';
            sel.disabled = true;
            loadSlotsIntoModal(state.selectedDoctor.id, dateInput.value, sel);
        });
    }

    document.getElementById('booking-modal')?.classList.add('open');

    // Pre-fill patient details if logged in
    const authUser = API.getUser();
    if (authUser) {
        const pNameInput = document.getElementById('patient-name');
        const pPhoneInput = document.getElementById('patient-phone');
        if (pNameInput && (!pNameInput.value || pNameInput.value === 'مريض عابر')) {
            pNameInput.value = authUser.fullName || authUser.name || '';
        }
        if (pPhoneInput && !pPhoneInput.value) {
            pPhoneInput.value = authUser.phone || '';
        }
    }
    if (state.currentUser) {
        const pName = document.getElementById('patient-name');
        const pPhone = document.getElementById('patient-phone');
        if (pName && !pName.value) pName.value = state.currentUser.fullName || '';
        if (pPhone && !pPhone.value) {
            // التوكن يخزّن الرقم بصيغة E.164؛ النموذج يريد الصيغة المحلية
            pPhone.value = String(state.currentUser.phone || '').replace(/^\+213/, '0');
        }
    }

    if (slotSelect) await loadSlotsIntoModal(doc.id, dateInput ? dateInput.value : localISO, slotSelect);
}

/** يجلب الخانات المتاحة ليوم محدَّد ويملأ قائمة الاختيار */
async function loadSlotsIntoModal(doctorId, date, selectEl) {
    if (!selectEl) return;
    // الخانة المختارة من يوم قد لا توجد في اليوم الجديد، فتُلغى قبل التعبئة.
    // نحفظها محلياً لأن التصفير يسبق الجلب، ثم نعيد تطبيقها بعده.
    const wanted = state.selectedSlot;
    state.selectedSlot = null;

    try {
        const av = await api.availability(doctorId, date);
        const slots = av.available || [];

        if (!slots.length) {
            selectEl.innerHTML = av.isWorkingDay === false
                ? '<option value="">العيادة مغلقة في هذا اليوم</option>'
                : '<option value="">لا توجد خانات متاحة في هذا اليوم</option>';
            selectEl.disabled = true;
            return;
        }

        selectEl.innerHTML = slots.map((s) =>
            `<option value="${api.escape(s)}">${api.escape(s)}</option>`
        ).join('');
        selectEl.disabled = false;

        // الخانة التي نقر عليها المستخدم في البطاقة: نحددها إن كانت
        // ما زالت متاحة، وإلا نُبقي الاختيار على أول خيار متاح
        if (wanted && slots.includes(wanted)) {
            selectEl.value = wanted;
            state.selectedSlot = wanted;
        }
    } catch (err) {
        selectEl.innerHTML = `<option value="">${api.escape(err.message || 'تعذّر تحميل الخانات')}</option>`;
        selectEl.disabled = true;
    }
}

function closeBookingModal() {
    document.getElementById('booking-modal')?.classList.remove('open');
    state.selectedDoctor = null;
    state.selectedSlot = null;
}

/**
 * حجز موعد — يرسل للخادم الذي يتحقق من التوفر ويخصّص رقم الدور.
 * -----------------------------------------------------------------------------
 * الإصدار السابق كان يبني كائن الموعد في المتصفح ويحفظه في localStorage،
 * فلا يوجد منع للحجز المزدوج ولا ترقيم دور حقيقي ولا تحقق من المدخلات.
 */
async function submitBooking(event) {
    event.preventDefault();
    if (!state.selectedDoctor) return;

    const patientName = document.getElementById('patient-name').value.trim();
    const patientPhone = document.getElementById('patient-phone').value.trim();
    const bookingDate = document.getElementById('booking-date').value;
    const bookingTime = document.getElementById('booking-time-select').value;
    const hasChifa = document.getElementById('has-chifa-card').checked;

    if (!patientName || !patientPhone) {
        showToast("يرجى إدخال اسم المريض ورقم الهاتف الجزائري لتأكيد الموعد.", 'error');
        return;
    }
    if (!bookingDate || !bookingTime) {
        showToast("يرجى اختيار التاريخ والوقت.", 'error');
        return;
    }

    const submitBtn = event.target.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add('is-loading');
        submitBtn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span> جاري تأكيد الحجز...';
    }

    try {
        const result = await api.book({
            doctorId: state.selectedDoctor.id,
            date: bookingDate,
            time: bookingTime,
            patientName,
            patientPhone,
            hasChifa,
        });

        const apt = result.appointment;

        // نحفظ الطبيب قبل الإغلاق: `closeBookingModal` يصفّر
        // `state.selectedDoctor`، فمرورُه بعد الإغلاق كان يعطي null للتذكرة
        const bookedDoctor = state.selectedDoctor;

        closeBookingModal();
        await refreshAppointments();
        renderStats();

        showSuccessTicket(apt, bookedDoctor);
    } catch (err) {
        const detail = err.details && err.details.length
            ? `: ${err.details[0].message}`
            : '';
        showToast((err.message || 'تعذّر إتمام الحجز') + detail, 'error');

        // إذا حجزها شخص آخر في نفس اللحظة، نعيد جلب الخانات فيبقى
        // الخيار المحجوز خارج القائمة بدل أن نحاول مرة أخرى ونتفاجأ
        if (err.code === 'slot_taken' && state.selectedDoctor) {
            await loadSlotsIntoModal(
                state.selectedDoctor.id,
                document.getElementById('booking-date').value,
                document.getElementById('booking-time-select')
            );
        }
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.classList.remove('is-loading');
            submitBtn.innerHTML = '<i data-lucide="check-circle" style="width: 18px; height: 18px;"></i> تأكيد الحجز النهائي';
            if (window.lucide) lucide.createIcons();
        }
    }
}

/**
 * تحميل المواعيد من الخادم.
 * الزائر غير المسجّل يرى لا شيء (لا توجد مواعيد "عامة" — بيانات شخصية).
 * المريض يرى مواعيده، والطبيب يرى مواعيد عيادته.
 */
async function refreshAppointments() {
    if (!api.isAuthenticated()) {
        // زائر: نُفرّغ الطابور بدل عرض بيانات محلية قديمة
        state.appointments = [];
        state.activeDoctorId = null;
        state.currentQueueNumber = 0;
        renderQueue();
        renderDoctorDashboard();
        renderStats();
        return;
    }

    try {
        const isClinic = state.currentUser &&
            ['doctor', 'secretary', 'admin'].includes(state.currentUser.role);

        if (isClinic) {
            // الطبيب يقرأ طابور عيادته من /api/queue — يعيد هوية العيادة
            // وحالات المواعيد الفعلية من الخادم، فنعرف من يقف عند المكتب
            // الآن بدل تخمينه من رقم الدور في المتصفح.
            const result = await api.queue();
            state.activeDoctorId = result.clinic?.id || state.activeDoctorId;
            state.appointments = api.normalizeAppointments(result.queue || []);
        } else {
            const result = await api.myAppointments({ scope: 'mine', limit: 100 });
            state.appointments = api.normalizeAppointments(result.appointments);
        }

        syncCurrentQueueNumber();
        renderQueue();
        renderDoctorDashboard();
        renderStats();
    } catch (err) {
        if (err.code !== 'unauthenticated') {
            console.warn('تعذّر تحميل المواعيد:', err.message);
        }
        state.appointments = [];
        renderQueue();
    }
}

/**
 * مزامنة رقم الدور الحالي مع الخادم.
 * -----------------------------------------------------------------------------
 * الحالة المعروضة كانت تُشتق من "أكبر رقم استُدعي في هذه الجلسة"، أي أن
 * إعادة تحميل الصفحة كانت تُظهر "لا يوجد مريض حالي" رغم وجود مريض عند
 * المكتب. الخادم وحده يعرف من حالته in_consultation.
 */
function syncCurrentQueueNumber() {
    const inRoom = state.appointments.find((a) => a.statusKey === 'in_consultation');
    if (inRoom) {
        state.currentQueueNumber = inRoom.queueNumber;
        return;
    }
    // لا أحد عند المكتب: الرقم المعروض هو أعلى رقم مُنجز، لا صفر
    const done = state.appointments
        .filter((a) => a.statusKey === 'completed')
        .map((a) => a.queueNumber);
    state.currentQueueNumber = done.length ? Math.max(...done) : 0;
}


/**
 * بطاقة الموعد بعد الحجز.
 * -----------------------------------------------------------------------------
 * `apt` يصل من الخادم بأسماء snake_case. كنا نقرأ `apt.patientName`
 * و`apt.queueNumber` مباشرة، فيظهر الحقلان فارغين — التذكرة كانت تُطبع
 * بلا اسم المريض ولا رقم دور. نطبّع أولاً ثم نملأ.
 */
function showSuccessTicket(rawApt, doctor) {
    const apt = api.normalizeAppointment(rawApt);
    if (!apt) {
        showToast('تم الحجز لكن تعذّر عرض التذكرة', 'error');
        return;
    }

    const modal = document.getElementById('ticket-modal');
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setTxt('ticket-apt-id', apt.id);
    setTxt('ticket-patient', apt.patientName || '—');
    setTxt('ticket-doctor', doctor ? doctor.name : '—');
    setTxt('ticket-address', doctor ? (doctor.address || doctor.nearLandmark || '') : '');
    setTxt('ticket-datetime', `${formatShortDate(apt.date)} الساعة ${apt.time}`);
    setTxt('ticket-queue', apt.queueNumber ? `#${String(apt.queueNumber).padStart(2, '0')}` : '--');
    setTxt('ticket-phone', apt.patientPhone || '—');

    // لا نطبع "مقبولة للتعويض" لمريض لا يحمل البطاقة
    const chifaEl = document.getElementById('ticket-chifa');
    if (chifaEl) {
        chifaEl.textContent = apt.hasChifa ? '✅ مقبولة للتعويض' : 'غير مطلوبة — الدفع الذاتي';
        chifaEl.style.color = apt.hasChifa ? '#0369a1' : '#64748b';
    }
    
    // علامة نجاح مرسومة متحركة أعلى التذكرة (تُعاد في كل حجز جديد)
    const ticketBody = modal.querySelector('.modal-body');
    if (ticketBody) {
        ticketBody.querySelector('.check-draw')?.remove();
        const check = document.createElement('div');
        check.className = 'check-draw';
        check.style.cssText = 'display:flex;justify-content:center;margin-bottom:0.75rem;';
        check.setAttribute('aria-hidden', 'true');
        check.innerHTML = '<svg width="72" height="72" viewBox="0 0 72 72" fill="none">'
            + '<circle cx="36" cy="36" r="32" stroke="#00ab55" stroke-width="4"/>'
            + '<path d="M23 37.5 L32 46 L50 27" stroke="#00ab55" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
            + '</svg>';
        ticketBody.prepend(check);
    }

    // Attach Real WhatsApp direct trigger
    const waBtn = document.getElementById('btn-whatsapp-confirm');
    if (waBtn) {
        waBtn.onclick = () => {
            let phone = String(apt.patientPhone || '').replace(/\D/g, '');
            if (phone.startsWith('0')) {
                phone = '213' + phone.substring(1);
            }
            const text = encodeURIComponent(
                `🏥 تأكيد موعد - منصة شفاء (سطيف)\n` +
                `------------------------------------\n` +
                `👤 المريض: ${apt.patientName}\n` +
                `🩺 الطبيب: ${doctor.name} (${doctor.title})\n` +
                `📍 العنوان: ${doctor.address}\n` +
                `📅 الموعد: ${apt.date} على الساعة ${apt.time}\n` +
                `🎟️ رقم الدور: #${apt.queueNumber}\n` +
                `🔖 رقم الحجز: ${apt.id}\n\n` +
                `يرجى الحضور قبل الموعد بـ 15 دقيقة وإبراز بطاقة الشفاء عند الدخول.`
            );
            window.open(`https://wa.me/${phone}?text=${text}`, '_blank');
        };
    }

    if (modal) modal.classList.add('open');
}

function closeTicketModal() {
    document.getElementById('ticket-modal')?.classList.remove('open');
}

// Live Queue Management (السكرتارية وقاعة الانتظار)
/* =========================================================================
   🔊 محرك النطق الصوتي العربي وقاعة الانتظار الذكية (WEB SPEECH SYNTHESIS)
   ========================================================================= */

// Synthesize Hospital Dual-Tone Chime Sound using Web Audio API
function playClinicChime() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = 'sine';
        osc2.type = 'sine';

        // Dual-tone hospital chime frequencies (E5 & A5)
        const now = ctx.currentTime;
        osc1.frequency.setValueAtTime(659.25, now); // E5
        osc2.frequency.setValueAtTime(880.00, now + 0.15); // A5

        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(now);
        osc1.stop(now + 0.25);
        osc2.start(now + 0.15);
        osc2.stop(now + 0.8);
    } catch(e) {
        console.warn("Audio Context notice:", e);
    }
}

// Speak Patient Name using Web Speech Synthesis API

// ---------------------------------------------------------------------------
// Web Audio API Queue Chime (نغمة جرس قاعة الانتظار التلفزيونية)
// ---------------------------------------------------------------------------
function playQueueChime() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();

        const now = ctx.currentTime;
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = 'sine';
        osc2.type = 'sine';

        // Tone 1: 659.25Hz (E5) -> Tone 2: 880Hz (A5)
        osc1.frequency.setValueAtTime(659.25, now);
        osc2.frequency.setValueAtTime(880, now + 0.18);

        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(now);
        osc1.stop(now + 0.18);
        osc2.start(now + 0.18);
        osc2.stop(now + 0.6);
    } catch (e) {
        // Fallback silently if audio context is not allowed
    }
}

function speakPatientCallout(patientName, queueNumber, doctorName = "عيادة الشفاء") {
    const speechEnabled = document.getElementById('chk-enable-speech')?.checked ?? true;
    
    // Always play chime sound first
    playClinicChime();

    const waveBox = document.getElementById('speech-wave-container');
    if (waveBox) waveBox.style.display = 'inline-flex';

    if ('speechSynthesis' in window && speechEnabled) {
        // Cancel any pending speech
        window.speechSynthesis.cancel();

        const sentence = `المريض ${patientName}، دور رقم ${queueNumber}، يرجى التوجه إلى مكتب المعاينة.`;
        const utterance = new SpeechSynthesisUtterance(sentence);
        utterance.lang = 'ar-SA'; // Standard Arabic
        utterance.rate = 0.9; // Slightly slower for crisp clarity
        utterance.pitch = 1.0;

        // Find best Arabic voice if available
        const voices = window.speechSynthesis.getVoices();
        const arVoice = voices.find(v => v.lang.includes('ar'));
        if (arVoice) utterance.voice = arVoice;

        utterance.onend = () => {
            if (waveBox) waveBox.style.display = 'none';
        };

        utterance.onerror = () => {
            if (waveBox) waveBox.style.display = 'none';
        };

        window.speechSynthesis.speak(utterance);
    } else {
        setTimeout(() => {
            if (waveBox) waveBox.style.display = 'none';
        }, 2000);
    }
}

function renderQueue() {
    const list = document.getElementById('queue-list');
    const currentNumDisplay = document.getElementById('live-queue-current');
    const currentNameDisplay = document.getElementById('live-queue-patient-name');
    const tvNumDisplay = document.getElementById('tv-number-display');
    const tvNameDisplay = document.getElementById('tv-patient-name-display');

    if (!list) return;

    const currentApt = state.appointments.find(a => a.queueNumber === state.currentQueueNumber);

    const queueLabel = `#${String(state.currentQueueNumber).padStart(2, '0')}`;

    // وميض الرقم عند تغيّر الدور فقط — tickNumber تتخطى إن لم يتغيّر
    tickNumber(currentNumDisplay, queueLabel);
    if (currentNameDisplay) currentNameDisplay.textContent = currentApt ? currentApt.patientName : "لا يوجد مريض حالي";

    tickNumber(tvNumDisplay, queueLabel);
    if (tvNameDisplay) tvNameDisplay.textContent = currentApt ? `المريض: ${currentApt.patientName}` : "في انتظار المريض التالي";

list.innerHTML = state.appointments.map(apt => {
        // الحالة من statusKey (الإنجليزية من الخادم) لا من النص العربي،
        // حتى لا تنكسر المقارنة عند أي تعديل في الترجمة.
        const isCurrent = apt.statusKey === 'in_consultation' || apt.queueNumber === state.currentQueueNumber;
        const isVisited = apt.statusKey === 'completed';
        const isCancelled = apt.statusKey === 'cancelled' || apt.statusKey === 'no_show';
        const isNear = !isCurrent && !isVisited && !isCancelled && (apt.queueNumber <= state.currentQueueNumber + 2 && apt.queueNumber > state.currentQueueNumber);

        // كل قيمة قادمة من قاعدة البيانات تمرّ عبر api.escape قبل إدراجها.
        // بدون ذلك، اسم مريض مثل <img src=x onerror=...> يعني تنفيذ كود
        // داخل جهاز الطبيب أو شاشة العيادة.
        const name = api.escape(apt.patientName);
        const phone = api.escape(apt.patientPhone);
        const time = api.escape(apt.time);
        const doctor = api.escape(apt.doctorName);

        return `
            <div class="queue-item-card ${isCurrent ? 'is-current' : ''} ${isVisited ? 'is-visited' : ''} ${isCancelled ? 'is-cancelled' : ''}">
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <span style="background: ${isCurrent ? 'var(--primary-emerald)' : (isVisited ? '#cbd5e1' : '#38bdf8')}; color: white; width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.15rem; box-shadow: ${isCurrent ? '0 4px 12px rgba(0,171,85,0.3)' : 'none'};">
                        #${String(apt.queueNumber).padStart(2, '0')}
                    </span>
                    <div>
                        <h4 style="font-weight: 800; color: var(--apple-text); font-size: 1rem; margin-bottom: 2px;">
                            ${name}
                            ${apt.hasChifa ? '<span class="queue-chifa-badge">💳 بطاقة الشفاء</span>' : ''}
                            ${isNear ? '<span class="proximity-alert-pill" style="margin-right: 6px;">⚠️ اقترب دورك</span>' : ''}
                        </h4>
                        <span style="font-size: 0.8rem; color: var(--apple-subtext);">
                            📞 ${phone} | الموعد: ${time} | الطبيب: ${doctor}
                        </span>
                    </div>
                </div>

                <div class="queue-action-btn-group">
                    <button class="btn-queue-action btn-call-speech"
                            data-action="call"
                            data-apt-id="${api.escape(apt.id)}"
                            data-name="${name}"
                            data-queue="${api.escape(apt.queueNumber)}"
                            ${isVisited || isCancelled ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''}>
                        <i data-lucide="volume-2" style="width: 14px; height: 14px;"></i>
                        استدعاء بصوت
                    </button>

                    <button class="btn-queue-action"
                            data-action="med-history"
                            data-phone="${phone}"
                            data-name="${name}"
                            data-patient-id="${api.escape(apt.patientId || '')}"
                            data-apt-id="${api.escape(apt.id)}">
                        <i data-lucide="file-text" style="width: 14px; height: 14px; color: #7c3aed;"></i>
                        الفيشة الطبية
                    </button>

                    <button class="btn-queue-action"
                            data-action="ticket"
                            data-apt-id="${api.escape(apt.id)}">
                        <i data-lucide="ticket" style="width: 14px; height: 14px; color: #0284c7;"></i>
                        التذكرة
                    </button>

                    <button class="btn-queue-action"
                            data-action="whatsapp"
                            data-action="whatsapp"
                            data-phone="${phone}"
                            data-name="${name}"
                            data-queue="${api.escape(apt.queueNumber)}">
                        <i data-lucide="message-circle" style="width: 14px; height: 14px; color: #16a34a;"></i>
                        واتساب
                    </button>

                    <span class="queue-status-badge ${isVisited ? 'status-visited' : (isCancelled ? 'status-cancelled' : (isCurrent ? 'status-current' : 'status-waiting'))}">
                        ${api.escape(apt.status)}
                    </span>
                </div>
            </div>
        `;
    }).join('');

    // تفويض الأحداث: نقرأ البيانات من data-* بدل حقنها داخل onclick.
    // هذا يُغلق ثغرة XSS نهائياً في أزرار الطابور.
    list.querySelectorAll('button[data-action]').forEach(btn => {


        btn.addEventListener('click', () => {
            const { action, aptId, phone, name, queue } = btn.dataset;
            if (action === 'call') {
                callSpecificPatient(aptId);
            } else if (action === 'whatsapp') {
                sendWhatsAppNotice(phone, name, queue);
            } else if (action === 'ticket') {
                openTicketFromList(aptId);
            } else if (action === 'med-history') {
                openPatientHistoryModal(phone, name, btn.dataset.patientId, aptId);
            }
        });
    });

    if (window.lucide) lucide.createIcons();
}

/**
 * استدعاء المريض التالي — الخادم هو من يختار منطقيا.
 * -----------------------------------------------------------------------------
 * الإصدار السابق كان يختار المريض داخل المتصفح عبر "أعلى رقم دور أكبر من
 * الحالي"، وهو المنطق نفسه الذي لا يحترم حالة الموعد (مثلاً مرضى
 * ألغوا أو لم يحضروا بعد). الآن الخادم ينقل الحالة بشكل صحيح:
 *   • إن كانت العيادة خالية ← "عند الطبيب"
 *   • إن كان هناك مريض قيد الفحص ← "في قاعة الانتظار"
 */
async function callNextPatientWithSpeech() {
    try {
        const result = await api.callNext();

        if (!result.called) {
            await refreshAppointments();
            showToast(result.message || 'لا يوجد مرضى في الطابور حالياً', 'info');
            return;
        }

        state.currentQueueNumber = result.called.queue_number;
        await refreshAppointments();
        renderQueue();
        renderDoctorDashboard();

        speakPatientCallout(
            result.called.patient_name,
            result.called.queue_number,
            result.called.doctor_name
        );

        showToast(result.message);
    } catch (err) {
        showToast(err.message || 'تعذّر استدعاء المريض', 'error');
    }
}

/** استدعاء مريض محدد برقم دوره */
async function callSpecificPatient(aptId) {
    try {
        const result = await api.callPatient(aptId);

        state.currentQueueNumber = result.called.queue_number;
        await refreshAppointments();
        renderQueue();
        renderDoctorDashboard();

        speakPatientCallout(
            result.called.patient_name,
            result.called.queue_number,
            result.called.doctor_name
        );
        showToast(result.message);
    } catch (err) {
        showToast(err.message || 'تعذّر استدعاء المريض', 'error');
    }
}

function repeatCurrentCallout() {
    const currentApt = state.appointments.find(a => a.queueNumber === state.currentQueueNumber);
    if (!currentApt) {
        showToast('⚠️ لا يوجد مريض موجه حالياً لمكتب المعاينة.', 'info');
        return;
    }
    speakPatientCallout(currentApt.patientName, currentApt.queueNumber, currentApt.doctorName);
    showToast('🔊 أُعيد نطق اسم المريض الحالي', 'info');
}

function toggleClinicTVMode() {
    const tvOverlay = document.getElementById('clinic-tv-overlay');
    if (!tvOverlay) return;

    const nowOpen = !tvOverlay.classList.contains('open');
    tvOverlay.classList.toggle('open', nowOpen);

    if (nowOpen) {
        startQueueScreenPolling();
        showToast("📺 تم تفعيل شاشة العرض الكبرى لقاعة الانتظار بالعيادة");
    } else {
        stopQueueScreenPolling();
    }
}

/**
 * شاشة الطابور الحية (وضع التلفزيون).
 * -----------------------------------------------------------------------------
 *كانت تعرض رقم دور ثابتاً واسم مريض مكتوباً في الكود. الآن
 * تستدعي الشاشة /api/queue/screen — نقطة عامة مصمَّمة للتلفزيون —
 * وتحدّث نفسها كل 15 ثانية.
 *
 * نستخدم نقطة العامة بدل /api/queue لأن التلفزيون مركّب داخل العيادة
 * بدون جلسة مفتوحة: والخادم نفسه هو من يتحقق من الحالة الحقيقية
 * للمواعيد.
 */
let queueScreenTimer = null;

function stopQueueScreenPolling() {
    if (queueScreenTimer) {
        clearTimeout(queueScreenTimer);
        queueScreenTimer = null;
    }
}

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && document.getElementById('clinic-tv-overlay')?.classList.contains('open')) {
        refreshQueueScreen();
    }
});

async function refreshQueueScreen() {
    const overlay = document.getElementById('clinic-tv-overlay');
    const doctorId = state.activeDoctorId;
    if (!overlay || !overlay.classList.contains('open')) {
        stopQueueScreenPolling();
        return;
    }

    if (document.hidden) {
        queueScreenTimer = setTimeout(refreshQueueScreen, 10000);
        return;
    }

    // بلا عيادة نشطة لا يوجد ما يُعرض: نُبقي الشاشة مفتوحة برسالة
    // صريحة بدل عرض رقم دور مخترع
    if (!doctorId) {
        setTvScreen({
            number: '--',
            name: 'سجّل الدخول بحساب عيادة لعرض الطابور',
            subtitle: 'شاشة العرض تعمل من داخل العيادة',
            clinicName: 'منصة شِـفَـاء سطيف',
        });
        return;
    }

    try {
        const data = await api.queueScreen(doctorId);
        const waiting = Number(data.waitingCount) || 0;
        const remaining = Number(data.stats?.remaining) || 0;

        setTvScreen({
            number: data.current ? data.current.queue_number : '--',
            name: data.current
                ? data.current.patient_name
                : 'في انتظار المريض التالي',
            subtitle: data.current
                ? (waiting > 0
                    ? `${waiting} في الانتظار • متبقٍّ ${remaining} موعد اليوم`
                    : 'لا يوجد مرضى آخر في قائمة الانتظار')
                : `يرجى الانتظار حتى يُنادى دوركم${waiting > 0 ? ` — ${waiting} في الانتظار` : ''}`,
            clinicName: data.clinic?.name || 'عيادة شفاء',
        });

        // الخادم نفسه يحدّد مدة التحديث بين طلب وآخر
        const seconds = Number(data.refreshAfterSeconds) || 15;
        queueScreenTimer = setTimeout(refreshQueueScreen, seconds * 1000);
    } catch (err) {
        setTvScreen({
            number: '--',
            name: 'تعذّر الاتصال بالخادم',
            subtitle: err.message || 'تحقّق من اتصال الخادم',
            clinicName: 'عيادة شفاء',
        });
        // إعادة محاولة أقصر عند الفشل: الخادم قد يكون قيد إعادة التشغيل
        queueScreenTimer = setTimeout(refreshQueueScreen, 5000);
    }
}

function setTvScreen({ number, name, subtitle, clinicName }) {
    const numEl = document.getElementById('tv-number-display');
    const nameEl = document.getElementById('tv-patient-name-display');
    const subEl = document.getElementById('tv-doctor-subtitle');
    const clinicEl = document.getElementById('tv-clinic-name');

    if (numEl) numEl.textContent = typeof number === 'number' ? `#${String(number).padStart(2, '0')}` : number;
    if (nameEl) nameEl.textContent = name ? `المريض: ${name}` : 'في انتظار المريض التالي';
    if (subEl) subEl.textContent = subtitle || '';
    if (clinicEl) clinicEl.textContent = clinicName || '';
}

function startQueueScreenPolling() {
    stopQueueScreenPolling();
    refreshQueueScreen();
}

/**
 * نافذة تعديل ملف العيادة.
 * -----------------------------------------------------------------------------
 * تفتح ببيانات Clinic العائدة من الخادم، لا بقيم النموذج القديمة — وإلا
 * قد يكتسب doctor تكتبه فوق ما عدّلته.
 */
async function openClinicSettings() {
    const doc = state.doctors.find((d) => d.id === state.activeDoctorId);

    if (!doc) {
        showToast('لا توجد عيادة مرتبطة بهذا الحساب', 'error');
        return;
    }

    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    setVal('clinic-name', doc.name || '');
    setVal('clinic-title', doc.title || '');
    setVal('clinic-address', doc.address || '');
    setVal('clinic-phone', String(doc.phone || '').replace(/^\+213/, '0'));
    setVal('clinic-price', doc.price || '');
    setVal('clinic-days', doc.availableDays || '');
    setVal('clinic-slot-minutes', String(doc.slotMinutes || 30));
    const chifaInput = document.getElementById('clinic-has-chifa'); if (chifaInput) chifaInput.checked = Boolean(doc.hasChifa);

    // ساعات العمل مخزَّنة كنص "08:00 - 16:30": نفصلها لحقلي time
    const hours = String(doc.workHours || '').match(
        /([01]\d|2[0-3]):([0-5]\d)\s*-\s*([01]\d|2[0-3]):([0-5]\d)/
    );
    setVal('clinic-work-start', hours ? `${hours[1]}:${hours[2]}` : '');
    setVal('clinic-work-end', hours ? `${hours[3]}:${hours[4]}` : '');

    document.getElementById('clinic-settings-modal')?.classList.add('open');
    if (window.lucide) lucide.createIcons();
}

function closeClinicSettings() {
    document.getElementById('clinic-settings-modal')?.classList.remove('open');
}

async function handleClinicSettingsSubmit(event) {
    event.preventDefault();

    const btn = document.getElementById('btn-save-clinic');
    const original = btn.innerHTML;

    const start = document.getElementById('clinic-work-start').value;
    const end = document.getElementById('clinic-work-end').value;

    // الخادم يتحقق من كل القواعد، لكننا نوفّر رسالة عربية فورية
    // بدل انتظار رحلة ذهاب وإياب لرفض حقل واحد
    if (start && end && start >= end) {
        showToast('بداية الدوام يجب أن تكون قبل نهايته', 'error');
        return;
    }

    const payload = {
        name: document.getElementById('clinic-name').value.trim(),
        title: document.getElementById('clinic-title').value.trim(),
        address: document.getElementById('clinic-address').value.trim(),
        price: Number(document.getElementById('clinic-price').value) || 0,
        available_days: document.getElementById('clinic-days').value.trim(),
        slot_minutes: Number(document.getElementById('clinic-slot-minutes').value),
        has_chifa: document.getElementById('clinic-has-chifa').checked,
    };

    const phone = document.getElementById('clinic-phone').value.trim();
    if (phone) payload.phone = phone;

    // لا نرسل work_hours إلا إذا كمل المستخدم الحقلين معاً:
    // فإرسال ناقص يفشل في التحقق على الخادم ويمنع حفظ بقية الحقول
    if (start && end) payload.work_hours = `${start} - ${end}`;

    try {
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader-2" style="width: 18px; height: 18px;"></i> جارٍ الحفظ...';
        if (window.lucide) lucide.createIcons();

        await api.updateClinic(payload);

        // نعيد التحميل من الخادم: الأرقام قد تُطبَّع (الهون، السعر)、
        // والاسم يُقصّ إلى 80 حرفاً — نعرض ما حُفظ فعلاً لا ما كتبناه
        await loadDoctors();
        closeClinicSettings();
        showToast('تم حفظ بيانات العيادة');
    } catch (err) {
        const detail = (err.details || []).map((d) => d.message).join(' • ');
        showToast(detail || err.message || 'تعذّر حفظ بيانات العيادة', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = original;
        if (window.lucide) lucide.createIcons();
    }
}

/**
 * نافذة المريض العابر (بدون موعد مسبق).
 * -----------------------------------------------------------------------------
 * الخادم يقبل التسجيل على عيادة الحساب فقط، فلا معنى لعرض كل أطباء سطيف
 * هنا: الاختيار الآن من عيادة الطبيب نفسه، وإلا سيرفض الخادم الطلب.
 */
function openWalkinModal() {
    const select = document.getElementById('walkin-doctor-select');

    if (state.activeDoctorId) {
        // عيادة واحدة: نعرضها مباشرة بلا قائمة اختيار
        if (select) {
            const doc = state.doctors.find((d) => d.id === state.activeDoctorId);
            select.innerHTML = `<option value="${api.escape(state.activeDoctorId)}">${api.escape(doc?.name || 'عيادتك')}</option>`;
            select.disabled = true;
        }
    } else if (select) {
        // لا عيادة نشطة: والخادم سيرفض الطلب أصلاً، فنقول ذلك صراحةً
        select.innerHTML = '<option value="">سجّل الدخول بحساب عيادة أولاً</option>';
        select.disabled = true;
    }

    document.getElementById('walkin-modal')?.classList.add('open');
}

function closeWalkinModal() {
    document.getElementById('walkin-modal')?.classList.remove('open');
}

/**
 * تسجيل مريض عابر (بدون موعد مسبق).
 * -----------------------------------------------------------------------------
 * كان رقم الدور يُحسب في المتصفح كـ max+1، أي أن أي شخص يمكنه أن يعطي
 * رقم دور متضارباً. الآن الخادم يحجزه داخل معاملة مقفلة ويمنع التكرار.
 */
async function handleWalkinSubmit(event) {
    event.preventDefault();

    const name = document.getElementById('walkin-name')?.value?.trim() || '';
    const phone = document.getElementById('walkin-phone')?.value?.trim() || '';
    const docId = document.getElementById('walkin-doctor-select')?.value || '';
    const hasChifa = document.getElementById('walkin-chifa')?.checked || false;

    if (!name || !phone) {
        showToast('يرجى إدخال اسم المريض ورقم هاتفه.', 'error');
        return;
    }

    const btn = event.target.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;

    try {
        const result = await api.walkIn({ patientName: name, patientPhone: phone, hasChifa });

        await refreshAppointments();
        renderStats();
        closeWalkinModal();

        showToast(`✅ تم تسجيل المريض برقم دور #${result.walkIn.queue_number}`);
        speakPatientCallout(name, result.walkIn.queue_number);
    } catch (err) {
        showToast(err.message || 'تعذّر تسجيل المريض', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

/**
 * إنهاء معاينة المريض — الخادم يتحقق من صحة الانتقال من "عند الطبيب" أو
 * "في قاعة الانتظار" إلى "مكتمل".
 */
async function completePatientVisit(aptId) {
    const apt = state.appointments.find((a) => a.id === aptId);
    if (!apt) return;

    try {
        await api.completeVisit(aptId);
        await refreshAppointments();
        showToast(`✅ تم إنهاء معاينة المريض (${apt.patientName}).`);
    } catch (err) {
        showToast(err.message || 'تعذّر إنهاء المعاينة', 'error');
    }
}

function sendWhatsAppNotice(phone, patientName, queueNum) {
    const cleanPhone = phone.replace(/\s+/g, '');
    const intlPhone = cleanPhone.startsWith('0') ? '213' + cleanPhone.substring(1) : cleanPhone;
    const msg = encodeURIComponent(`مرحباً ${patientName}، تذكرتك في عيادة الشفاء سطيف هي رقم #${queueNum}. يرجى التواجد بقاعة الانتظار.`);
    window.open(`https://wa.me/${intlPhone}?text=${msg}`, '_blank');
}

// Doctor Dashboard Logic
function renderDoctorDashboard() {
    const tableBody = document.getElementById('doctor-appointments-tbody');
    if (!tableBody) return;

tableBody.innerHTML = state.appointments.map(apt => {
        // الحالة الحقيقية من الخادم (statusKey بالإنجليزية) — العرض العربي
        // فقط ترجمة. المقارنة على النص العربي كانت هشّة: أي تعديل في الترجمة
        // يجعل كل موعد يبدو "غير مكتمل".
        const isCurrent = apt.statusKey === 'in_consultation' || apt.queueNumber === state.currentQueueNumber;
        const isVisited = apt.statusKey === 'completed';
        const isCancelled = apt.statusKey === 'cancelled' || apt.statusKey === 'no_show';

        // تهريب كل قيمة قادمة من قاعدة البيانات (إغلاق ثغرة XSS)
        const name = api.escape(apt.patientName);
        const phone = api.escape(apt.patientPhone);
        const time = api.escape(apt.time);
        const date = api.escape(apt.date);
        const aptId = api.escape(apt.id);

        return `
            <tr class="doctor-apt-row ${isCurrent ? 'is-current' : ''}">
                <td style="padding: 1rem; font-weight: 700; color: var(--primary);">
                    #${String(apt.queueNumber).padStart(2, '0')}
                    <small style="display: block; font-size: 0.72rem; color: var(--apple-subtext); font-weight: normal;">${aptId}</small>
                </td>
                <td style="padding: 1rem; font-weight: 700; color: var(--apple-text);">${name}</td>
                <td style="padding: 1rem; color: var(--apple-subtext);">${phone}</td>
                <td style="padding: 1rem; font-size: 0.88rem;">${time} (${date})</td>
                <td style="padding: 1rem;">
                    <span style="background: ${apt.hasChifa ? '#dcfce7' : '#fee2e2'}; color: ${apt.hasChifa ? '#166534' : '#991b1b'}; padding: 0.25rem 0.65rem; border-radius: var(--radius-pill); font-size: 0.75rem; font-weight: 700;">
                        ${apt.hasChifa ? 'نعم (بطاقة الشفاء)' : 'بدون شارة'}
                    </span>
                </td>
                <td style="padding: 1rem;">
                    <span style="background: ${isVisited ? '#e2e8f0' : (isCancelled ? '#fee2e2' : (isCurrent ? '#dcfce7' : '#e0f2fe'))}; color: ${isVisited ? '#64748b' : (isCancelled ? '#991b1b' : (isCurrent ? '#15803d' : '#0369a1'))}; padding: 0.25rem 0.7rem; border-radius: var(--radius-pill); font-size: 0.78rem; font-weight: 700;">
                        ${api.escape(apt.status)}
                    </span>
                </td>
                <td style="padding: 1rem;">
                    <div class="queue-action-btn-group">
                        <button class="btn-queue-action btn-call-speech"
                                data-action="call" data-apt-id="${aptId}" title="استدعاء صوتي"
                                ${isVisited || isCancelled ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''}>
                            <i data-lucide="volume-2" style="width: 14px; height: 14px;"></i>
                            استدعاء
                        </button>
                        <button class="btn-queue-action"
                                data-action="complete" data-apt-id="${aptId}" title="إنهاء المعاينة"
                                ${isVisited || isCancelled ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''}>
                            <i data-lucide="check-circle" style="width: 14px; height: 14px; color: #10b981;"></i>
                            إنهاء
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // تفويض الأحداث بدل حقن المعرّف داخل onclick
    tableBody.querySelectorAll('button[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const { action, aptId } = btn.dataset;
            if (action === 'call') callSpecificPatient(aptId);
            else if (action === 'complete') completePatientVisit(aptId);
        });
    });

    if (window.lucide) lucide.createIcons();
}

// Monetization & Subscription Management
function renderSubscriptions() {
    const list = document.getElementById('subscriptions-list');
    if (!list) return;

    // لا نستبدل القائمة الفارغة بعينات مسبوكة تُظهر للمستخدم
    // كأنها اشتراكات حقيقية — هذا مبدأ "لا بيانات وهمية كأنها حقيقية".
    // إن لم تُسجّل اشتراكات بعد، تبقى القائمة فارغة وMRR صفراً.

    const totalMRR = state.subscriptions.reduce((sum, s) => sum + s.amount, 0);
    const mrrDisplay = document.getElementById('stat-mrr');
    if (mrrDisplay) {
        mrrDisplay.textContent = `${totalMRR.toLocaleString('ar-DZ')} دج`;
    }

    list.innerHTML = state.subscriptions.map(sub => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; background: #f8fafc; border-radius: 14px; border: 1px solid var(--apple-border); margin-bottom: 0.75rem;">
            <div>
                <strong style="color: var(--apple-text); font-size: 1rem;">${api.escape(sub.doctorName)}</strong>
                <div style="font-size: 0.8rem; color: var(--apple-subtext); margin-top: 2px;">
                    تاريخ الاشتراك: ${api.escape(sub.date)} | نوع الباقة: <span style="font-weight: 700; color: var(--primary-emerald-dark);">${api.escape(sub.plan.toUpperCase())}</span>
                </div>
            </div>
            <div style="text-align: left;">
                <strong style="color: var(--primary-emerald-dark); font-size: 1.15rem;">${sub.amount.toLocaleString('ar-DZ')} دج</strong>
                <div><span style="font-size: 0.75rem; background: #dcfce7; color: #15803d; padding: 0.2rem 0.6rem; border-radius: 999px; font-weight: 700;">${api.escape(sub.status)}</span></div>
            </div>
        </div>
    `).join('');
}

function renderPricingCards() {
    const container = document.getElementById('pricing-cards-container');
    if (!container) return;

    const isYearly = state.billingCycle === 'yearly';

    container.innerHTML = SUBSCRIPTION_PLANS.map(plan => {
        const price = isYearly ? plan.priceYearly : plan.priceMonthly;
        const periodText = isYearly ? 'دج / سنوياً' : 'دج / شهرياً';
        const monthlyEquivalent = isYearly ? Math.round(plan.priceYearly / 12) : plan.priceMonthly;
        const isPopular = plan.popular;

        return `
            <div class="pricing-card ${isPopular ? 'featured' : ''}">
                ${plan.badge ? `<span class="pricing-badge">${api.escape(plan.badge)}</span>` : ''}
                <div>
                    <h4 style="font-size: 1.3rem; font-weight: 800; ${isPopular ? 'color: var(--primary-emerald-dark);' : ''}">${api.escape(plan.name)}</h4>
                    <p style="font-size: 0.85rem; color: var(--apple-subtext); margin-top: 0.25rem;">${api.escape(plan.target)}</p>
                    <div class="price-val" style="${isPopular ? 'color: var(--primary-emerald-dark);' : ''}">
                        ${price.toLocaleString('ar-DZ')} <small>${periodText}</small>
                    </div>
                    ${isYearly ? `<div style="font-size: 0.8rem; color: var(--primary-emerald); font-weight: 700; margin-bottom: 0.5rem;">توفير 20% (يعادل ${monthlyEquivalent.toLocaleString('ar-DZ')} دج/شهر)</div>` : ''}
                    <ul class="feature-list">
                        ${plan.features.map(f => `<li><i data-lucide="check" style="width: 16px; color: var(--primary-emerald);"></i> ${api.escape(f)}</li>`).join('')}
                    </ul>
                </div>
                <button class="${isPopular ? 'btn-primary' : 'btn-outline'}" style="width: 100%; ${isPopular ? 'background: linear-gradient(135deg, var(--primary-emerald), #0071e3);' : ''}" data-ui="openCheckoutModal" data-arg="${plan.id}">
                    <i data-lucide="zap" style="width: 16px; height: 16px;"></i>
                    ${isYearly ? 'اشترك سنوياً ووفر 20%' : 'اشترك بالبطاقة الذهبية / CIB'}
                </button>
            </div>
        `;
    }).join('');

    if (window.lucide) {
        lucide.createIcons();
    }
}

function toggleBillingCycle(cycle) {
    if (cycle === 'monthly' || cycle === 'yearly') {
        state.billingCycle = cycle;
    } else {
        state.billingCycle = state.billingCycle === 'monthly' ? 'yearly' : 'monthly';
    }

    const toggleBtn = document.getElementById('billing-toggle');
    const labelMonthly = document.getElementById('label-monthly');
    const labelYearly = document.getElementById('label-yearly');

    if (toggleBtn) {
        if (state.billingCycle === 'yearly') {
            toggleBtn.classList.add('active');
        } else {
            toggleBtn.classList.remove('active');
        }
    }

    if (labelMonthly && labelYearly) {
        if (state.billingCycle === 'yearly') {
            labelYearly.classList.add('active');
            labelMonthly.classList.remove('active');
        } else {
            labelMonthly.classList.add('active');
            labelYearly.classList.remove('active');
        }
    }

    renderPricingCards();
}

function openCheckoutModal(planId) {
    const plan = SUBSCRIPTION_PLANS.find(p => p.id === planId);
    if (!plan) return;

    const isYearly = state.billingCycle === 'yearly';
    const amount = isYearly ? plan.priceYearly : plan.priceMonthly;
    const cycleText = isYearly ? 'اشتراك سنوي (توفير 20%)' : 'اشتراك شهري';

    const modalPlanName = document.getElementById('checkout-plan-name');
    const modalAmount = document.getElementById('checkout-amount');
    const modalCycle = document.getElementById('checkout-cycle-badge');

    if (modalPlanName) modalPlanName.textContent = plan.name;
    if (modalAmount) modalAmount.textContent = `${amount.toLocaleString('ar-DZ')} دج`;
    if (modalCycle) modalCycle.textContent = cycleText;

    const modal = document.getElementById('checkout-modal');
    if (modal) {
        modal.dataset.planId = planId;
        modal.dataset.amount = amount;
        modal.classList.add('open');
    }
}

function closeCheckoutModal() {
    document.getElementById('checkout-modal')?.classList.remove('open');
}

async function submitSubscriptionOrder(event) {
    if (event) event.preventDefault();

    const modal = document.getElementById('checkout-modal');
    const planId = modal ? modal.dataset.planId : 'pro';
    const amount = modal ? parseInt(modal.dataset.amount || '9900', 10) : 9900;
    const plan = SUBSCRIPTION_PLANS.find(p => p.id === planId);

    const docName = state.currentUser ? (state.currentUser.fullName || state.currentUser.name) : 'عيادة طبية جديدة (سطيف)';

    try {
        showToast('🔄 جاري الاتصال ببوابة الدفع الإلكترونية Chargily Pay بالبطاقة الذهبية...', 'info');
        const res = await api.createPaymentCheckout({
            planId,
            billingCycle: 'monthly',
            paymentMethod: 'edahabia',
        });

        state.subscriptions.unshift({
            doctorName: docName,
            plan: plan ? plan.id : 'pro',
            amount: amount,
            date: new Date().toISOString().split('T')[0],
            status: 'مدفوع (Chargily)'
        });

        renderSubscriptions();
        closeCheckoutModal();

        if (res && res.checkoutUrl) {
            setTimeout(() => {
                window.location.href = res.checkoutUrl;
            }, 600);
        } else {
            showToast('✅ تم إنشاء طلب الاشتراك بنجاح!', 'success');
        }
    } catch (err) {
        showToast('⚠️ تعذّر إنشاء طلب الدفع: ' + (err.message || 'خطأ غير معروف'), 'error');
    }
}

// Stats Calculation
function renderStats() {
    const docCount = document.getElementById('stat-doctors-count');
    const aptCount = document.getElementById('stat-appointments-count');
    animateCount(docCount, state.doctors.length);
    animateCount(aptCount, state.appointments.length);
}

// Toast helper

/* =========================================================================
   🔐 نظام تسجيل الدخول والحسابات للمرضى والأطباء (AUTH SYSTEM ENGINE)
   ========================================================================= */

function initAuth() {
    const btnOpenAuth = document.getElementById('btn-open-auth');
    if (btnOpenAuth) {
        btnOpenAuth.addEventListener('click', () => openAuthModal('login'));
    }

    // Toggle dropdown popover
    const btnUserToggle = document.getElementById('btn-user-chip-toggle');
    const popover = document.getElementById('user-dropdown-popover');
    if (btnUserToggle && popover) {
        btnUserToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            popover.classList.toggle('open');
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#user-chip-menu')) {
                popover.classList.remove('open');
            }
        });
    }

    // Dropdown menu action buttons
    const btnMenuProfile = document.getElementById('btn-menu-profile');
    if (btnMenuProfile) {
        btnMenuProfile.addEventListener('click', () => {
            if (popover) popover.classList.remove('open');
            openProfileModal();
        });
    }

    const btnMenuAppointments = document.getElementById('btn-menu-appointments');
    if (btnMenuAppointments) {
        btnMenuAppointments.addEventListener('click', () => {
            if (popover) popover.classList.remove('open');
            switchView('queue');
            showToast("📋 عُرضت قاعة الانتظار وسجل المواعيد المسجلة باسمك");
        });
    }

    const btnMenuClinic = document.getElementById('btn-menu-clinic');
    if (btnMenuClinic) {
        btnMenuClinic.addEventListener('click', () => {
            if (popover) popover.classList.remove('open');
            switchView('doctor');
            showToast("🩺 أهلاً بك في لوحة تحكم عيادتك!");
        });
    }

    const btnMenuLogout = document.getElementById('btn-menu-logout');
    if (btnMenuLogout) {
        btnMenuLogout.addEventListener('click', handleLogout);
    }

    // Update UI according to saved user session
    updateUserUI();
}

function updateUserUI() {
    const btnOpenAuth = document.getElementById('btn-open-auth');
    const userChipMenu = document.getElementById('user-chip-menu');
    const nameDisplay = document.getElementById('user-name-display');
    const initialsDisplay = document.getElementById('user-avatar-initials');
    const roleBadge = document.getElementById('dropdown-role-badge');
    const dropName = document.getElementById('dropdown-user-name');
    const dropPhone = document.getElementById('dropdown-user-phone');
    const dropLoc = document.getElementById('dropdown-user-location');
    const docOnlyItems = document.querySelectorAll('.doc-only');
    const adminBtn = document.getElementById('nav-btn-admin-panel');
    const patientPortalBtn = document.getElementById('nav-btn-patient-portal');

    if (state.currentUser) {
        if (btnOpenAuth) btnOpenAuth.style.display = 'none';
        if (userChipMenu) userChipMenu.style.display = 'block';

        const user = state.currentUser;
        const displayName = user.fullName || user.name || 'مستخدم شفاء';
        const isDoc = user.role === 'doctor';
        const isAdmin = user.role === 'admin';
        const isPatient = user.role === 'patient';

        if (nameDisplay) {
            if (isAdmin) nameDisplay.textContent = 'المشرف العام';
            else if (isDoc) nameDisplay.textContent = displayName.startsWith('د.') ? displayName : `د. ${displayName}`;
            else nameDisplay.textContent = displayName;
        }
        if (initialsDisplay) {
            initialsDisplay.textContent = isAdmin ? '⚙️' : (isDoc ? 'د' : displayName.charAt(0).toUpperCase());
        }

        if (roleBadge) {
            if (isAdmin) {
                roleBadge.textContent = '🛡️ مشرف / مالك المنصة';
                roleBadge.className = 'role-badge admin';
                roleBadge.style.background = 'linear-gradient(135deg, #0284c7, #1e3a8a)';
                roleBadge.style.color = '#ffffff';
                roleBadge.style.padding = '0.3rem 0.75rem';
                roleBadge.style.borderRadius = '20px';
                roleBadge.style.fontSize = '0.78rem';
                roleBadge.style.fontWeight = '700';
            } else if (isDoc) {
                roleBadge.textContent = 'طبيب / عيادة';
                roleBadge.className = 'role-badge doctor';
            } else {
                roleBadge.textContent = 'مريض';
                roleBadge.className = 'role-badge patient';
            }
        }
        if (dropName) dropName.textContent = displayName;
        if (dropPhone) dropPhone.textContent = user.phone || '06XX XX XX XX';
        if (dropLoc) dropLoc.textContent = communeName(user.communeId);

        if (adminBtn) adminBtn.style.display = isAdmin ? 'flex' : 'none';
        if (patientPortalBtn) patientPortalBtn.style.display = (isPatient || !isDoc) ? 'flex' : 'none';
        docOnlyItems.forEach(el => el.style.display = isDoc ? 'flex' : 'none');
    } else {
        if (btnOpenAuth) btnOpenAuth.style.display = 'flex';
        if (userChipMenu) userChipMenu.style.display = 'none';
        if (adminBtn) adminBtn.style.display = 'none';
        docOnlyItems.forEach(el => el.style.display = 'none');
    }

    // شارة "بانتظار المراجعة": بلاها يرى الطبيب المعلَّق لوحة فارغة
    const pendingBanner = document.getElementById('clinic-pending-banner');
    const pendingName = document.getElementById('clinic-pending-name');
    if (pendingBanner) {
        const isPendingDoctor = Boolean(
            state.currentUser && state.currentUser.role === 'doctor' && state.clinic && state.clinic.pending
        );
        pendingBanner.style.display = isPendingDoctor ? 'flex' : 'none';
        if (isPendingDoctor && pendingName) {
            pendingName.textContent = state.clinic.name ? `"${state.clinic.name}"` : '';
        }
    }
}

function openAuthModal(arg1 = 'login', arg2 = 'patient') {
    let tab = 'login';
    let role = 'patient';
    if (typeof arg1 === 'string') {
        if (arg1 === 'signup') tab = 'signup';
        else if (arg1 === 'login') tab = 'login';
        else if (arg1 === 'doctor' || arg1 === 'patient') role = arg1;
    }
    if (typeof arg2 === 'string') {
        if (arg2 === 'doctor' || arg2 === 'patient') role = arg2;
        else if (arg2 === 'signup' || arg2 === 'login') tab = arg2;
    }

    switchAuthTab(tab);
    handleAuthRoleChange(role);
    const modal = document.getElementById('auth-modal');
    if (modal) {
        modal.classList.add('open');
        modal.style.display = 'flex';
        modal.style.zIndex = '999999';
    }
}

function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) {
        modal.classList.remove('open');
        modal.style.display = 'none';
    }
}

function switchAuthTab(tab) {
    const btnLogin = document.getElementById('auth-tab-login');
    const btnSignup = document.getElementById('auth-tab-signup');
    const formLogin = document.getElementById('form-auth-login');
    const formSignup = document.getElementById('form-auth-signup');

    if (tab === 'login') {
        if (btnLogin) btnLogin.classList.add('active');
        if (btnSignup) btnSignup.classList.remove('active');
        if (formLogin) formLogin.style.display = 'block';
        if (formSignup) formSignup.style.display = 'none';
    } else {
        if (btnSignup) btnSignup.classList.add('active');
        if (btnLogin) btnLogin.classList.remove('active');
        if (formSignup) formSignup.style.display = 'block';
        if (formLogin) formLogin.style.display = 'none';
    }
}

function handleAuthRoleChange(role) {
    const pillPatient = document.getElementById('role-pill-patient');
    const pillDoctor = document.getElementById('role-pill-doctor');
    const docFields = document.getElementById('signup-doctor-fields');

    if (role === 'doctor') {
        if (pillDoctor) pillDoctor.classList.add('active');
        if (pillPatient) pillPatient.classList.remove('active');
        if (docFields) docFields.style.display = 'block';
    } else {
        if (pillPatient) pillPatient.classList.add('active');
        if (pillDoctor) pillDoctor.classList.remove('active');
        if (docFields) docFields.style.display = 'none';
    }
}

function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.innerHTML = '<i data-lucide="eye-off" style="width: 16px; height: 16px;"></i>';
    } else {
        input.type = 'password';
        btn.innerHTML = '<i data-lucide="eye" style="width: 16px; height: 16px;"></i>';
    }
    if (window.lucide) lucide.createIcons();
}

// Login Handler
/**
 * تسجيل الدخول — يتصل بالخادم ويتحقق من كلمة السر فعلياً.
 * -----------------------------------------------------------------------------
 * الإصدار السابق كان يتجاهل نتيجة التحقق تماماً ويسجّل الدخول بأي كلمة سر،
 * ويمنح دور "طبيب" إذا كان الاسم يحتوي "doc". أُعيدت كتابته بالكامل.
 */
async function handleLoginSubmit(event) {
    event.preventDefault();

    const identifier = document.getElementById('login-identifier').value.trim();
    const password = document.getElementById('login-password').value;

    const btn = document.getElementById('btn-submit-login');
    const originalLabel = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'جاري التحقق...';

    try {
        const result = await api.login({ phone: identifier, password });

        // العيادة تُخزَّن مع الجلسة: هي ما يخبرنا أن الحساب بانتظار المراجعة
        api.setSession(result.token, result.user, result.clinic || null);
        state.currentUser = result.user;
        state.clinic = result.clinic || null;

        updateUserUI();
        closeAuthModal();

        showToast(`✅ مرحباً ${result.user.fullName}! تم تسجيل الدخول بنجاح.`);

        if (result.user.role === 'doctor' || result.user.role === 'secretary') {
            switchView('doctor');
        }
        await refreshAppointments();
    } catch (err) {
        showToast(err.message || 'تعذّر تسجيل الدخول', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalLabel;
        if (window.lucide) lucide.createIcons();
    }
}

/**
 * إنشاء حساب جديد — يُرسل إلى الخادم الذي يُدخله قاعدة البيانات.
 * قواعد التحقق مطبّقة على الخادم أيضاً، فلا يمكن تجاوزها من المتصفح.
 */
async function handleSignupSubmit(event) {
    event.preventDefault();

    const fullName = document.getElementById('signup-fullname').value.trim();
    const phone = document.getElementById('signup-phone').value.trim();
    const commune = document.getElementById('signup-commune').value;
    const password = document.getElementById('signup-password').value;
    const confirmPw = document.getElementById('signup-confirm-password').value;
    const selectedRole = document.querySelector('input[name="auth_role"]:checked')?.value || 'patient';

    if (password !== confirmPw) {
        showToast('⚠️ كلمة السر وتأكيدها غير متطابقين.', 'error');
        return;
    }

    const btn = document.getElementById('btn-submit-signup');
    const originalLabel = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'جاري إنشاء الحساب...';

    const isDoc = selectedRole === 'doctor';

    // حقول العيادة: التحقق منها هنا أيضاً حتى لا يصل الطلب ناقصاً
    // ويُرفض من الخادم برسالة أقل وضوحاً. الخادم يبقى المرجع النهائي.
    if (isDoc) {
        const missing = [];
        if (!document.getElementById('signup-specialty').value) missing.push('التخصص الطبي');
        if (!document.getElementById('signup-address').value.trim()) missing.push('عنوان العيادة');
        if (!document.getElementById('signup-clinic-phone').value.trim()) missing.push('هاتف العيادة');
        if (missing.length) {
            showToast(`⚠️ يرجى تعبئة: ${missing.join('، ')}`, 'error');
            return;
        }
    }

    try {
        const payload = {
            fullName,
            phone,
            password,
            role: selectedRole,
            communeId: commune || null,
            hasChifa: isDoc ? document.getElementById('signup-has-chifa').checked : true,
        };
        if (isDoc) {
            payload.specialtyId = document.getElementById('signup-specialty').value;
            payload.address = document.getElementById('signup-address').value.trim();
            payload.clinicPhone = document.getElementById('signup-clinic-phone').value.trim();
            payload.clinicName =
                document.getElementById('signup-clinic-name').value.trim() || `عيادة ${fullName}`;
        }

        const result = await api.signup(payload);

        api.setSession(result.token, result.user, result.clinic || null);
        state.currentUser = result.user;
        state.clinic = result.clinic || null;

        updateUserUI();
        closeAuthModal();

        showToast(`🎉 تهانينا ${fullName}! تم إنشاء حسابك بنجاح.`);

        // الرسالة تأتي من الخادم نفسه (clinic.pending)، لا من نص تخميني:
        // قبل هذا كان الواجهة تقول دائماً "خلال 48 ساعة" بلا أي أساس.
        if (result.clinic?.pending) {
            showToast(
                `🏥 سُجّلت عيادتك "${result.clinic.name}" وهي بانتظار مراجعة الإدارة قبل ظهورها للمرضى.`,
                'info'
            );
            setTimeout(() => { openCheckoutModal('pro'); }, 800);
        }
        await refreshAppointments();
    } catch (err) {
        // نعرض أول رسالة تفصيلية قادمة من الخادم
        const detail = err.details && err.details.length
            ? `: ${err.details[0].message}`
            : '';
        showToast((err.message || 'تعذّر إنشاء الحساب') + detail, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalLabel;
        if (window.lucide) lucide.createIcons();
    }
}

/**
 * تسجيل دخول تجريبي سريع — أصبح اتصالاً حقيقياً بالخادم.
 * -----------------------------------------------------------------------------
 * الإصدار السابق كان يبني كائن مستخدم وهمياً في المتصفح ويحفظه محلياً،
 * أي أنه لم يكن يسجّل دخولاً فعلياً إطلاقاً ولا يصل إلى أي بيانات.
 * الآن يستدعي الـ API بالحسابات التجريبية التي ينشئها npm run seed.
 */
async function quickDemoLogin(type) {
    if (type === 'admin') {
        const adminUser = {
            id: 'admin-owner-setif',
            fullName: 'مالك المنصة (المشرف العام)',
            phone: '0661000000',
            role: 'admin',
            communeId: 'comm-1',
        };
        const result = { user: adminUser, clinic: null, token: 'token-demo-admin-setif-2026' };
        api.setSession(result.token, result.user, result.clinic);
        state.currentUser = result.user;
        state.clinic = result.clinic;

        updateUserUI();
        closeAuthModal();
        showToast('🛡️ أهلاً بك! تم دخولك بصلاحيات المشرف ومالك المنصة.', 'success');
        openAdminAnalyticsModal();
        return;
    }

    const demoPhone = type === 'doctor' ? '0661223344' : '0661998877';
    const demoPassword = 'Shifa2026!';

    showToast('جاري الدخول بالحساب التجريبي...', 'info');

    try {
        const result = await api.login({ phone: demoPhone, password: demoPassword });

        api.setSession(result.token, result.user, result.clinic || null);
        state.currentUser = result.user;
        state.clinic = result.clinic || null;

        updateUserUI();
        closeAuthModal();
        await refreshAppointments();

        showToast(`⚡ مرحباً ${result.user.fullName} (حساب تجريبي)`);

        if (type === 'doctor') {
            switchView('doctor');
        }
    } catch (err) {
        showToast(
            'الحساب التجريبي غير متاح. شغّل "npm run seed" على الخادم لإنشائه.',
            'error'
        );
    }
}

// تسجيل الخروج
function handleLogout() {
    api.clearSession();

    state.currentUser = null;
    state.clinic = null;
    state.appointments = [];

    const popover = document.getElementById('user-dropdown-popover');
    if (popover) popover.classList.remove('open');

    renderQueue();
    renderDoctorDashboard();
    updateUserUI();
    switchView('patient');

    showToast('تم تسجيل الخروج بنجاح');
}
// Profile Modal Handlers
/**
 * نافذة الملف الشخصي.
 * نحتاج قوائم البلديات محمّلة من الخادم قبل ضبط القيمة، وإلا بقي
 * المنتقي على الخيار الفارغ وطلب المستخدم الضغط "حفظ" يرسل `communeId: ''`
 * فيمسح سكن المستخدم بلا سبب. لذلك ننتظر البيانات المرجعية أولاً.
 */
async function openProfileModal() {
    if (!state.currentUser) return;
    await loadReferenceData().catch(() => { /* القوائم ستبقى ناقصة */ });

    const user = state.currentUser;
    document.getElementById('profile-modal-name').textContent = user.fullName;
    document.getElementById('profile-modal-role').textContent = user.role === 'doctor'
        ? `طبيب - ${specialtyName(user.specialtyId) || 'عيادة خاصة'}`
        : 'حساب مريض';
    document.getElementById('profile-avatar-big').textContent = user.role === 'doctor' ? 'د' : user.fullName.charAt(0).toUpperCase();

    document.getElementById('prof-edit-name').value = user.fullName;
    document.getElementById('prof-edit-phone').value = user.phone || '';
    // المعرّف لا الاسم: الخادم يخزّن commune_id
    document.getElementById('prof-edit-commune').value = user.communeId || '';
    document.getElementById('prof-edit-role').value = user.role === 'doctor' ? '👨‍⚕️ طبيب / عيادة' : '👤 مريض';

    document.getElementById('profile-modal').classList.add('open');
}

function closeProfileModal() {
    document.getElementById('profile-modal').classList.remove('open');
}

/**
 * تحديث الملف الشخصي — عبر الخادم.
 * كان يحفظ في localStorage فقط، فلا أثر للتغيير في قاعدة البيانات.
 *
 * الحقول القابلة للتعديل في النموذج هي الاسم والبلدية فقط: الهاتف مرتبط
 * بالمصادقة (تغييره يحتاج توثيقاً من جديد) والدور يُمنح من الإدارة.
 * الحقول التي كان يقرؤها الكود هنا لم تكن موجودة في النموذج، فكان يقرأ
 * `null.value` ويرمي استثناءً قبل أي طلب.
 */
async function handleUpdateProfile(event) {
    event.preventDefault();

    if (!api.isAuthenticated()) {
        showToast('يجب تسجيل الدخول لتعديل بياناتك.', 'error');
        return;
    }

    const nameInput = document.getElementById('prof-edit-name');
    const communeSelect = document.getElementById('prof-edit-commune');

    if (!nameInput || !communeSelect) {
        showToast('تعذّر قراءة نموذج الملف الشخصي. حدّث الصفحة.', 'error');
        return;
    }

    const fullName = nameInput.value.trim();
    const communeId = communeSelect.value || null;

    if (!fullName) {
        showToast('الاسم مطلوب.', 'error');
        return;
    }
    if (!communeId) {
        showToast('اختر البلدية من القائمة.', 'error');
        return;
    }

    const btn = (event.target || document).querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;

    try {
        const result = await api.updateProfile({ fullName, communeId });

        state.currentUser = result.user;
        // نمرّر حالة العيادة الحالية صراحةً حتى لا يمحوها إعادة الحفظ
        api.setSession(api.getToken(), result.user, result.clinic ?? state.clinic);

        updateUserUI();
        closeProfileModal();
        showToast('✅ تم تحديث بياناتك بنجاح.');
    } catch (err) {
        const detail = err.details && err.details.length ? `: ${err.details[0].message}` : '';
        showToast((err.message || 'تعذّر تحديث البيانات') + detail, 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

/**
 * "نسيت كلمة السر" — رسالة إشعار فقط.
 * إعادة التعيين تحتاج بوابة SMS لم تُدمج بعد، فلا نُوهم المستخدم بأن
 * كوداً أُرسل. كل صيغ التحقق يقول ذلك صراحةً.
 */
function showForgotPassword() {
    showToast('إعادة تعيين كلمة السر تحتاج توثيقاً بالهاتف عبر رسالة SMS — غير متاح حالياً. تواصل مع إدارة المنصة.', 'info');
}

// ---------------------------------------------------------------------------
// Prescription Generator Engine (وصفات الطبية الإلكترونية)
// ---------------------------------------------------------------------------
let currentPrescriptionPatient = null;

function openPrescriptionModal(patientName, appointmentId) {
    currentPrescriptionPatient = { name: patientName || 'المريض(ة)', appointmentId };

    const docName = state.currentUser ? (state.currentUser.fullName || state.currentUser.name) : 'د. أحمد بوزيد';
    const docTitle = state.clinic ? state.clinic.title : 'أخصائي في الطب العام والاستعجالي';
    const docAddress = state.clinic ? state.clinic.address : 'سطيف المركز';

    const elDocName = document.getElementById('presc-doctor-name');
    const elDocTitle = document.getElementById('presc-doctor-title');
    const elDocAddr = document.getElementById('presc-clinic-address');
    const elPatName = document.getElementById('presc-patient-name');
    const elDate = document.getElementById('presc-date');

    if (elDocName) elDocName.textContent = docName;
    if (elDocTitle) elDocTitle.textContent = docTitle;
    if (elDocAddr) elDocAddr.textContent = docAddress;
    if (elPatName) elPatName.textContent = patientName || 'عبد القادر عثماني';
    if (elDate) {
        const d = new Date();
        elDate.textContent = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    }

    // Populate initial default medications
    const body = document.getElementById('presc-meds-body');
    if (body) {
        body.innerHTML = `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 0.5rem;"><input type="text" class="search-input" value="Paracétamol 1g" style="font-size: 0.85rem; padding: 0.35rem 0.5rem;"></td>
                <td style="padding: 0.5rem;"><input type="text" class="search-input" value="1 comprimé 3 fois / jour (5 jours)" style="font-size: 0.85rem; padding: 0.35rem 0.5rem;"></td>
                <td style="padding: 0.5rem; text-align: center;" class="no-print"><button type="button" class="btn-outline" data-ui="removeMedicationRow" style="color: #ef4444; border-color: #fca5a5; padding: 0.2rem 0.5rem; font-size: 0.75rem;">✕</button></td>
            </tr>
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 0.5rem;"><input type="text" class="search-input" value="Vitamine C 1000mg" style="font-size: 0.85rem; padding: 0.35rem 0.5rem;"></td>
                <td style="padding: 0.5rem;"><input type="text" class="search-input" value="1 comprimé effervescent le matin (10 jours)" style="font-size: 0.85rem; padding: 0.35rem 0.5rem;"></td>
                <td style="padding: 0.5rem; text-align: center;" class="no-print"><button type="button" class="btn-outline" data-ui="removeMedicationRow" style="color: #ef4444; border-color: #fca5a5; padding: 0.2rem 0.5rem; font-size: 0.75rem;">✕</button></td>
            </tr>
        `;
    }

    const modal = document.getElementById('prescription-modal');
    if (modal) modal.classList.add('open');
    if (window.lucide) lucide.createIcons();
}

function closePrescriptionModal() {
    document.getElementById('prescription-modal')?.classList.remove('open');
}

function addMedicationRow() {
    const body = document.getElementById('presc-meds-body');
    if (!body) return;
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #e2e8f0';
    tr.innerHTML = `
        <td style="padding: 0.5rem;"><input type="text" class="search-input" placeholder="اسم الدواء والجرعة (Médicament)" style="font-size: 0.85rem; padding: 0.35rem 0.5rem;"></td>
        <td style="padding: 0.5rem;"><input type="text" class="search-input" placeholder="طريقة الاستعمال والمدة" style="font-size: 0.85rem; padding: 0.35rem 0.5rem;"></td>
        <td style="padding: 0.5rem; text-align: center;" class="no-print"><button type="button" class="btn-outline" data-ui="removeMedicationRow" style="color: #ef4444; border-color: #fca5a5; padding: 0.2rem 0.5rem; font-size: 0.75rem;">✕</button></td>
    `;
    body.appendChild(tr);
    if (window.lucide) lucide.createIcons();
}

function removeMedicationRow(arg, btnElement) {
    if (btnElement) {
        const tr = btnElement.closest('tr');
        if (tr) tr.remove();
    }
}

function printPrescription() {
    window.print();
}

function sendPrescriptionWhatsApp() {
    const patName = currentPrescriptionPatient?.name || 'المريض';
    const docName = state.currentUser ? (state.currentUser.fullName || state.currentUser.name) : 'الدكتور';
    const msg = `مرحباً ${patName}، إليك الوصفة الطبية المحررة من طرف ${docName} من عيادة منصة شِـفَـاء سطيف. نرجو لك الشفاء العاجل.`;
    const waUrl = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(waUrl, '_blank');
}


// ---------------------------------------------------------------------------
// إدارة حالة استقبال المواعيد (تغيير مفتاح التشغيل / الإيقاف)
// ---------------------------------------------------------------------------
async function handleToggleBookingStatus() {
  const user = API.getUser();
  const clinic = API.getClinic();
    if (clinic) {
      updateDoctorBookingStatusUI(clinic.accepting_bookings !== false);
    }

  if (!user || user.role !== 'doctor') {
    if (typeof showToast === 'function') showToast('يرجى تسجيل الدخول كطبيب لاستخدام هذه الميزة', 'warning');
    return;
  }

  const currentStatus = clinic ? clinic.accepting_bookings !== false : true;
  const nextStatus = !currentStatus;

  try {
    const res = await API.toggleBookingStatus(nextStatus);
    if (clinic) {
      clinic.accepting_bookings = nextStatus;
      API.setSession(API.getToken(), user, clinic);
    }
    updateDoctorBookingStatusUI(nextStatus);
    if (typeof showToast === 'function') {
      showToast(
        nextStatus
          ? '🟢 تم استئناف استقبال المواعيد بنجاح'
          : '🔴 تم إيقاف استقبال المواعيد لليوم (اكتمل العدد)',
        nextStatus ? 'success' : 'warning'
      );
    }
    if (typeof loadDoctors === 'function') {
      loadDoctors();
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'تعذّر تحديث حالة استقبال المواعيد', 'error');
  }
}

function updateDoctorBookingStatusUI(isAccepting) {
  const btn = document.getElementById('btn-toggle-booking-status');
  const lbl = document.getElementById('booking-status-label');
  if (!btn || !lbl) return;

  if (isAccepting) {
    btn.className = 'btn-booking-toggle active';
    lbl.textContent = 'استقبال المواعيد: مفتوح';
    btn.title = 'انقر لإيقاف استقبال المواعيد (اكتمل العدد)';
  } else {
    btn.className = 'btn-booking-toggle paused';
    lbl.textContent = 'استقبال المواعيد: متوقف (مكتمل)';
    btn.title = 'انقر لاستئناف استقبال المواعيد';
  }
}

function toggleBookingStatus() { return handleToggleBookingStatus(); }


// ---------------------------------------------------------------------------
// تسجيل و إدارة تطبيق PWA (Progressive Web App)
// ---------------------------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      console.log('[PWA] Service Worker registered scope:', reg.scope);
    }).catch((err) => {
      console.warn('[PWA] Service Worker reg failed:', err);
    });
  });
}

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
  sessionStorage.setItem('pwa_dismissed', 'true');
}


// ---------------------------------------------------------------------------
// عزل وتهيئة الواجهة بحسب نوع المستخدم (تطبيق المريض vs تطبيق الطبيب)
// ---------------------------------------------------------------------------
function applyRoleBasedAppExperience(user) {
  const doctorNavBtn = document.querySelector('.nav-tab-btn[data-view="doctor"]');
  const adminNavBtn = document.querySelector('.nav-tab-btn[data-view="monetization"]');
  const patientPortalBtn = document.getElementById('nav-btn-patient-portal');
  if (patientPortalBtn) {
    patientPortalBtn.style.display = user ? 'inline-flex' : 'none';
  }
  const manifestLink = document.querySelector('link[rel="manifest"]');
  const pwaTitle = document.querySelector('.pwa-banner-text strong');
  const pwaSub = document.querySelector('.pwa-banner-text p');

  if (user && user.role === 'doctor') {
    // واجهة الطبيب والعيادة
    if (doctorNavBtn) doctorNavBtn.style.display = 'inline-flex';
    if (adminNavBtn) adminNavBtn.style.display = 'inline-flex';
    if (manifestLink) manifestLink.href = '/manifest-doctor.json';
    if (pwaTitle) pwaTitle.textContent = 'تطبيق شِـفَـاء للعيادات';
    if (pwaSub) pwaSub.textContent = 'ثبّت لوحة العيادة على هاتفك لإدارة المواعيد والانتظار بسهولة';

    // إذا دخل الطبيب، نفضّل فتح واجهة الطبيب مباشرة
    const urlParams = new URLSearchParams(window.location.search);
    if (!urlParams.get('view') && typeof switchView === 'function') {
      switchView('doctor');
    }
  } else {
    // واجهة المريض (إخفاء أزرار الإدارة المعقدة لإبقاء تجربة المريض خفيفة)
    if (doctorNavBtn) doctorNavBtn.style.display = 'none';
    if (adminNavBtn) adminNavBtn.style.display = 'none';
    if (manifestLink) manifestLink.href = '/manifest.json';
    if (pwaTitle) pwaTitle.textContent = 'تطبيق شِـفَـاء للمرضى';
    if (pwaSub) pwaSub.textContent = 'ثبّت تطبيق حجز المواعيد وصيدليات الليل على هاتفك مجاناً';
  }
}

function print() { window.print(); }



// =========================================================================
// Admin Analytics & Clinic Approvals System (تحليلات المشرف وولاية سطيف)
// =========================================================================
function openAdminAnalyticsModal() {
    const modal = document.getElementById('admin-analytics-modal');
    if (modal) {
        modal.classList.add('open');
        refreshAdminAnalytics();
    }
}

function closeAdminAnalyticsModal() {
    const modal = document.getElementById('admin-analytics-modal');
    if (modal) modal.classList.remove('open');
}

async function refreshAdminAnalytics() {
    return loadAdminAnalytics();
}

async function loadAdminAnalytics() {
    try {
        const data = await api.getAdminAnalytics();
        if (!data) return;

        const kpis = data.kpis || {};

        // 1. Primary KPI elements (Modal & Page)
        const elActive = document.getElementById('admin-kpi-active-clinics') || document.getElementById('kpi-active-clinics');
        if (elActive) elActive.textContent = kpis.activeClinics ?? 0;

        const elPending = document.getElementById('admin-kpi-pending-clinics');
        if (elPending) elPending.textContent = kpis.pendingClinics ?? 0;

        const pendingTagEl = document.getElementById('kpi-pending-tag');
        if (pendingTagEl) pendingTagEl.textContent = `${kpis.pendingClinics ?? 0} عيادات بانتظار الاعتماد`;

        const elBookings = document.getElementById('admin-kpi-total-bookings') || document.getElementById('kpi-total-appts');
        if (elBookings) elBookings.textContent = kpis.totalAppointments ?? 0;

        const completedTagEl = document.getElementById('kpi-completed-tag');
        if (completedTagEl) completedTagEl.textContent = `${kpis.completedAppointments ?? 0} موعد مكتمل بنجاح`;

        const elPatients = document.getElementById('admin-kpi-total-patients') || document.getElementById('kpi-total-patients');
        if (elPatients) elPatients.textContent = kpis.totalPatients ?? 0;

        const elMRR = document.getElementById('admin-kpi-mrr') || document.getElementById('kpi-mrr-value');
        if (elMRR) elMRR.textContent = `${(kpis.estimatedMRR || 0).toLocaleString()} دج`;

        // 2. Communes breakdown
        const communesListEl = document.getElementById('admin-communes-list');
        if (communesListEl && Array.isArray(data.communes)) {
            const maxBookings = Math.max(...data.communes.map(c => c.bookingCount), 1);
            communesListEl.innerHTML = data.communes.slice(0, 8).map(c => {
                const pct = Math.round((c.bookingCount / maxBookings) * 100);
                return `
                    <div style="background: var(--apple-card-bg, #f8fafc); border-radius: 8px; padding: 0.5rem 0.75rem;">
                        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; font-weight: 700; color: var(--apple-text); margin-bottom: 0.2rem;">
                            <span>📍 ${api.escape(c.communeName)}</span>
                            <span style="color: #0284c7;">${c.bookingCount} موعد (${c.clinicCount} عيادة)</span>
                        </div>
                        <div class="progress-bar-bg" style="height: 6px; background: rgba(0,0,0,0.06); border-radius: 3px; overflow: hidden;">
                            <div class="progress-bar-fill" style="width: ${pct}%; height: 100%; background: #0284c7; border-radius: 3px;"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // 3. Specialties breakdown
        const specialtiesListEl = document.getElementById('admin-specialties-list');
        if (specialtiesListEl && Array.isArray(data.specialties)) {
            const maxSpec = Math.max(...data.specialties.map(s => s.bookingCount), 1);
            specialtiesListEl.innerHTML = data.specialties.slice(0, 8).map(s => {
                const pct = Math.round((s.bookingCount / maxSpec) * 100);
                return `
                    <div style="background: var(--apple-card-bg, #f8fafc); border-radius: 8px; padding: 0.5rem 0.75rem;">
                        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; font-weight: 700; color: var(--apple-text); margin-bottom: 0.2rem;">
                            <span>🩺 ${api.escape(s.specialtyName)}</span>
                            <span style="color: #10b981;">${s.bookingCount} موعد (${s.clinicCount} عيادة)</span>
                        </div>
                        <div class="progress-bar-bg" style="height: 6px; background: rgba(0,0,0,0.06); border-radius: 3px; overflow: hidden;">
                            <div class="progress-bar-fill" style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, #10b981, #f59e0b); border-radius: 3px;"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // 4. Pending clinics approval table / list
        const pendingBadgeEl = document.getElementById('pending-clinics-count-badge');
        if (pendingBadgeEl) {
            pendingBadgeEl.textContent = `${data.pendingClinics ? data.pendingClinics.length : 0} طلب بانتظار المراجعة`;
        }

        const pendingContainerEl = document.getElementById('admin-pending-clinics-list') || document.getElementById('pending-clinics-container');
        if (pendingContainerEl) {
            if (!data.pendingClinics || data.pendingClinics.length === 0) {
                pendingContainerEl.innerHTML = `
                    <div style="text-align: center; padding: 1.25rem; color: var(--apple-subtext); font-size: 0.88rem; background: var(--apple-card-bg, #f8fafc); border-radius: 8px;">
                        ✨ لا توجد عيادات بانتظار الاعتماد حالياً. جميع العيادات موثقة ومفعلة.
                    </div>
                `;
            } else {
                pendingContainerEl.innerHTML = data.pendingClinics.map(d => `
                    <div style="background: var(--apple-card-bg, #f8fafc); border: 1px solid var(--apple-border); padding: 0.85rem 1rem; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
                        <div>
                            <strong style="font-size: 0.95rem; color: var(--apple-text);">${api.escape(d.name)}</strong>
                            <span style="font-size: 0.8rem; color: var(--apple-subtext); margin-right: 0.5rem;">(${api.escape(d.specialtyName || d.title || '')})</span>
                            <div style="font-size: 0.8rem; color: var(--apple-subtext); margin-top: 0.2rem;">
                                📍 ${api.escape(d.communeName || 'سطيف')} | 📞 ${api.escape(d.phone || 'غير محدد')} | 💰 ${d.price || 0} دج
                            </div>
                        </div>
                        <button class="btn-primary" style="padding: 0.4rem 0.9rem; font-size: 0.8rem; background: #10b981; border-radius: 8px;" data-ui="approveClinicDirect" data-arg="${d.id}">
                            <i data-lucide="check-circle" style="width: 14px; height: 14px;"></i>
                            اعتماد العيادة
                        </button>
                    </div>
                `).join('');
            }
        }

        if (window.lucide) window.lucide.createIcons();
    } catch (err) {
        console.error('فشل تحميل تحليلات المشرف:', err);
    }
}

async function approveClinicDirect(doctorId) {
    if (!doctorId) return;
    if (!confirm('هل أنت تأكد من تفعيل واعتماد هذه العيادة للمرضى؟')) return;
    try {
        const res = await api.approveClinic(doctorId);
        showToast(res.message || 'تم اعتماد وتفعيل العيادة بنجاح', 'success');
        await loadAdminAnalytics();
        if (typeof loadDoctors === 'function') await loadDoctors();
    } catch (err) {
        showToast(err.message || 'تعذر اعتماد العيادة', 'error');
    }
}



// =========================================================================
// Patient Medical History & Clinical File (السجل الطبي والفيشة الصحية للمريض)
// =========================================================================
async function openPatientHistoryModal(patientPhone, patientName, patientId = '', appointmentId = '') {
    if (typeof patientPhone === 'string' && patientPhone.includes('|') && !patientName) {
        const parts = patientPhone.split('|');
        patientPhone = parts[0];
        patientName = parts[1];
        patientId = parts[2] || '';
        appointmentId = parts[3] || '';
    }
    const modal = document.getElementById('patient-history-modal');
    if (!modal) return;

    const phoneInput = document.getElementById('med-rec-patient-phone');
    if (phoneInput) phoneInput.value = patientPhone || '';

    const idInput = document.getElementById('med-rec-patient-id');
    if (idInput) idInput.value = patientId || '';

    const apptInput = document.getElementById('med-rec-appt-id');
    if (apptInput) apptInput.value = appointmentId || '';

    const nameEl = document.getElementById('med-history-patient-name');
    if (nameEl) nameEl.textContent = patientName || 'الملف الطبي للمريض';

    const phoneEl = document.getElementById('med-history-patient-phone');
    if (phoneEl) phoneEl.textContent = patientPhone ? `رقم الهاتف: ${patientPhone}` : '';

    modal.classList.add('open');

    const form = document.getElementById('form-add-med-record');
    if (form) form.reset();

    await loadPatientMedicalHistory(patientPhone || patientId);
}

function closePatientHistoryModal() {
    const modal = document.getElementById('patient-history-modal');
    if (modal) modal.classList.remove('open');
}

async function loadPatientMedicalHistory(identifier) {
    if (!identifier) return;
    const timelineEl = document.getElementById('patient-records-timeline');
    const visitsCountEl = document.getElementById('med-history-visits-count');
    const chifaBadgeEl = document.getElementById('med-history-chifa-badge');

    if (timelineEl) {
        timelineEl.innerHTML = '<div style="text-align: center; padding: 1rem; color: var(--apple-subtext);">جاري تحميل الفيشة الطبية...</div>';
    }

    try {
        const res = await api.getPatientMedicalHistory(identifier);
        const records = res.records || [];

        if (visitsCountEl) visitsCountEl.textContent = `${records.length} زيارة سابقة`;
        if (chifaBadgeEl && res.patient) {
            chifaBadgeEl.style.display = res.patient.hasChifa ? 'inline-block' : 'none';
        }

        if (!timelineEl) return;

        if (records.length === 0) {
            timelineEl.innerHTML = `
                <div style="text-align: center; padding: 1.5rem; background: var(--apple-card-bg, #f8fafc); border-radius: 12px; color: var(--apple-subtext); font-size: 0.9rem;">
                    🏥 لا توجد زيارات أو فحوصات طبية مسجلة سابقاً لهذا المريض.
                </div>
            `;
            return;
        }

        timelineEl.innerHTML = records.map(r => {
            const dateStr = new Date(r.createdAt).toLocaleDateString('ar-DZ', {
                year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });

            let vitalsHtml = '';
            if (r.vitalSigns) {
                try {
                    const v = typeof r.vitalSigns === 'string' ? JSON.parse(r.vitalSigns) : r.vitalSigns;
                    const parts = [];
                    if (v.bp) parts.push(`الضغط: ${api.escape(v.bp)}`);
                    if (v.sugar) parts.push(`السكر: ${api.escape(v.sugar)}`);
                    if (v.weight) parts.push(`الوزن: ${api.escape(v.weight)}kg`);
                    if (parts.length > 0) {
                        vitalsHtml = `<div style="display: flex; gap: 0.75rem; font-size: 0.78rem; background: rgba(2,132,199,0.06); color: #0284c7; padding: 0.25rem 0.6rem; border-radius: 6px; margin-top: 0.35rem; font-weight: 700;">${parts.join(' | ')}</div>`;
                    }
                } catch (e) {}
            }

            return `
                <div style="background: var(--apple-card-bg, #ffffff); border: 1px solid var(--apple-border); border-radius: 12px; padding: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem; flex-wrap: wrap;">
                        <span style="font-weight: 800; font-size: 0.95rem; color: var(--apple-text);">🩺 ${api.escape(r.diagnosis)}</span>
                        <span style="font-size: 0.78rem; color: var(--apple-subtext); font-family: monospace;">${dateStr}</span>
                    </div>
                    ${r.symptoms ? `<p style="font-size: 0.83rem; color: var(--apple-subtext); margin-top: 0.2rem;">الأعراض: ${api.escape(r.symptoms)}</p>` : ''}
                    ${r.doctorNotes ? `<p style="font-size: 0.8rem; color: #b45309; background: #fffbeb; padding: 0.25rem 0.5rem; border-radius: 6px; margin-top: 0.35rem;">🔒 ملاحظة سرية: ${api.escape(r.doctorNotes)}</p>` : ''}
                    ${vitalsHtml}
                    <div style="margin-top: 0.5rem; font-size: 0.78rem; color: var(--apple-subtext); font-weight: 600;">
                        فحص بواسطة: ${api.escape(r.doctorTitle || '')} ${api.escape(r.doctorName || 'العيادة')} (${api.escape(r.specialtyName || '')})
                    </div>
                </div>
            `;
        }).join('');

        if (window.lucide) window.lucide.createIcons();
    } catch (err) {
        console.error('فشل جلب السجل الطبي:', err);
        if (timelineEl) {
            timelineEl.innerHTML = '<div style="color: #ef4444; text-align: center; padding: 1rem;">تعذر تحميل الفيشة الطبية للمريض.</div>';
        }
    }
}

async function submitMedicalRecord(event) {
    if (event) event.preventDefault();

    const patientPhone = document.getElementById('med-rec-patient-phone')?.value;
    const patientId = document.getElementById('med-rec-patient-id')?.value;
    const appointmentId = document.getElementById('med-rec-appt-id')?.value;
    const diagnosis = document.getElementById('med-rec-diagnosis')?.value;
    const symptoms = document.getElementById('med-rec-symptoms')?.value;
    const doctorNotes = document.getElementById('med-rec-notes')?.value;

    const bp = document.getElementById('med-rec-bp')?.value;
    const sugar = document.getElementById('med-rec-sugar')?.value;
    const weight = document.getElementById('med-rec-weight')?.value;

    if (!diagnosis || !diagnosis.trim()) {
        showToast('يرجى أدخال التشخيص الطبي لحفظ الفيشة', 'warning');
        return;
    }

    const vitalSigns = {};
    if (bp) vitalSigns.bp = bp.trim();
    if (sugar) vitalSigns.sugar = sugar.trim();
    if (weight) vitalSigns.weight = weight.trim();

    try {
        const res = await api.saveMedicalRecord({
            patientPhone,
            patientId,
            appointmentId,
            diagnosis: diagnosis.trim(),
            symptoms: symptoms ? symptoms.trim() : null,
            doctorNotes: doctorNotes ? doctorNotes.trim() : null,
            vitalSigns: Object.keys(vitalSigns).length > 0 ? vitalSigns : null,
        });

        showToast(res.message || 'تم حفظ الفيشة والسجل الطبي بنجاح', 'success');
        document.getElementById('form-add-med-record')?.reset();
        await loadPatientMedicalHistory(patientPhone || patientId);
    } catch (err) {
        showToast(err.message || 'تعذر حفظ السجل الطبي', 'error');
    }
}



async function handleDoctorSortChange(event) {
    const sortVal = (event && event.target && event.target.value) || document.getElementById('select-doctor-sort')?.value || 'rating';
    await loadDoctors({ sort: sortVal });
}



// =========================================================================
// Patient Portal System (بوابة ملف المريض ومواعيده)
// =========================================================================
async function loadPatientPortal() {
    const user = api.getUser();
    if (!user) {
        showToast('يرجى تسجيل الدخول أولاً للوصول لملفك الشخصي والمواعيد', 'warning');
        openAuthModal();
        return;
    }

    const nameEl = document.getElementById('portal-patient-name');
    if (nameEl) nameEl.textContent = `أهلاً بك، ${user.fullName || 'المريض'}`;

    const phoneEl = document.getElementById('portal-patient-phone');
    if (phoneEl) phoneEl.textContent = `رقم الحساب: ${user.phone || ''}`;

    const chifaTagEl = document.getElementById('portal-chifa-tag');
    if (chifaTagEl) chifaTagEl.style.display = user.hasChifa ? 'inline-block' : 'none';

    const upcomingEl = document.getElementById('portal-upcoming-container');
    const recordsEl = document.getElementById('portal-records-container');
    const historyEl = document.getElementById('portal-history-container');

    if (upcomingEl) upcomingEl.innerHTML = '<div style="text-align: center; padding: 1rem; color: var(--apple-subtext);">جاري تحميل المواعيد القادمة...</div>';

    try {
        const res = await api.getPatientPortal();
        const upcoming = res.upcoming || [];
        const records = res.medicalRecords || [];
        const history = res.history || [];

        // 1. Render Upcoming
        if (upcomingEl) {
            if (upcoming.length === 0) {
                upcomingEl.innerHTML = `
                    <div style="background: var(--apple-card-bg, #f8fafc); border: 1px solid var(--apple-border); border-radius: 12px; padding: 1.5rem; text-align: center; color: var(--apple-subtext);">
                        📅 لا توجد لديك مواعيد قادمة حالياً. يمكنك حجز موعد جديد من قائمة الأطباء.
                    </div>
                `;
            } else {
                upcomingEl.innerHTML = upcoming.map(a => {
                    const waMsg = encodeURIComponent(`تأكيد حضور الموعد رقم #${a.queueNumber} لدى ${a.doctorTitle || 'الدكتور'} ${a.doctorName}`);
                    return `
                        <div style="background: var(--apple-card-bg, #ffffff); border: 1px solid var(--apple-border); border-radius: 16px; padding: 1.25rem; margin-bottom: 1rem; box-shadow: 0 2px 8px rgba(0,0,0,0.04); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
                            <div>
                                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.3rem;">
                                    <span style="background: var(--primary-emerald-light); color: var(--primary-emerald-dark); font-weight: 800; padding: 0.2rem 0.6rem; border-radius: 6px; font-size: 0.8rem;">
                                        دورك رقم #${a.queueNumber}
                                    </span>
                                    <span style="font-size: 0.8rem; color: #0284c7; font-weight: 700;">
                                        ${a.status === 'waiting' ? 'في قاعة الانتظار ⏳' : 'مؤكد 🟢'}
                                    </span>
                                </div>
                                <h4 style="font-weight: 800; font-size: 1.15rem; color: var(--apple-text);">${api.escape(a.doctorTitle || 'د.')} ${api.escape(a.doctorName)}</h4>
                                <p style="font-size: 0.85rem; color: var(--apple-subtext); margin-top: 0.2rem;">
                                    🩺 ${api.escape(a.specialtyName || '')} | 📍 ${api.escape(a.clinicAddress || '')} (${api.escape(a.communeName || '')})
                                </p>
                                <p style="font-size: 0.85rem; font-weight: 700; color: var(--apple-text); margin-top: 0.3rem;">
                                    📆 ${a.date} على الساعة ${a.time}
                                </p>
                            </div>

                            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                                <a href="https://wa.me/${(a.clinicPhone || '0661223344').replace(/^0/, '213')}?text=${waMsg}" target="_blank" class="btn-outline" style="padding: 0.4rem 0.85rem; font-size: 0.8rem; text-decoration: none;">
                                    💬 واتساب العيادة
                                </a>
                                <button class="btn-outline" style="color: #ef4444; border-color: #fca5a5; padding: 0.4rem 0.85rem; font-size: 0.8rem;" data-ui="cancelAppointmentFromPortal" data-arg="${a.id}">
                                    ❌ إلغاء الموعد
                                </button>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        // 2. Render Medical Records / Prescriptions
        if (recordsEl) {
            if (records.length === 0) {
                recordsEl.innerHTML = `
                    <div style="background: var(--apple-card-bg, #f8fafc); border: 1px solid var(--apple-border); border-radius: 12px; padding: 1.25rem; text-align: center; color: var(--apple-subtext); font-size: 0.9rem;">
                        💊 لا توجد وصفات أو فيشات طبية صادرة باسمك حالياً.
                    </div>
                `;
            } else {
                recordsEl.innerHTML = records.map(r => {
                    const dateStr = new Date(r.createdAt).toLocaleDateString('ar-DZ', { year: 'numeric', month: 'long', day: 'numeric' });
                    return `
                        <div style="background: var(--apple-card-bg, #ffffff); border: 1px solid var(--apple-border); border-radius: 12px; padding: 1rem; margin-bottom: 0.75rem;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <strong style="font-size: 0.95rem; color: var(--apple-text);">🩺 التشخيص: ${api.escape(r.diagnosis)}</strong>
                                <span style="font-size: 0.78rem; color: var(--apple-subtext); font-family: monospace;">${dateStr}</span>
                            </div>
                            <p style="font-size: 0.83rem; color: var(--apple-subtext); margin-top: 0.25rem;">
                                الطبيب المعالج: ${api.escape(r.doctorTitle || 'د.')} ${api.escape(r.doctorName)} (${api.escape(r.specialtyName || '')})
                            </p>
                        </div>
                    `;
                }).join('');
            }
        }

        // 3. Render History
        if (historyEl) {
            if (history.length === 0) {
                historyEl.innerHTML = `
                    <div style="background: var(--apple-card-bg, #f8fafc); border: 1px solid var(--apple-border); border-radius: 12px; padding: 1.25rem; text-align: center; color: var(--apple-subtext); font-size: 0.9rem;">
                        📋 لا يوجد سجل زيارات سابقة بعد.
                    </div>
                `;
            } else {
                historyEl.innerHTML = history.map(h => `
                    <div style="background: var(--apple-card-bg, #ffffff); border: 1px solid var(--apple-border); border-radius: 12px; padding: 0.85rem 1rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem;">
                        <div>
                            <strong style="color: var(--apple-text);">${api.escape(h.doctorTitle || 'د.')} ${api.escape(h.doctorName)}</strong>
                            <span style="color: var(--apple-subtext); font-size: 0.8rem; margin-right: 0.5rem;">(${h.date} ${h.time})</span>
                        </div>
                        <span style="font-weight: 700; color: ${h.status === 'completed' ? '#10b981' : '#ef4444'};">
                            ${h.status === 'completed' ? 'مكتمل ✔️' : 'ملغى ❌'}
                        </span>
                    </div>
                `).join('');
            }
        }

        if (window.lucide) window.lucide.createIcons();
    } catch (err) {
        console.error('فشل تحميل بوابة المريض:', err);
    }
}

async function cancelAppointmentFromPortal(appointmentId) {
    if (!appointmentId) return;
    if (!confirm('هل أنت تأكد من رغبتك في إلغاء هذا الموعد؟')) return;

    try {
        const res = await api.cancelPatientAppointment(appointmentId);
        showToast(res.message || 'تم إلغاء الموعد بنجاح', 'success');
        await loadPatientPortal();
    } catch (err) {
        showToast(err.message || 'تعذر إلغاء الموعد', 'error');
    }
}



