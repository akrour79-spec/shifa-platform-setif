/**
 * Shifa Platform — dashboard.js
 * ----------------------------------------------------------------------------
 * مقسّم من js/app.js إلى وحدات حسب الميزة (سكربتات كلاسيكية، نطاق عام مشترك).
 * يُحمَّل بالترتيب المذكور في index.html — لا تغيّر الترتيب.
 */

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
  const user = api.getUser();
  const clinic = api.getClinic();
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
    const res = await api.toggleBookingStatus(nextStatus);
    if (clinic) {
      clinic.accepting_bookings = nextStatus;
      api.setSession(api.getToken(), user, clinic);
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




/**
 * مؤشر حالة الاتصال في لوحة الطبيب — يفحص /api/health دورياً.
 * أخضر = متصل، أحمر = منقطع. يُحدَّث كل 60 ثانية وعند عودة الاتصال.
 */
let connStatusTimer = null;

async function renderConnectionStatus() {
    const el = document.getElementById('doctor-conn-status');
    if (!el) return;
    const dot = el.querySelector('.status-pulse-dot');
    const label = el.querySelector('span:last-child');
    try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        const ok = res.ok && (await res.json()).ok !== false;
        if (dot) dot.style.background = ok ? '#10b981' : '#ef4444';
        if (label) {
            label.textContent = ok ? 'متصل بالخادم' : 'الخادم لا يستجيب';
            el.style.color = ok ? '#10b981' : '#ef4444';
        }
    } catch {
        if (dot) dot.style.background = '#ef4444';
        if (label) {
            label.textContent = 'غير متصل — تحقق من الإنترنت';
            el.style.color = '#ef4444';
        }
    }
}

function startConnectionStatusPolling() {
    if (connStatusTimer) clearInterval(connStatusTimer);
    renderConnectionStatus();
    connStatusTimer = setInterval(renderConnectionStatus, 60000);
    window.addEventListener('online', renderConnectionStatus);
}
