/**
 * Shifa Platform — booking.js
 * ----------------------------------------------------------------------------
 * مقسّم من js/app.js إلى وحدات حسب الميزة (سكربتات كلاسيكية، نطاق عام مشترك).
 * يُحمَّل بالترتيب المذكور في index.html — لا تغيّر الترتيب.
 */

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
    if (!api.isAuthenticated()) {
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
    const authUser = api.getUser();
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
        if (typeof renderStats === 'function') renderStats();

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

