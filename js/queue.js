/**
 * Shifa Platform — queue.js
 * ----------------------------------------------------------------------------
 * مقسّم من js/app.js إلى وحدات حسب الميزة (سكربتات كلاسيكية، نطاق عام مشترك).
 * يُحمَّل بالترتيب المذكور في index.html — لا تغيّر الترتيب.
 */

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
    // عناصر عرض المريض فقط (patient.html الجديدة)
    const patientNumDisplay = document.getElementById('patient-queue-number');
    const patientWaitDisplay = document.getElementById('patient-queue-wait');

    const currentApt = state.appointments.find(a => a.queueNumber === state.currentQueueNumber);
    const queueLabel = `#${String(state.currentQueueNumber).padStart(2, '0')}`;

    // وميض الرقم عند تغيّر الدور فقط — tickNumber تتخطى إن لم يتغيّر
    tickNumber(currentNumDisplay, queueLabel);
    if (currentNameDisplay) currentNameDisplay.textContent = currentApt ? currentApt.patientName : "لا يوجد مريض حالي";

    // عرض المريض: دوره الخاص والانتظار المتبقي
    if (patientNumDisplay) {
        const myApt = state.appointments.find(a => {
            const user = (() => { try { return api.getUser(); } catch (e) { return null; } })();
            return user && (a.patientId === user.id || a.patientPhone === user.phone);
        });
        if (myApt && myApt.queueNumber) {
            patientNumDisplay.textContent = `#${String(myApt.queueNumber).padStart(2, '0')}`;
            const ahead = myApt.queueNumber - state.currentQueueNumber;
            if (patientWaitDisplay) {
                patientWaitDisplay.textContent = ahead <= 0 ? '🎉 حان دورك — توجه لمكتب الطبيب' : `متبقٍ ${ahead} ${ahead === 1 ? 'مريض' : 'مرضى'} قبلك`;
            }
        } else {
            patientNumDisplay.textContent = '--';
            if (patientWaitDisplay) patientWaitDisplay.textContent = 'لا يوجد لديك حجز اليوم';
        }
    }

    if (!list) return;

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
        if (typeof renderDoctorDashboard === 'function') renderDoctorDashboard();

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
        if (typeof renderDoctorDashboard === 'function') renderDoctorDashboard();

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
/** آخر بيانات ناجحة لشاشة الطابور — تُعرض عند انقطاع الاتصال */
let queueScreenCache = { data: null, at: 0 };

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

        // نحفظ آخر بيانات ناجحة — تُعرض عند انقطاع الاتصال بدل شاشة فارغة
        queueScreenCache.data = data;
        queueScreenCache.at = Date.now();

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
            stale: false,
        });

        // الخادم نفسه يحدّد مدة التحديث بين طلب وآخر
        const seconds = Number(data.refreshAfterSeconds) || 15;
        queueScreenTimer = setTimeout(refreshQueueScreen, seconds * 1000);
    } catch (err) {
        // عند الفشل: نعرض آخر بيانات معروفة مع شارة "غير محدّث" بدل
        // مسح الشاشة — مهم في العيادات ذات الاتصال الضعيف
        const cached = queueScreenCache.data;
        if (cached) {
            const agoMin = Math.max(1, Math.round((Date.now() - queueScreenCache.at) / 60000));
            setTvScreen({
                number: cached.current ? cached.current.queue_number : '--',
                name: cached.current ? cached.current.patient_name : 'في انتظار المريض التالي',
                subtitle: `⚠ غير محدّث منذ ${agoMin} د — جاري إعادة المحاولة…`,
                clinicName: cached.clinic?.name || 'عيادة شفاء',
                stale: true,
            });
        } else {
            setTvScreen({
                number: '--',
                name: 'تعذّر الاتصال بالخادم',
                subtitle: err.message || 'تحقّق من اتصال الخادم',
                clinicName: 'عيادة شفاء',
                stale: true,
            });
        }
        // إعادة محاولة أقصر عند الفشل: الخادم قد يكون قيد إعادة التشغيل
        queueScreenTimer = setTimeout(refreshQueueScreen, 5000);
    }
}

function setTvScreen({ number, name, subtitle, clinicName, stale = false }) {
    const numEl = document.getElementById('tv-number-display');
    const nameEl = document.getElementById('tv-patient-name-display');
    const subEl = document.getElementById('tv-doctor-subtitle');
    const clinicEl = document.getElementById('tv-clinic-name');

    if (numEl) numEl.textContent = typeof number === 'number' ? `#${String(number).padStart(2, '0')}` : number;
    if (nameEl) nameEl.textContent = name ? `المريض: ${name}` : 'في انتظار المريض التالي';
    if (subEl) subEl.textContent = subtitle || '';
    if (clinicEl) clinicEl.textContent = clinicName || '';
    // شارة بصرية للبيانات القديمة — تُزال تلقائياً عند عودة الاتصال
    const overlay = document.getElementById('clinic-tv-overlay');
    if (overlay) overlay.classList.toggle('tv-stale', stale);
}

// عند عودة الاتصال: نحدّث الشاشة فوراً بدل انتظار المؤقت
window.addEventListener('online', () => {
    if (document.getElementById('clinic-tv-overlay')?.classList.contains('open')) {
        refreshQueueScreen();
    }
});

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
        if (typeof renderStats === 'function') renderStats();
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

