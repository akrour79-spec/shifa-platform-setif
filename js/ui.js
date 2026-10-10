/**
 * Shifa Platform — ui.js
 * ----------------------------------------------------------------------------
 * مقسّم من js/app.js إلى وحدات حسب الميزة (سكربتات كلاسيكية، نطاق عام مشترك).
 * يُحمَّل بالترتيب المذكور في index.html — لا تغيّر الترتيب.
 */

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
    if (typeof showSuccessTicket === 'function') {
        showSuccessTicket(apt, doc);
    } else {
        showToast('تم العثور على الموعد', 'info');
    }
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
    if (typeof renderDoctorDashboard === 'function') renderDoctorDashboard();
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
            if (typeof loadDoctors === 'function') loadDoctors();
        } else if (viewName === 'patient-portal') {
            if (typeof loadPatientPortal === 'function') loadPatientPortal();
        } else if (viewName === 'monetization') {
            if (typeof renderPricingCards === 'function') renderPricingCards();
            if (typeof renderSubscriptions === 'function') renderSubscriptions();
            if (typeof loadAdminAnalytics === 'function') loadAdminAnalytics();
        } else if (viewName === 'queue') {
            renderQueue();
        } else if (viewName === 'doctor') {
            if (typeof renderDoctorDashboard === 'function') renderDoctorDashboard();
        } else if (viewName === 'map') {
            requestAnimationFrame(() => {
                if (!state.map) {
                    if (typeof initMap === 'function') initMap();
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


/**
 * ظهور تدريجي للعناصر عند التمرير — يُطبَّق على بطاقات الأطباء والإحصائيات.
 */
function initScrollReveal() {
    const els = document.querySelectorAll('.doctor-card, .stat-box, .analytics-kpi-card');
    els.forEach((el) => el.classList.add('reveal-on-scroll'));
    const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
            if (e.isIntersecting) {
                e.target.classList.add('revealed');
                io.unobserve(e.target);
            }
        });
    }, { threshold: 0.12 });
    els.forEach((el) => io.observe(el));
    // للبطاقات التي تُرسم لاحقاً (بعد تحميل الأطباء)
    new MutationObserver(() => {
        document.querySelectorAll('.doctor-card:not(.reveal-on-scroll)').forEach((el) => {
            el.classList.add('reveal-on-scroll');
            io.observe(el);
        });
    }).observe(document.body, { childList: true, subtree: true });
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
