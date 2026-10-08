/**
 * Shifa Platform — portal.js
 * ----------------------------------------------------------------------------
 * مقسّم من js/app.js إلى وحدات حسب الميزة (سكربتات كلاسيكية، نطاق عام مشترك).
 * يُحمَّل بالترتيب المذكور في index.html — لا تغيّر الترتيب.
 */

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



